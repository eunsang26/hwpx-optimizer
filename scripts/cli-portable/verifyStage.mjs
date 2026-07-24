import { access, readFile, readdir, stat } from "fs/promises";
import { join } from "path";
import { FORBIDDEN_SHARP_DIR_SUBSTRINGS, REQUIRED_WIN_SHARP_FILES } from "./constants.mjs";
import { assertWinSharpUsesUcrtOnly } from "./peImports.mjs";
import { shouldPrunePackagingFile } from "./prunePackaging.mjs";

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function assertExists(path, label) {
  if (!(await pathExists(path))) {
    throw new Error(`Missing ${label}: ${path}`);
  }
}

async function readJson(path) {
  const raw = await readFile(path, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function assertModulePackageJson(path, label) {
  await assertExists(path, label);
  const pkg = await readJson(path);
  if (pkg.type !== "module") {
    throw new Error(`${label} must set "type": "module" (found ${JSON.stringify(pkg.type)}): ${path}`);
  }
}

async function walkDirectory(dir, visit) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await visit(fullPath, entry.name, true);
      await walkDirectory(fullPath, visit);
    } else {
      await visit(fullPath, entry.name, false);
    }
  }
}

async function assertHasJsFile(dir, label) {
  await assertExists(dir, label);
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const hasJs = entries.some((entry) => entry.isFile() && entry.name.endsWith(".js"));
  if (!hasJs) {
    throw new Error(`${label} must contain at least one .js file: ${dir}`);
  }
}

async function assertNoPackagingArtifacts(dir, label) {
  await assertExists(dir, label);
  await walkDirectory(dir, async (fullPath, name, isDirectory) => {
    if (!isDirectory && shouldPrunePackagingFile(name)) {
      throw new Error(`${label} must not contain ${name}: ${fullPath}`);
    }
  });
}

async function assertNodeExe(stageRoot) {
  const nodeExe = join(stageRoot, "node", "node.exe");
  await assertExists(nodeExe, "node.exe");
  const info = await stat(nodeExe);
  if (info.size <= 1_000_000) {
    throw new Error(`node.exe must be larger than 1,000,000 bytes (found ${info.size}): ${nodeExe}`);
  }
}

async function assertSharpNativeFiles(stageRoot) {
  const sharpLib = join(stageRoot, "app", "node_modules", "@img", "sharp-win32-x64", "lib");
  for (const file of REQUIRED_WIN_SHARP_FILES) {
    await assertExists(join(sharpLib, file), `sharp native file ${file}`);
  }
}

async function assertNoForbiddenSharpDirs(stageRoot) {
  const imgDir = join(stageRoot, "app", "node_modules", "@img");
  await assertExists(imgDir, "@img directory");
  await walkDirectory(imgDir, async (fullPath, name, isDirectory) => {
    if (!isDirectory) {
      return;
    }
    for (const forbidden of FORBIDDEN_SHARP_DIR_SUBSTRINGS) {
      if (name.includes(forbidden)) {
        throw new Error(
          `Forbidden sharp platform directory under @img (contains "${forbidden}"): ${fullPath}`
        );
      }
    }
  });
}

async function assertRootLaunchers(stageRoot) {
  const requiredRootFiles = ["drop-here.bat", "hwpx-opt.cmd", "사용법.txt", "TERMS.txt"];
  for (const file of requiredRootFiles) {
    await assertExists(join(stageRoot, file), file);
  }

  const bat = await readFile(join(stageRoot, "drop-here.bat"), "utf8");
  if (!bat.includes('set "ROOT=%~dp0"')) {
    throw new Error('drop-here.bat must contain set "ROOT=%~dp0"');
  }
  if (!bat.includes("--mode balanced")) {
    throw new Error("drop-here.bat must invoke the CLI with --mode balanced");
  }
}

export async function verifyCliPortableStage(stageRoot) {
  await assertNodeExe(stageRoot);

  const appRoot = join(stageRoot, "app");
  await assertModulePackageJson(join(appRoot, "package.json"), "app/package.json");

  const cliDist = join(appRoot, "cli", "dist");
  await assertExists(join(cliDist, "index.js"), "app/cli/dist/index.js");
  await assertExists(join(cliDist, "optimizeWorker.js"), "app/cli/dist/optimizeWorker.js");
  await assertNoPackagingArtifacts(cliDist, "app/cli/dist");

  const coreDist = join(appRoot, "core", "dist");
  await assertHasJsFile(coreDist, "app/core/dist");
  await assertNoPackagingArtifacts(coreDist, "app/core/dist");

  const nodeModulesRoot = join(appRoot, "node_modules");
  await assertNoPackagingArtifacts(nodeModulesRoot, "app/node_modules");

  await assertModulePackageJson(
    join(appRoot, "node_modules", "@hwpx-optimizer", "core", "package.json"),
    "@hwpx-optimizer/core package.json"
  );
  await assertModulePackageJson(
    join(appRoot, "node_modules", "@hwpx-optimizer", "cli", "package.json"),
    "@hwpx-optimizer/cli package.json"
  );

  await assertSharpNativeFiles(stageRoot);
  await assertNoForbiddenSharpDirs(stageRoot);
  await assertWinSharpUsesUcrtOnly(stageRoot);
  await assertRootLaunchers(stageRoot);
}
