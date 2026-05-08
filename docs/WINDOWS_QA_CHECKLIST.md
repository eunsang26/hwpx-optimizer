# Windows QA Checklist

This checklist verifies the release candidate on a clean Windows machine. It is required before calling the desktop utility product-ready.

## Scope

Verify that the Windows build runs locally, does not upload files, preserves the original HWPX file, and can analyze, optimize, save, and verify optimized HWPX outputs.

## Prerequisites

- Clean Windows 10 or Windows 11 machine.
- Node.js 20 or newer, if running source-based checks.
- A local HWPX sample file. Do not commit sample files.
- A release artifact from `release/`, either:
  - `HWPX Optimizer-0.1.0-x64.exe` portable build, or
  - the NSIS installer produced by `npm run release:check:win`.

## Artifact Integrity

From a PowerShell prompt in the project root:

```powershell
Get-FileHash ".\release\HWPX Optimizer-0.1.0-x64.exe" -Algorithm SHA256
```

Compare the hash with `release/SHA256SUMS.txt`.

If the source tree is available, also run:

```powershell
npm run release:verify-manifest
```

Expected result:

- The checksum matches.
- Manifest verification exits with code 0.

## Automated Portable Smoke

Run without a sample first:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/windows-portable-smoke.ps1
```

Run with a real local HWPX sample:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/windows-portable-smoke.ps1 -Sample .\sample2.hwpx -Mode safe
powershell -ExecutionPolicy Bypass -File scripts/windows-portable-smoke.ps1 -Sample .\sample2.hwpx -Mode balanced
powershell -ExecutionPolicy Bypass -File scripts/windows-portable-smoke.ps1 -Sample .\sample2.hwpx -Mode aggressive
```

Expected result:

- The app launches.
- The smoke script exits with code 0.
- The optimized output passes verifier.

## Manual Desktop Workflow

1. Launch the portable executable or installed app.
2. Confirm the app opens without a terminal dependency.
3. Drag and drop a local `.hwpx` file.
4. Confirm the analysis screen shows:
   - original file name,
   - original size,
   - image count,
   - BMP count,
   - metadata count,
   - unused resource candidates,
   - expected savings,
   - warnings.
5. Select `Safe` mode and run optimization.
6. Confirm the progress screen updates and does not freeze.
7. Confirm the result screen shows:
   - original size,
   - optimized size,
   - saving percentage,
   - applied/skipped/failed action summary,
   - output file action,
   - output folder action,
   - report action.
8. Open the optimized file in Hancom Office or another HWPX-compatible viewer.
9. Confirm the original file timestamp and size did not change.
10. Repeat with `Balanced` mode.
11. Repeat with `Aggressive` mode only after acknowledging the quality warning.

Expected result:

- Original files are never modified in place.
- Each output file opens.
- Safe mode preserves image formats and dimensions.
- Balanced and aggressive modes report visible-risk actions clearly.
- Failed individual actions appear as skipped or failed without crashing the app.

## Settings Workflow

1. Open Settings.
2. Change default mode.
3. Set an output folder.
4. Toggle report saving.
5. Toggle overwrite prevention.
6. Close and reopen the app.

Expected result:

- Settings persist locally.
- Output files are written to the configured folder when selected.
- Overwrite prevention creates a suffixed output path instead of replacing an existing file.

## CLI Checks On Windows

From the project root:

```powershell
npm install
npm test
npm run typecheck
npm run build
npm run cli -- analyze .\sample2.hwpx --report .\sample2.windows-analysis.json
npm run cli -- optimize .\sample2.hwpx --mode safe --out .\sample2.safe.optimized.hwpx --report .\sample2.safe.report.json
npm run cli -- verify .\sample2.safe.optimized.hwpx
npm run cli -- optimize .\sample2.hwpx --mode balanced --out .\sample2.balanced.optimized.hwpx --report .\sample2.balanced.report.json
npm run cli -- verify .\sample2.balanced.optimized.hwpx
npm run cli -- optimize .\sample2.hwpx --mode aggressive --out .\sample2.aggressive.optimized.hwpx --report .\sample2.aggressive.report.json
npm run cli -- verify .\sample2.aggressive.optimized.hwpx
```

Expected result:

- All commands exit with code 0.
- Reports are generated.
- Verifier passes for all optimized outputs.
- Sample files and generated reports remain untracked.

## Installer Release Gate

On a Windows release machine or Windows CI runner:

```powershell
npm install
npm run release:check:win
```

Expected result:

- Tests pass.
- Typecheck passes.
- Build passes.
- Desktop smoke passes.
- NSIS installer artifact is generated under `release/`.

## Pass Criteria

Windows QA passes only when:

- Portable or installed app launches on a clean Windows machine.
- Manual desktop workflow passes with at least one real HWPX file.
- CLI analyze, optimize, and verify pass on Windows.
- Original file preservation is confirmed.
- Generated output opens in an HWPX-compatible viewer.
- Any blocker is documented in `docs/KNOWN_LIMITATIONS.md`.

Do not mark the product release complete if any item above is unverified.
