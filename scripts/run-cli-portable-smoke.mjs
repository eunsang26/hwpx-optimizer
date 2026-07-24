import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const zipPath = resolve("release", "hwpx-opt-win-x64.zip");
const scriptPath = resolve("scripts", "cli-portable-smoke.ps1");
const samplePath = process.env.HWPX_OPT_SMOKE_INPUT
  ? resolve(process.env.HWPX_OPT_SMOKE_INPUT)
  : undefined;
const mode = process.env.HWPX_OPT_SMOKE_MODE ?? "balanced";

const powershell = findPowerShell();
if (!powershell) {
  console.error("Windows PowerShell required; CLI portable Windows support not verified.");
  process.exitCode = 1;
} else if (!existsSync(zipPath)) {
  console.error(`CLI portable zip not found: ${zipPath}`);
  process.exitCode = 1;
} else if (samplePath && !existsSync(samplePath)) {
  console.error(`Sample HWPX not found: ${samplePath}`);
  process.exitCode = 1;
} else {
  const smokePaths = prepareSmokePaths({ zipPath, samplePath, powershell });
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    toPowerShellPath(scriptPath, powershell),
    "-ZipPath",
    smokePaths.zip,
    "-Mode",
    mode
  ];
  if (smokePaths.sample) {
    args.push("-Sample", smokePaths.sample);
  }

  const result = spawnSync(powershell, args, { stdio: "inherit", env: process.env });
  if (result.error) {
    console.error(result.error.message);
    process.exitCode = 1;
  } else {
    process.exitCode = result.status ?? (result.signal ? 1 : 0);
  }
}

function findPowerShell() {
  if (process.platform === "win32") return "powershell";
  const candidates = [
    "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
    "powershell.exe",
    "pwsh"
  ];
  for (const candidate of candidates) {
    if (candidate.includes("/") && !existsSync(candidate)) continue;
    const probe = spawnSync(
      candidate,
      ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"],
      { stdio: "ignore" }
    );
    if (!probe.error && probe.status === 0) return candidate;
  }
  return undefined;
}

function toPowerShellPath(path, powershell) {
  if (process.platform === "win32" || !powershell.endsWith(".exe")) return path;
  const converted = spawnSync("wslpath", ["-w", path], { encoding: "utf8" });
  if (converted.status !== 0) {
    throw new Error(`Failed to convert WSL path for PowerShell: ${path}`);
  }
  return converted.stdout.trim();
}

function prepareSmokePaths(input) {
  return {
    zip: toPowerShellPath(input.zipPath, input.powershell),
    sample: input.samplePath
      ? toPowerShellPath(input.samplePath, input.powershell)
      : undefined
  };
}
