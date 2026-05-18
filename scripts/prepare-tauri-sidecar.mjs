import { chmod, copyFile, mkdir } from "node:fs/promises";
import { dirname, basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binariesDir = join(root, "apps", "tauri-desktop", "src-tauri", "binaries");
const sidecarBaseName = "hwpx-sidecar";

const currentTarget = targetTripleFor(process.platform, process.arch);
if (!currentTarget) {
  throw new Error(`Unsupported sidecar preparation target: ${process.platform}/${process.arch}`);
}

await mkdir(binariesDir, { recursive: true });
const extension = process.platform === "win32" ? ".exe" : "";
const outputPath = join(binariesDir, `${sidecarBaseName}-${currentTarget}${extension}`);
await copyFile(process.execPath, outputPath);
await chmod(outputPath, 0o755);

console.log(`Prepared ${basename(outputPath)} from ${process.execPath}`);

function targetTripleFor(platform, arch) {
  if (platform === "linux" && arch === "x64") return "x86_64-unknown-linux-gnu";
  if (platform === "win32" && arch === "x64") return "x86_64-pc-windows-msvc";
  if (platform === "darwin" && arch === "arm64") return "aarch64-apple-darwin";
  if (platform === "darwin" && arch === "x64") return "x86_64-apple-darwin";
  return undefined;
}
