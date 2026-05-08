import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const runtimeRoot = join(process.cwd(), ".tmp", "win-sharp-runtime");
const npmCache = join(process.cwd(), ".npm-cache", "npm");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

await rm(runtimeRoot, { recursive: true, force: true });
await mkdir(runtimeRoot, { recursive: true });
await mkdir(npmCache, { recursive: true });

await execFileAsync(
  npmCommand,
  [
    "install",
    "--prefix",
    runtimeRoot,
    "--force",
    "--omit=dev",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--no-package-lock",
    "--cache",
    npmCache,
    "@img/sharp-win32-x64@0.33.5"
  ],
  {
    cwd: process.cwd(),
    env: process.env,
    maxBuffer: 1024 * 1024 * 10
  }
);

console.log("Prepared Windows sharp runtime package.");
