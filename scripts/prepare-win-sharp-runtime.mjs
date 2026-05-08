import { execFile } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const runtimeRoot = join(process.cwd(), ".tmp", "win-sharp-runtime");
const runtimePackage = join(runtimeRoot, "node_modules", "@img", "sharp-win32-x64");
const nodeModulesPackage = join(process.cwd(), "node_modules", "@img", "sharp-win32-x64");
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

await rm(nodeModulesPackage, { recursive: true, force: true });
await mkdir(join(process.cwd(), "node_modules", "@img"), { recursive: true });
await cp(runtimePackage, nodeModulesPackage, { recursive: true });

console.log("Prepared Windows sharp runtime package.");
