import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, join, resolve } from "node:path";

const packageVersion = JSON.parse(readFileSync(resolve("package.json"), "utf8")).version;
const artifactPath = resolve("release", `HWPX Optimizer-${packageVersion}-x64.exe`);
const checksumsPath = resolve("release", "SHA256SUMS.txt");
const scriptPath = resolve("scripts", "windows-portable-smoke.ps1");
const minArtifactBytes = process.env.HWPX_OPT_WINDOWS_SMOKE_MIN_BYTES ?? "50000000";

if (process.env.HWPX_OPT_SKIP_WIN_PORTABLE_SMOKE === "1") {
  console.log("Skipping Windows portable smoke (HWPX_OPT_SKIP_WIN_PORTABLE_SMOKE=1).");
  process.exit(0);
}

if (!existsSync(artifactPath)) {
  throw new Error(`Portable artifact not found: ${artifactPath}`);
}
if (!existsSync(checksumsPath)) {
  throw new Error(`Checksum file not found: ${checksumsPath}`);
}

const powershell = findPowerShell();
const smokePaths = prepareSmokePaths({ artifactPath, checksumsPath, powershell });
const args = [
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  toPowerShellPath(scriptPath, powershell),
  "-Artifact",
  smokePaths.artifact,
  "-Sha256Sums",
  smokePaths.checksums,
  "-RequireChecksumEntry",
  "-MinArtifactBytes",
  minArtifactBytes
];

if (process.env.HWPX_OPT_WINDOWS_SMOKE_ALL_MODES === "1") {
  args.push("-AllModes");
} else if (process.env.HWPX_OPT_SMOKE_MODE) {
  args.push("-Mode", process.env.HWPX_OPT_SMOKE_MODE);
}

if (process.env.HWPX_OPT_SMOKE_INPUT) {
  const samplePath = resolve(process.env.HWPX_OPT_SMOKE_INPUT);
  if (!existsSync(samplePath)) {
    throw new Error(`Smoke sample not found: ${samplePath}`);
  }
  args.push("-Sample", toPowerShellPath(samplePath, powershell));
}

const result = spawnSync(powershell, args, { stdio: "inherit", env: process.env });
if (result.error) throw result.error;
process.exitCode = result.status ?? (result.signal ? 1 : 0);

function findPowerShell() {
  if (process.platform === "win32") return "powershell";
  const candidates = [
    "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
    "powershell.exe",
    "pwsh"
  ];
  for (const candidate of candidates) {
    if (candidate.includes("/") && existsSync(candidate)) return candidate;
    const probe = spawnSync(candidate, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], {
      stdio: "ignore"
    });
    if (!probe.error) return candidate;
  }
  throw new Error("PowerShell is required for Windows portable smoke verification.");
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
  if (!isWindowsPowerShellFromWsl(input.powershell)) {
    return {
      artifact: toPowerShellPath(input.artifactPath, input.powershell),
      checksums: toPowerShellPath(input.checksumsPath, input.powershell)
    };
  }
  const tempRoot = windowsTempDirectory();
  if (!tempRoot) {
    throw new Error(
      "Windows portable smoke skipped: no writable Windows-visible temp directory. " +
        "Ensure /mnt/c/Temp is writable, or run on Windows. " +
        "Set HWPX_OPT_SKIP_WIN_PORTABLE_SMOKE=1 only when intentionally skipping."
    );
  }
  const smokeDir = join(tempRoot, `hwpx-optimizer-smoke-${process.pid}`);
  mkdirSync(smokeDir, { recursive: true });
  const artifactCopy = join(smokeDir, basename(input.artifactPath));
  const checksumsCopy = join(smokeDir, basename(input.checksumsPath));
  copyFileSync(input.artifactPath, artifactCopy);
  copyFileSync(input.checksumsPath, checksumsCopy);
  return {
    artifact: toPowerShellPath(artifactCopy, input.powershell),
    checksums: toPowerShellPath(checksumsCopy, input.powershell)
  };
}

function isWindowsPowerShellFromWsl(powershell) {
  return process.platform !== "win32" && powershell.endsWith(".exe");
}

function windowsTempDirectory() {
  for (const candidate of listWindowsTempCandidates()) {
    if (isWritableDirectory(candidate)) return candidate;
  }
  return undefined;
}

function listWindowsTempCandidates() {
  const candidates = [];
  // Prefer broadly writable Windows mounts before per-user TEMP (sandbox accounts
  // like CodexSandboxOffline often exist but deny mkdir).
  candidates.push("/mnt/c/Temp", "/mnt/c/Windows/Temp");
  const usersRoot = "/mnt/c/Users";
  if (existsSync(usersRoot)) {
    for (const userName of readdirSync(usersRoot).sort()) {
      if (/^(Default|Default User|Public|All Users|CodexSandboxOffline)$/i.test(userName)) continue;
      candidates.push(join(usersRoot, userName, "AppData", "Local", "Temp"));
    }
  }
  const cmd = existsSync("/mnt/c/Windows/System32/cmd.exe") ? "/mnt/c/Windows/System32/cmd.exe" : "cmd.exe";
  const temp = spawnSync(cmd, ["/c", "echo", "%TEMP%"], { encoding: "utf8" });
  if (temp.status === 0) {
    const converted = spawnSync("wslpath", ["-u", temp.stdout.trim()], { encoding: "utf8" });
    if (converted.status === 0) candidates.push(converted.stdout.trim());
  }
  return [...new Set(candidates.filter(Boolean))];
}

function isWritableDirectory(path) {
  try {
    mkdirSync(path, { recursive: true });
    const probe = join(path, `.hwpx-opt-write-${process.pid}`);
    mkdirSync(probe, { recursive: true });
    // Best-effort cleanup; ignore failures on sticky Windows temps.
    try {
      spawnSync("rmdir", [probe], { stdio: "ignore" });
    } catch {
      /* ignore */
    }
    return true;
  } catch {
    return false;
  }
}
