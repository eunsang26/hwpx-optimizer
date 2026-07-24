import { execFile } from "node:child_process";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  FORBIDDEN_SHARP_DIR_SUBSTRINGS,
  SHARP_WIN32_PACKAGE
} from "./constants.mjs";
import { prunePackagingTree } from "./prunePackaging.mjs";

const execFileAsync = promisify(execFile);
const RUNTIME_DEPENDENCIES = [
  ["sharp", "sharp"],
  ["jszip", "jszip"],
  ["fast-xml-parser", "fastXmlParser"]
];

function isExactVersion(value) {
  return typeof value === "string" && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function versionsFromLock(lock) {
  const versions = {};
  for (const [packageName, resultKey] of RUNTIME_DEPENDENCIES) {
    const version =
      lock.packages?.[`node_modules/${packageName}`]?.version ??
      lock.dependencies?.[packageName]?.version;
    if (!isExactVersion(version)) {
      return undefined;
    }
    versions[resultKey] = version;
  }
  return versions;
}

function versionsFromPackageJson(pkg) {
  const versions = {};
  for (const [packageName, resultKey] of RUNTIME_DEPENDENCIES) {
    const version = pkg.dependencies?.[packageName];
    if (!isExactVersion(version)) {
      throw new Error(
        `Root package.json must pin an exact ${packageName} version when package-lock.json is unavailable`
      );
    }
    versions[resultKey] = version;
  }
  return versions;
}

export function buildStagingPackageJson(versions) {
  return {
    name: "hwpx-opt-portable-app",
    private: true,
    type: "module",
    dependencies: {
      sharp: versions.sharp,
      jszip: versions.jszip,
      "fast-xml-parser": versions.fastXmlParser
    }
  };
}

export async function readRootRuntimeVersions(repoRoot) {
  try {
    const lock = await readJson(join(repoRoot, "package-lock.json"));
    const versions = versionsFromLock(lock);
    if (versions) {
      return versions;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  return versionsFromPackageJson(await readJson(join(repoRoot, "package.json")));
}

async function runNpm(args, cwd) {
  const npmCommand = process.platform === "win32" ? "cmd.exe" : "npm";
  const npmArgs =
    process.platform === "win32"
      ? ["/d", "/s", "/c", "npm", ...args]
      : args;
  await execFileAsync(npmCommand, npmArgs, {
    cwd,
    env: process.env,
    maxBuffer: 10 * 1024 * 1024
  });
}

async function copyJsTree(sourceDir, targetDir) {
  await mkdir(targetDir, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const source = join(sourceDir, entry.name);
    const target = join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copyJsTree(source, target);
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      await writeFile(target, await readFile(source));
    }
  }
}

async function copyWorkspacePackage(repoRoot, appRoot, packageName) {
  const sourceRoot = join(repoRoot, "packages", packageName);
  const appPackageRoot = join(appRoot, packageName);
  const nodeModulesPackageRoot = join(
    appRoot,
    "node_modules",
    "@hwpx-optimizer",
    packageName
  );
  const packageJson = await readFile(join(sourceRoot, "package.json"));

  for (const targetRoot of [appPackageRoot, nodeModulesPackageRoot]) {
    await mkdir(targetRoot, { recursive: true });
    await writeFile(join(targetRoot, "package.json"), packageJson);
    await copyJsTree(join(sourceRoot, "dist"), join(targetRoot, "dist"));
  }
}

async function pruneGeneratedFiles(root) {
  await prunePackagingTree(root);
}

async function pruneSharpVariants(appRoot) {
  const imgRoot = join(appRoot, "node_modules", "@img");
  let entries;
  try {
    entries = await readdir(imgRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const entry of entries) {
    if (
      entry.isDirectory() &&
      FORBIDDEN_SHARP_DIR_SUBSTRINGS.some((substring) =>
        entry.name.includes(substring)
      )
    ) {
      await rm(join(imgRoot, entry.name), { recursive: true, force: true });
    }
  }
}

export async function assembleApp({ repoRoot, appRoot, npmCacheDir }) {
  await rm(appRoot, { recursive: true, force: true });
  await mkdir(appRoot, { recursive: true });
  await mkdir(npmCacheDir, { recursive: true });

  const versions = await readRootRuntimeVersions(repoRoot);
  await writeFile(
    join(appRoot, "package.json"),
    `${JSON.stringify(buildStagingPackageJson(versions), null, 2)}\n`,
    "utf8"
  );

  const installFlags = [
    "install",
    "--prefix",
    appRoot,
    "--omit=dev",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--no-package-lock",
    "--cache",
    npmCacheDir
  ];
  await runNpm(installFlags, repoRoot);
  await runNpm(
    [
      "install",
      "--prefix",
      appRoot,
      "--force",
      "--omit=dev",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--no-package-lock",
      "--cache",
      npmCacheDir,
      SHARP_WIN32_PACKAGE
    ],
    repoRoot
  );

  await copyWorkspacePackage(repoRoot, appRoot, "cli");
  await copyWorkspacePackage(repoRoot, appRoot, "core");
  await pruneSharpVariants(appRoot);

  for (const root of [
    join(appRoot, "cli"),
    join(appRoot, "core"),
    join(appRoot, "node_modules")
  ]) {
    await pruneGeneratedFiles(root);
  }

  await rm(join(appRoot, "package-lock.json"), { force: true });

  for (const packageName of ["tsx", "vitest"]) {
    await rm(join(appRoot, "node_modules", packageName), {
      recursive: true,
      force: true
    });
  }
}
