import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";

const electronCache = join(process.cwd(), ".npm-cache", "electron");
const electronBuilderCache = join(process.cwd(), ".npm-cache", "electron-builder");
await mkdir(electronCache, { recursive: true });
await mkdir(electronBuilderCache, { recursive: true });

const builderArgs = process.argv.slice(2);
if (!builderArgs.some((arg) => arg === "--publish" || arg.startsWith("--publish="))) {
  builderArgs.push("--publish", "never");
}

const command = process.platform === "win32" ? "cmd.exe" : "npx";
const args =
  process.platform === "win32"
    ? ["/d", "/s", "/c", "npx", "electron-builder", ...builderArgs]
    : ["electron-builder", ...builderArgs];

const child = spawn(command, args, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    ELECTRON_CACHE: electronCache,
    ELECTRON_BUILDER_CACHE: electronBuilderCache
  },
  stdio: "inherit",
  shell: false
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
