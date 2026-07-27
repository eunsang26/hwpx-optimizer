param(
  [string]$Artifact = "",
  [string]$Sample = "",
  [ValidateSet("safe", "balanced", "aggressive")]
  [string]$Mode = "safe",
  [switch]$AllModes,
  [string]$Sha256Sums = "",
  [switch]$RequireChecksumEntry,
  [string]$ExpectedSha256 = "",
  [long]$MinArtifactBytes = 0
)

$ErrorActionPreference = "Stop"

if ($Artifact -eq "") {
  if (Test-Path -LiteralPath ".\HWPX Optimizer.exe") {
    $Artifact = ".\HWPX Optimizer.exe"
  } else {
    $packageJson = Join-Path $PSScriptRoot "..\package.json"
    $version = $null
    if (Test-Path -LiteralPath $packageJson) {
      $version = (Get-Content -LiteralPath $packageJson -Raw | ConvertFrom-Json).version
    }
    $candidates = @()
    if ($version) {
      $candidates += ".\HWPX Optimizer-$version-x64.exe"
      $candidates += "release\HWPX Optimizer-$version-x64.exe"
    }
    $candidates += @(Get-ChildItem -Path @(".", "release") -Filter "HWPX Optimizer-*-x64.exe" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | ForEach-Object { $_.FullName })
    $Artifact = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
    if (-not $Artifact) {
      throw "Portable artifact not found. Pass -Artifact or build release/HWPX Optimizer-<version>-x64.exe first."
    }
  }
}

if (-not (Test-Path -LiteralPath $Artifact)) {
  throw "Portable artifact not found: $Artifact"
}

$artifactPath = (Resolve-Path -LiteralPath $Artifact).Path
$artifactName = Split-Path -Path $artifactPath -Leaf
$artifactDir = Split-Path -Path $artifactPath -Parent
$artifactSize = (Get-Item -LiteralPath $artifactPath).Length
if ($MinArtifactBytes -gt 0 -and $artifactSize -lt $MinArtifactBytes) {
  throw "Portable artifact is smaller than required minimum. Got $artifactSize bytes; minimum $MinArtifactBytes bytes."
}
$artifactHash = (Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host "Artifact: $artifactPath"
Write-Host "Size:       $artifactSize bytes"
Write-Host "SHA256:   $artifactHash"

if ($ExpectedSha256 -ne "") {
  $normalizedExpectedSha256 = $ExpectedSha256.ToLowerInvariant()
  if ($normalizedExpectedSha256 -ne $artifactHash) {
    throw "ExpectedSha256 mismatch. Expected $normalizedExpectedSha256 but got $artifactHash."
  }
  Write-Host "Expected: matched explicit SHA256"
}

if ($Sha256Sums -eq "") {
  $localSums = Join-Path $artifactDir "SHA256SUMS.txt"
  if (Test-Path -LiteralPath $localSums) {
    $Sha256Sums = $localSums
  } else {
    $Sha256Sums = "release\SHA256SUMS.txt"
  }
}

if (Test-Path -LiteralPath $Sha256Sums) {
  $expectedLine = Get-Content -LiteralPath $Sha256Sums | Where-Object { $_ -match "\s+$([regex]::Escape($artifactName))$" } | Select-Object -First 1
  if ($expectedLine) {
    $expectedHash = ($expectedLine -split "\s+")[0].ToLowerInvariant()
    if ($expectedHash -ne $artifactHash) {
      throw "Artifact hash mismatch. Expected $expectedHash but got $artifactHash."
    }
    Write-Host "Checksum: matched $Sha256Sums"
  } else {
    if ($RequireChecksumEntry) {
      throw "No checksum entry found for $artifactName in $Sha256Sums"
    }
    Write-Warning "No checksum entry found for $artifactName in $Sha256Sums"
  }
} else {
  if ($RequireChecksumEntry) {
    throw "Checksum file not found: $Sha256Sums"
  }
  Write-Warning "Checksum file not found: $Sha256Sums"
}

$previousInput = $env:HWPX_OPT_SMOKE_INPUT
$previousMode = $env:HWPX_OPT_SMOKE_MODE
$modes = if ($AllModes) { @("safe", "balanced", "aggressive") } else { @($Mode) }

try {
  if ($Sample -ne "") {
    if (-not (Test-Path -LiteralPath $Sample)) {
      throw "Sample HWPX not found: $Sample"
    }
    $env:HWPX_OPT_SMOKE_INPUT = (Resolve-Path -LiteralPath $Sample).ProviderPath
  } else {
    Remove-Item Env:\HWPX_OPT_SMOKE_INPUT -ErrorAction SilentlyContinue
  }

  foreach ($currentMode in $modes) {
    $env:HWPX_OPT_SMOKE_MODE = $currentMode
    # Packaged Electron rejects unknown --flags as Chromium options; use env trigger.
    $env:HWPX_OPT_SMOKE_TEST = "1"
    Write-Host "Running desktop smoke: mode=$currentMode"
    $artifactDirectory = Split-Path -Parent $artifactPath
    $stdoutPath = Join-Path $artifactDirectory "desktop-smoke.stdout.log"
    $stderrPath = Join-Path $artifactDirectory "desktop-smoke.stderr.log"
    Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
    $process = Start-Process `
      -FilePath $artifactPath `
      -WorkingDirectory $artifactDirectory `
      -RedirectStandardOutput $stdoutPath `
      -RedirectStandardError $stderrPath `
      -Wait `
      -PassThru
    if ($process.ExitCode -ne 0) {
      if (Test-Path -LiteralPath $stdoutPath) {
        Write-Host "Desktop smoke stdout:"
        Get-Content -LiteralPath $stdoutPath | Write-Host
      }
      if (Test-Path -LiteralPath $stderrPath) {
        Write-Host "Desktop smoke stderr:"
        Get-Content -LiteralPath $stderrPath | Write-Host
      }
      throw "Desktop smoke failed with exit code $($process.ExitCode) for mode $currentMode"
    }
    Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
    Write-Host "Desktop smoke passed: $artifactPath ($currentMode)"
    Write-Host "  - Includes full-window drag/drop overlay regression"
    Write-Host "  - Includes analysis-details width and help manual regression"
  }
} finally {
  Remove-Item Env:\HWPX_OPT_SMOKE_TEST -ErrorAction SilentlyContinue
  if ($null -eq $previousInput) {
    Remove-Item Env:\HWPX_OPT_SMOKE_INPUT -ErrorAction SilentlyContinue
  } else {
    $env:HWPX_OPT_SMOKE_INPUT = $previousInput
  }

  if ($null -eq $previousMode) {
    Remove-Item Env:\HWPX_OPT_SMOKE_MODE -ErrorAction SilentlyContinue
  } else {
    $env:HWPX_OPT_SMOKE_MODE = $previousMode
  }
}
