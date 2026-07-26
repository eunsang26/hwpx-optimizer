import JSZip from "jszip";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { spawnFile } from "./lib/spawn-file.mjs";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const productName = packageJson.build?.productName ?? packageJson.name;
const version = packageJson.version;
const codesignDir = join(".tmp", "codesign");
const selfSignedCertPath = join(codesignDir, "hwpx-optimizer-selfsigned.pfx");
const selfSignedPasswordPath = join(codesignDir, "hwpx-optimizer-selfsigned.password");
const signKindPath = join(codesignDir, "last-sign-kind.txt");
const appExePath = join("release", "win-unpacked", `${productName}.exe`);
const portableExePath = join("release", `${productName}-${version}-x64.exe`);
const zipPath = join("release", `${productName}-${version}-x64.zip`);

const material = await resolveSigningMaterial();
const osslsigncode = await resolveOsslSigncode();

await signPe(osslsigncode, appExePath, material);
await signPe(osslsigncode, portableExePath, material);
await writeZipFromDirectory(join("release", "win-unpacked"), zipPath);
await mkdir(codesignDir, { recursive: true });
await writeFile(signKindPath, `${material.kind}\n`, "utf8");

const label = material.kind === "organization" ? "Org-signed" : "Self-signed";
console.log(`${label} ${appExePath}`);
console.log(`${label} ${portableExePath}`);
console.log(`Repacked ${zipPath} from signed win-unpacked directory`);
console.log(`Wrote ${signKindPath} (${material.kind})`);

async function resolveSigningMaterial() {
  const link = process.env.HWPX_WIN_CSC_LINK || process.env.CSC_LINK;
  const password = process.env.HWPX_WIN_CSC_KEY_PASSWORD || process.env.CSC_KEY_PASSWORD;
  if (link) {
    if (!password) {
      throw new Error(
        "HWPX_WIN_CSC_LINK (or CSC_LINK) is set but HWPX_WIN_CSC_KEY_PASSWORD (or CSC_KEY_PASSWORD) is missing."
      );
    }
    const certPath = await materializePfx(link);
    return { kind: "organization", certPath, password };
  }

  await spawnFile(process.execPath, ["scripts/ensure-self-signed-codesign-cert.mjs"]);
  return {
    kind: "self-signed",
    certPath: selfSignedCertPath,
    password: (await readFile(selfSignedPasswordPath, "utf8")).trim()
  };
}

async function materializePfx(link) {
  await mkdir(codesignDir, { recursive: true });
  try {
    await stat(link);
    return resolve(link);
  } catch {
    // not a readable path — treat as base64 PFX payload
  }

  const outPath = join(codesignDir, "organization.pfx");
  const normalized = link.replace(/^base64,/, "").replace(/\s+/g, "");
  await writeFile(outPath, Buffer.from(normalized, "base64"));
  return outPath;
}

async function signPe(osslsigncodePath, inputPath, material) {
  const outputDir = join(codesignDir, "signed");
  await mkdir(outputDir, { recursive: true });
  const outputPath = join(outputDir, `${basename(inputPath)}.signed`);

  await spawnFile(osslsigncodePath, [
    "sign",
    "-pkcs12",
    material.certPath,
    "-pass",
    material.password,
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
