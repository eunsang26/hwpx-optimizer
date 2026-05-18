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
  } elseif (Test-Path -LiteralPath ".\HWPX Optimizer-0.1.0-x64.exe") {
    $Artifact = ".\HWPX Optimizer-0.1.0-x64.exe"
  } else {
    $Artifact = "release\HWPX Optimizer-0.1.0-x64.exe"
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
    $env:HWPX_OPT_SMOKE_INPUT = (Resolve-Path -LiteralPath $Sample).Path
  } else {
    Remove-Item Env:\HWPX_OPT_SMOKE_INPUT -ErrorAction SilentlyContinue
  }

  foreach ($currentMode in $modes) {
    $env:HWPX_OPT_SMOKE_MODE = $currentMode
    Write-Host "Running desktop smoke: mode=$currentMode"
    $process = Start-Process -FilePath $artifactPath -ArgumentList "--smoke-test" -Wait -PassThru
    if ($process.ExitCode -ne 0) {
      throw "Desktop smoke failed with exit code $($process.ExitCode) for mode $currentMode"
    }
    Write-Host "Desktop smoke passed: $artifactPath ($currentMode)"
    Write-Host "  - Includes full-window drag/drop overlay regression"
    Write-Host "  - Includes analysis-details width and help manual regression"
  }
} finally {
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
