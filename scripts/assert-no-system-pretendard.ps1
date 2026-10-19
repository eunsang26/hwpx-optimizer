# Read-only clean-runner preflight. Never install/uninstall fonts to make a test pass.
$ErrorActionPreference = "Stop"
$registryMatches = 0
foreach ($key in @(
  "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts",
  "HKCU:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts"
)) {
  if (Test-Path -LiteralPath $key) {
    $item = Get-Item -LiteralPath $key
    foreach ($name in $item.GetValueNames()) {
      if ($name -match "Pretendard" -or [string]$item.GetValue($name) -match "Pretendard") {
        $registryMatches += 1
      }
    }
  }
}
$fileMatches = 0
foreach ($folder in @(
  (Join-Path $env:WINDIR "Fonts"),
  (Join-Path $env:LOCALAPPDATA "Microsoft\Windows\Fonts")
)) {
  if (Test-Path -LiteralPath $folder) {
    $fileMatches += @(Get-ChildItem -LiteralPath $folder -File | Where-Object { $_.Name -match "Pretendard" }).Count
  }
}
if ($registryMatches -gt 0 -or $fileMatches -gt 0) {
  throw "Cannot prove a clean font environment: Pretendard is already installed ($registryMatches registry / $fileMatches files)."
}
@{ check = "no-system-pretendard"; registryMatches = $registryMatches; fileMatches = $fileMatches } | ConvertTo-Json -Compress
