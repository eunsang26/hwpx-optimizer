import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { existsSync, watch } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const desktopSrc = join(root, "apps", "desktop", "src");
const desktopDist = join(root, "apps", "desktop", "dist");
const coreDist = join(root, "packages", "core", "dist");
const bundledCoreRoot = join(desktopDist, "node_modules", "@hwpx-optimizer", "core");
const staticAssets = ["index.html", "styles.css", "preload.cjs", "main.cjs"];

let electronProcess;
let copying = Promise.resolve();
let restartTimer;

if (!canLaunchVisibleElectron()) {
  console.error(
    [
      "Cannot launch the Electron dev window because no graphical display is available.",
      "",
      "This shell is running under Linux/WSL without DISPLAY or WAYLAND_DISPLAY.",
      "Use one of these options:",
      "  1. Run from a WSLg-enabled terminal where DISPLAY is set.",
      "  2. Start an X server on Windows, then export DISPLAY before running this command.",
      "  3. For headless verification only, run: xvfb-run -a npm run desktop:dev",
      "",
      "Headless mode is useful for smoke checks, but it will not show an interactive window."
    ].join("\n")
  );
  process.exit(1);
}

const tsc = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["tsc", "-b", "packages/core", "packages/cli", "apps/desktop", "--watch", "--preserveWatchOutput", "false"],
  {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env }
  }
);

tsc.stdout.setEncoding("utf8");
tsc.stderr.setEncoding("utf8");
tsc.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  if (chunk.includes("Found 0 errors. Watching for file changes.")) {
    void copyRuntimeAssets().then(() => restartElectron());
  }
});
tsc.stderr.on("data", (chunk) => process.stderr.write(chunk));
tsc.on("exit", (code) => {
  if (electronProcess) electronProcess.kill();
  process.exit(code ?? 0);
});

watchDesktopAssets();

function watchDesktopAssets() {
  for (const asset of staticAssets) {
    watch(join(desktopSrc, asset), { persistent: true }, () => {
      void copyRuntimeAssets().then(() => restartElectronDebounced());
    });
  }
}

function restartElectronDebounced() {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => restartElectron(), 150);
}

async function copyRuntimeAssets() {
  copying = copying.then(async () => {
    await mkdir(desktopDist, { recursive: true });
    for (const asset of staticAssets) {
      await copyFile(join(desktopSrc, asset), join(desktopDist, asset));
    }

    if (existsSync(coreDist)) {
      await rm(bundledCoreRoot, { recursive: true, force: true });
      await mkdir(bundledCoreRoot, { recursive: true });
      await copyFile(join(root, "packages", "core", "package.json"), join(bundledCoreRoot, "package.json"));
      await copyRuntimeFiles(coreDist, join(bundledCoreRoot, "dist"));
    }
  });
  return copying;
}

async function copyRuntimeFiles(sourceDir, targetDir) {
  const sourceStat = await stat(sourceDir).catch(() => undefined);
  if (!sourceStat?.isDirectory()) return;
  await mkdir(targetDir, { recursive: true });
  for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copyRuntimeFiles(sourcePath, targetPath);
      continue;
    }
    if (entry.isFile() && (entry.name.endsWith(".js") || entry.name.endsWith(".d.ts"))) {
      await copyFile(sourcePath, targetPath);
    }
  }
}

function restartElectron() {
  const mainPath = join(desktopDist, "main.cjs");
  if (!existsSync(mainPath)) return;

  if (electronProcess && !electronProcess.killed) {
    electronProcess.kill();
  }

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  electronProcess = spawn(electronPath, [root], {
    cwd: root,
    env,
    stdio: "inherit",
    windowsHide: false
  });
}

function shutdown() {
  tsc.kill();
  if (electronProcess && !electronProcess.killed) electronProcess.kill();
}

process.on("SIGINT", () => {
  shutdown();
  process.exit(130);
});
process.on("SIGTERM", () => {
  shutdown();
  process.exit(143);
});

function canLaunchVisibleElectron() {
  if (process.platform === "win32" || process.platform === "darwin") return true;
  return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}
