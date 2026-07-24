param(
  [Parameter(Mandatory = $true)]
  [string]$ZipPath,
  [string]$Sample = "",
  [ValidateSet("safe", "balanced", "aggressive")]
  [string]$Mode = "balanced"
)

$ErrorActionPreference = "Stop"

function Invoke-Checked {
  param(
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$Label
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed with exit code $LASTEXITCODE"
  }
}

if (-not (Test-Path -LiteralPath $ZipPath -PathType Leaf)) {
  throw "CLI portable zip not found: $ZipPath"
}

$resolvedZip = (Resolve-Path -LiteralPath $ZipPath).Path
$resolvedSample = ""
if ($Sample -ne "") {
  if (-not (Test-Path -LiteralPath $Sample -PathType Leaf)) {
    throw "Sample HWPX not found: $Sample"
  }
  if ([System.IO.Path]::GetExtension($Sample) -ine ".hwpx") {
    throw "Sample must be an HWPX file: $Sample"
  }
  $resolvedSample = (Resolve-Path -LiteralPath $Sample).Path
}

$smokeRoot = Join-Path ([System.IO.Path]::GetTempPath()) "hwpx-cli-portable-smoke-$PID-$([guid]::NewGuid().ToString('N'))"
$extractRoot = Join-Path $smokeRoot "extracted"
$previousNoPause = $env:HWPX_OPT_NO_PAUSE

try {
  New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null
  Expand-Archive -LiteralPath $resolvedZip -DestinationPath $extractRoot -Force

  $root = Join-Path $extractRoot "hwpx-opt-win-x64"
  if (-not (Test-Path -LiteralPath $root -PathType Container)) {
    $root = $extractRoot
  }

  $node = Join-Path $root "node\node.exe"
  $cli = Join-Path $root "app\cli\dist\index.js"
  $launcher = Join-Path $root "hwpx-opt.cmd"
  $dropHere = Join-Path $root "drop-here.bat"
  foreach ($requiredPath in @($node, $cli, $launcher, $dropHere)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
      throw "Required portable file not found after extraction: $requiredPath"
    }
  }

  $env:HWPX_OPT_NO_PAUSE = "1"

  Invoke-Checked -FilePath $node -Arguments @($cli, "list-actions") -Label "Packaged node list-actions"

  Push-Location $root
  try {
    Invoke-Checked -FilePath $env:ComSpec -Arguments @("/d", "/c", "hwpx-opt.cmd list-actions") -Label "hwpx-opt.cmd list-actions"
  } finally {
    Pop-Location
  }

  if ($resolvedSample -eq "") {
    Write-Host "No sample HWPX supplied; optimize, verify, and batch checks skipped."
  } else {
    $sampleRoot = Join-Path $smokeRoot "sample"
    New-Item -ItemType Directory -Path $sampleRoot -Force | Out-Null
    $sampleCopy = Join-Path $sampleRoot ([System.IO.Path]::GetFileName($resolvedSample))
    Copy-Item -LiteralPath $resolvedSample -Destination $sampleCopy
    $reportPath = Join-Path $smokeRoot "smoke.report.json"

    Invoke-Checked -FilePath $node -Arguments @(
      $cli,
      "optimize",
      $sampleCopy,
      "--mode",
      $Mode,
      "--report",
      $reportPath
    ) -Label "Packaged node optimize"

    $optimizedPath = Join-Path $sampleRoot "$([System.IO.Path]::GetFileNameWithoutExtension($sampleCopy)).optimized.hwpx"
    if (-not (Test-Path -LiteralPath $optimizedPath -PathType Leaf)) {
      throw "Optimized HWPX was not created: $optimizedPath"
    }
    if (-not (Test-Path -LiteralPath $reportPath -PathType Leaf)) {
      throw "Optimization report was not created: $reportPath"
    }

    Invoke-Checked -FilePath $node -Arguments @($cli, "verify", $optimizedPath) -Label "Packaged node verify"

    $batchRoot = Join-Path $smokeRoot "batch"
    $batchOutput = Join-Path $batchRoot "optimized"
    New-Item -ItemType Directory -Path $batchRoot -Force | Out-Null
    Copy-Item -LiteralPath $resolvedSample -Destination (Join-Path $batchRoot ([System.IO.Path]::GetFileName($resolvedSample)))
    Invoke-Checked -FilePath $node -Arguments @(
      $cli,
      "batch",
      $batchRoot,
      "--mode",
      $Mode,
      "--out",
      $batchOutput
    ) -Label "Packaged node batch"

    $batchOutputs = @(Get-ChildItem -LiteralPath $batchOutput -Filter "*.optimized.hwpx" -File)
    if ($batchOutputs.Count -lt 1) {
      throw "Batch smoke did not create an optimized HWPX in: $batchOutput"
    }

    $dropSampleRoot = Join-Path $smokeRoot "drop-file"
    New-Item -ItemType Directory -Path $dropSampleRoot -Force | Out-Null
    $dropSampleCopy = Join-Path $dropSampleRoot ([System.IO.Path]::GetFileName($resolvedSample))
    Copy-Item -LiteralPath $resolvedSample -Destination $dropSampleCopy
    Push-Location $root
    try {
      Invoke-Checked -FilePath $env:ComSpec -Arguments @("/d", "/c", "drop-here.bat", $dropSampleCopy) -Label "drop-here.bat optimize file"
    } finally {
      Pop-Location
    }
    $dropOptimizedPath = Join-Path $dropSampleRoot "$([System.IO.Path]::GetFileNameWithoutExtension($dropSampleCopy)).optimized.hwpx"
    if (-not (Test-Path -LiteralPath $dropOptimizedPath -PathType Leaf)) {
      throw "drop-here.bat did not create optimized output beside the sample: $dropOptimizedPath"
    }
    $dropReportBesideSample = Get-ChildItem -LiteralPath $dropSampleRoot -Filter "*.report.json" -File -ErrorAction SilentlyContinue
    if ($dropReportBesideSample.Count -gt 0) {
      throw "drop-here.bat should not leave report JSON beside the sample in: $dropSampleRoot"
    }

    $dropBatchRoot = Join-Path $smokeRoot "drop-folder"
    $dropBatchOutput = Join-Path $dropBatchRoot "optimized"
    New-Item -ItemType Directory -Path $dropBatchRoot -Force | Out-Null
    Copy-Item -LiteralPath $resolvedSample -Destination (Join-Path $dropBatchRoot ([System.IO.Path]::GetFileName($resolvedSample)))
    Push-Location $root
    try {
      Invoke-Checked -FilePath $env:ComSpec -Arguments @("/d", "/c", "drop-here.bat", $dropBatchRoot) -Label "drop-here.bat batch folder"
    } finally {
      Pop-Location
    }
    $dropBatchOutputs = @(Get-ChildItem -LiteralPath $dropBatchOutput -Filter "*.optimized.hwpx" -File)
    if ($dropBatchOutputs.Count -lt 1) {
      throw "drop-here.bat batch did not create optimized output in: $dropBatchOutput"
    }
  }

  Write-Host "CLI portable smoke passed: $resolvedZip"
} finally {
  if ($null -eq $previousNoPause) {
    Remove-Item Env:\HWPX_OPT_NO_PAUSE -ErrorAction SilentlyContinue
  } else {
    $env:HWPX_OPT_NO_PAUSE = $previousNoPause
  }
  Remove-Item -LiteralPath $smokeRoot -Recurse -Force -ErrorAction SilentlyContinue
}
