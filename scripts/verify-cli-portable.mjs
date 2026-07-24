import { spawnSync } from "node:child_process";
import { access, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { STAGE_DIR_NAME, ZIP_NAME } from "./cli-portable/constants.mjs";
import { verifyCliPortableStage } from "./cli-portable/verifyStage.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const verifyRoot = join(repoRoot, ".tmp", "cli-portable-verify");

function parseArgs(argv) {
  const options = {
    zipPath: join(repoRoot, "release", ZIP_NAME),
    jsSmoke: true
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--zip") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--zip requires a path");
      }
      options.zipPath = resolve(process.cwd(), value);
      index += 1;
    } else if (arg === "--js-smoke") {
      options.jsSmoke = true;
    } else if (arg === "--no-js-smoke") {
      options.jsSmoke = false;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function assertSafeZipPath(path) {
  const normalized = path.endsWith("/") ? path.slice(0, -1) : path;
  const segments = normalized.split("/");
  if (
    !normalized ||
    isAbsolute(normalized) ||
    normalized.includes("\\") ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`Unsafe path in portable zip: ${path}`);
  }
  return segments;
}

async function extractZip(zipPath) {
  const zip = await JSZip.loadAsync(await readFile(zipPath));
  await rm(verifyRoot, { recursive: true, force: true });
  await mkdir(verifyRoot, { recursive: true });

  for (const [path, entry] of Object.entries(zip.files)) {
    const segments = assertSafeZipPath(path);
    const destination = join(verifyRoot, ...segments);
    if (entry.dir) {
      await mkdir(destination, { recursive: true });
      continue;
    }
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, await entry.async("nodebuffer"));
  }

  return join(verifyRoot, STAGE_DIR_NAME);
}

async function createMinimalHwpx(path) {
  const zip = new JSZip();
  zip.file("mimetype", "application/hwp+zip", { compression: "STORE" });
  zip.file(
    "Contents/content.hpf",
    '<opf:package xmlns:opf="http://www.idpf.org/2007/opf" />'
  );
  zip.file("Contents/section0.xml", "<root />");
  await writeFile(
    path,
    await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 9 }
    })
  );
}

async function assertNonemptyFile(path, label) {
  await access(path);
  const info = await stat(path);
  if (!info.isFile() || info.size === 0) {
    throw new Error(`${label} was not created as a non-empty file: ${path}`);
  }
}

async function runJsSmoke() {
  const smokeRoot = join(verifyRoot, "js-smoke");
  const inputPath = join(smokeRoot, "minimal.hwpx");
  const outputPath = join(smokeRoot, "out.hwpx");
  const reportPath = join(smokeRoot, "r.json");
  await mkdir(smokeRoot, { recursive: true });
  await createMinimalHwpx(inputPath);

  const result = spawnSync(
    process.execPath,
    [
      join(repoRoot, "packages", "cli", "dist", "index.js"),
      "optimize",
      inputPath,
      "--mode",
      "balanced",
      "--out",
      outputPath,
      "--report",
      reportPath
    ],
    {
      cwd: repoRoot,
      env: process.env,
      stdio: "inherit"
    }
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Host JS smoke failed with exit code ${result.status}`);
  }

  await assertNonemptyFile(outputPath, "JS smoke output");
  await assertNonemptyFile(reportPath, "JS smoke report");
  JSON.parse(await readFile(reportPath, "utf8"));
}

async function verifyPortable(options) {
  const stageRoot = await extractZip(options.zipPath);
  await verifyCliPortableStage(stageRoot);
  console.log(`Portable stage OK: ${stageRoot}`);

  if (options.jsSmoke) {
    await runJsSmoke();
    console.log("Host JS smoke OK");
  }

  console.log(`CLI portable verification OK: ${options.zipPath}`);
}

const options = parseArgs(process.argv.slice(2));
await verifyPortable(options);
