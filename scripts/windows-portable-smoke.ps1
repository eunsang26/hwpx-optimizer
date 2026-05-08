param(
  [string]$Artifact = "release\HWPX Optimizer-0.1.0-x64.exe",
  [string]$Sample = "",
  [ValidateSet("safe", "balanced", "aggressive")]
  [string]$Mode = "safe"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $Artifact)) {
  throw "Portable artifact not found: $Artifact"
}

$artifactPath = (Resolve-Path -LiteralPath $Artifact).Path
$previousInput = $env:HWPX_OPT_SMOKE_INPUT
$previousMode = $env:HWPX_OPT_SMOKE_MODE

try {
  if ($Sample -ne "") {
    if (-not (Test-Path -LiteralPath $Sample)) {
      throw "Sample HWPX not found: $Sample"
    }
    $env:HWPX_OPT_SMOKE_INPUT = (Resolve-Path -LiteralPath $Sample).Path
  } else {
    Remove-Item Env:\HWPX_OPT_SMOKE_INPUT -ErrorAction SilentlyContinue
  }

  $env:HWPX_OPT_SMOKE_MODE = $Mode
  & $artifactPath --smoke-test
  if ($LASTEXITCODE -ne 0) {
    throw "Desktop smoke failed with exit code $LASTEXITCODE"
  }

  Write-Host "Desktop smoke passed: $artifactPath ($Mode)"
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
