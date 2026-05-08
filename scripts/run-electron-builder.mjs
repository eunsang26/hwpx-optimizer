import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";

const electronCache = join(process.cwd(), ".npm-cache", "electron");
await mkdir(electronCache, { recursive: true });

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const child = spawn(npx, ["electron-builder", ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    ELECTRON_CACHE: electronCache
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
