import { spawnSync } from "node:child_process";

const needsVirtualDisplay = process.platform === "linux" && !process.env.DISPLAY;
const command = needsVirtualDisplay ? "xvfb-run" : process.execPath;
const args = needsVirtualDisplay
  ? ["-a", process.execPath, "scripts/run-electron-app.mjs", "--smoke-test"]
  : ["scripts/run-electron-app.mjs", "--smoke-test"];

const result = spawnSync(command, args, { stdio: "inherit", env: process.env });
if (result.error) {
  throw result.error;
}
if (typeof result.status === "number") {
  process.exitCode = result.status;
} else if (result.signal) {
  console.error(`Electron smoke terminated by signal ${result.signal}`);
  process.exitCode = 1;
}
