import JSZip from "jszip";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { spawnFile } from "./lib/spawn-file.mjs";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const productName = packageJson.build?.productName ?? packageJson.name;
const version = packageJson.version;
const certPath = join(".tmp", "codesign", "hwpx-optimizer-selfsigned.pfx");
const passwordPath = join(".tmp", "codesign", "hwpx-optimizer-selfsigned.password");
const appExePath = join("release", "win-unpacked", `${productName}.exe`);
const portableExePath = join("release", `${productName}-${version}-x64.exe`);
const zipPath = join("release", `${productName}-${version}-x64.zip`);

await spawnFile(process.execPath, ["scripts/ensure-self-signed-codesign-cert.mjs"]);

const password = (await readFile(passwordPath, "utf8")).trim();
const osslsigncode = await resolveOsslSigncode();

await signPe(osslsigncode, appExePath, password);
await signPe(osslsigncode, portableExePath, password);
await writeZipFromDirectory(join("release", "win-unpacked"), zipPath);

console.log(`Self-signed ${appExePath}`);
console.log(`Self-signed ${portableExePath}`);
console.log(`Repacked ${zipPath} from signed win-unpacked directory`);

async function signPe(osslsigncodePath, inputPath, password) {
  const outputDir = join(".tmp", "codesign", "signed");
  await mkdir(outputDir, { recursive: true });
  const outputPath = join(outputDir, `${basename(inputPath)}.signed`);

  await spawnFile(osslsigncodePath, [
    "sign",
    "-pkcs12",
    certPath,
    "-pass",
    password,
    "-n",
    productName,
    "-i",
    "local.hwpxoptimizer.app",
    "-h",
    "sha256",
    "-in",
    inputPath,
    "-out",
    outputPath
  ]);
  await rename(outputPath, inputPath);
}

async function resolveOsslSigncode() {
  const candidates = [
    process.env.HWPX_OSSLSIGNCODE,
    ".tmp/tools/osslsigncode-root/usr/bin/osslsigncode",
    ".npm-cache/electron-builder/winCodeSign/winCodeSign-2.6.0/linux/osslsigncode"
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await canRun(candidate)) return candidate;
  }

  if (process.platform === "linux") {
    await mkdir(".tmp/tools", { recursive: true });
    await spawnFile("apt", ["download", "osslsigncode"], { cwd: resolve(".tmp/tools") });
    const deb = (await readdir(".tmp/tools")).find((entry) => /^osslsigncode_.*\.deb$/.test(entry));
    if (deb) {
      await spawnFile("dpkg-deb", ["-x", deb, "osslsigncode-root"], { cwd: resolve(".tmp/tools") });
      const extracted = ".tmp/tools/osslsigncode-root/usr/bin/osslsigncode";
      if (await canRun(extracted)) return extracted;
    }
  }

  throw new Error("No runnable osslsigncode binary found. Install osslsigncode or set HWPX_OSSLSIGNCODE.");
}

async function canRun(command) {
  if (!command) return false;
  try {
    await spawnFile(command, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function writeZipFromDirectory(sourceDir, outputPath) {
  const zip = new JSZip();
  const files = await listFiles(sourceDir);
  for (const file of files) {
    const archivePath = relative(sourceDir, file).split(sep).join("/");
    zip.file(archivePath, await readFile(file));
  }
  const data = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 }
  });
  await writeFile(outputPath, data);
}

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await listFiles(path)));
    } else if (entry.isFile() || (await stat(path)).isFile()) {
      result.push(path);
    }
  }
  return result;
}
