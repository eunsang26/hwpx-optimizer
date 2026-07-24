import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { assembleApp } from "./cli-portable/assembleApp.mjs";
import {
  NODE_VERSION,
  STAGE_DIR_NAME,
  ZIP_NAME
} from "./cli-portable/constants.mjs";
import { ensureNodeExe } from "./cli-portable/fetchNode.mjs";
import { writeSha256Sums } from "./cli-portable/hashTree.mjs";
import {
  renderDropHereBat,
  renderHwpxOptCmd,
  renderUsageTxt
} from "./cli-portable/launchers.mjs";
import { verifyCliPortableStage } from "./cli-portable/verifyStage.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const options = {
    nodeZipPath: process.env.HWPX_OPT_NODE_ZIP,
    outDir: resolve(repoRoot, "release"),
    skipBuild: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--skip-build") {
      options.skipBuild = true;
    } else if (arg === "--node-zip" || arg === "--out-dir") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${arg} requires a path`);
      }
      index += 1;
      if (arg === "--node-zip") {
        options.nodeZipPath = value;
      } else {
        options.outDir = resolve(process.cwd(), value);
      }
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.nodeZipPath) {
    options.nodeZipPath = resolve(process.cwd(), options.nodeZipPath);
  }
  return options;
}

function runBuild() {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npmCommand, ["run", "build"], {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit"
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`npm run build failed with exit code ${result.status}`);
  }
}

async function addTreeToZip(zip, rootDir, currentDir) {
  const entries = await readdir(currentDir, { withFileTypes: true });
  entries.sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0
  );

  for (const entry of entries) {
    const path = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await addTreeToZip(zip, rootDir, path);
    } else if (entry.isFile()) {
      const relativePath = relative(rootDir, path).split(sep).join("/");
      zip.file(`${STAGE_DIR_NAME}/${relativePath}`, await readFile(path));
    }
  }
}

async function writePortableZip(stageRoot, zipPath) {
  const zip = new JSZip();
  await addTreeToZip(zip, stageRoot, stageRoot);
  const bytes = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
    platform: "DOS"
  });
  await writeFile(zipPath, bytes);
}

async function buildPortable(options) {
  const stageRoot = join(
    repoRoot,
    ".tmp",
    "cli-portable-stage",
    STAGE_DIR_NAME
  );
  const nodeCacheDir = join(repoRoot, ".npm-cache", "cli-portable", "node");
  const npmCacheDir = join(repoRoot, ".npm-cache", "cli-portable");
  const checksumName = `${ZIP_NAME.slice(0, -4)}.SHA256SUMS.txt`;
  const checksumPath = join(options.outDir, checksumName);
  const zipPath = join(options.outDir, ZIP_NAME);
  const artifactTempDir = join(
    options.outDir,
    `.cli-portable-artifacts-${process.pid}`
  );
  const temporaryZipPath = join(artifactTempDir, ZIP_NAME);

  if (!options.skipBuild) {
    runBuild();
  }

  await rm(stageRoot, { recursive: true, force: true });
  await mkdir(stageRoot, { recursive: true });

  await ensureNodeExe({
    version: NODE_VERSION,
    cacheDir: nodeCacheDir,
    outExePath: join(stageRoot, "node", "node.exe"),
    nodeZipPath: options.nodeZipPath
  });
  await assembleApp({
    repoRoot,
    appRoot: join(stageRoot, "app"),
    npmCacheDir
  });

  await Promise.all([
    writeFile(join(stageRoot, "drop-here.bat"), renderDropHereBat(), "utf8"),
    writeFile(join(stageRoot, "hwpx-opt.cmd"), renderHwpxOptCmd(), "utf8"),
    writeFile(join(stageRoot, "사용법.txt"), renderUsageTxt(), "utf8"),
    copyFile(join(repoRoot, "TERMS.txt"), join(stageRoot, "TERMS.txt"))
  ]);
  await verifyCliPortableStage(stageRoot);

  await mkdir(options.outDir, { recursive: true });
  await rm(artifactTempDir, { recursive: true, force: true });
  await mkdir(artifactTempDir, { recursive: true });
  try {
    await writePortableZip(stageRoot, temporaryZipPath);
    await writeSha256Sums(artifactTempDir, checksumPath);
    await rm(zipPath, { force: true });
    await rename(temporaryZipPath, zipPath);
  } finally {
    await rm(artifactTempDir, { recursive: true, force: true });
  }

  console.log(`Created ${zipPath}`);
  console.log(`Created ${checksumPath}`);
}

const options = parseArgs(process.argv.slice(2));
await buildPortable(options);
