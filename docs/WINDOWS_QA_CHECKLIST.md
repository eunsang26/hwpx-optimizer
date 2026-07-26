# Windows QA Checklist

This checklist verifies the release candidate on a clean Windows machine. It is required before calling the desktop utility product-ready.

## Scope

Verify that the Windows build runs locally, does not upload files, preserves the original HWPX file, rejects protected documents without bypass, stores no recent-file/history/log paths in the app, and can analyze, optimize, save, and verify optimized HWPX outputs.

## Prerequisites

- Clean Windows 10 or Windows 11 machine.
- Node.js 20 or newer, if running source-based checks.
- A local HWPX sample file. Do not commit sample files.
- A protected or signed HWPX-like test package, if available, for rejection-path confirmation. Do not use real confidential documents as test fixtures.
- A release artifact from `release/`, either:
  - `HWPX Optimizer-0.1.5-x64.zip` ZIP build, recommended for faster startup after one-time extraction,
  - `HWPX Optimizer-0.1.5-x64.exe` portable build, convenient but slower to start because it self-extracts at launch, or
  - the NSIS installer produced by `npm run release:check:win`.

## Artifact Integrity

From a PowerShell prompt in the project root:

```powershell
Get-FileHash ".\release\HWPX Optimizer-0.1.5-x64.exe" -Algorithm SHA256
Get-FileHash ".\release\HWPX Optimizer-0.1.5-x64.zip" -Algorithm SHA256
```

Compare the hash with `release/SHA256SUMS.txt`.

If the source tree is available, also run:

```powershell
npm run release:verify-manifest
```

Expected result:

- The checksum matches.
- Manifest verification exits with code 0.
- Packaged artifacts do not include source maps, type declarations, samples, generated reports, `settings.json`, recent-file/history records, logs, or smoke workspaces when `npm run release:verify-artifacts` is run from the source tree.

## Automated Portable Smoke

Run without a sample first:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/windows-portable-smoke.ps1
```

For the ZIP artifact, extract the ZIP first, open PowerShell in the extracted app folder, and run the same script. It will use `.\HWPX Optimizer.exe` by default.

Run with a real local HWPX sample:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/windows-portable-smoke.ps1 -Sample .\sample2.hwpx -Mode safe
powershell -ExecutionPolicy Bypass -File scripts/windows-portable-smoke.ps1 -Sample .\sample2.hwpx -Mode balanced
powershell -ExecutionPolicy Bypass -File scripts/windows-portable-smoke.ps1 -Sample .\sample2.hwpx -Mode aggressive
```

Run all modes with one command:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/windows-portable-smoke.ps1 -Sample .\sample2.hwpx -AllModes
```

Expected result:

- The printed SHA256 matches `release\SHA256SUMS.txt` when testing a release artifact directly. When testing the EXE inside an extracted ZIP, the script may warn that no checksum entry exists for the inner executable.
- The app launches.
- The smoke script exits with code 0.
- The optimized output passes verifier.

## Manual Desktop Workflow

1. Launch the portable executable or installed app.
2. Confirm the app opens without a terminal dependency.
3. Confirm the start screen says processing is local, the original is preserved, protected documents are not bypassed, and recent files/history/internal logs are not stored.
4. Drag and drop a local `.hwpx` file.
5. Confirm the analysis screen shows:
   - original file name,
   - original size,
   - image count,
   - BMP count,
   - metadata count,
   - unused resource candidates,
   - expected savings,
   - warnings.
6. Select `Safe` mode and run optimization.
7. Confirm the progress screen updates and does not freeze.
8. Confirm the result screen shows:
   - original size,
   - optimized size,
   - saving percentage,
   - applied/skipped/failed action summary,
   - output file action,
   - output folder action,
   - optional current-report action only when report saving is enabled.
9. Open the optimized file in Hancom Office or another HWPX-compatible viewer.
10. Confirm the original file timestamp and size did not change.
11. Repeat with `Balanced` mode.
12. Repeat with `Aggressive` mode only after acknowledging the quality warning.
13. Repeat the same file at least three times and confirm each output path is unique unless overwrite is explicitly enabled.
14. Repeat the workflow with at least one very large HWPX package.
15. Repeat the workflow with representative real-world documents that include mixed image formats and embedded resources.
16. Try a protected, signed, or encrypted test package and confirm the app rejects it with a message that it does not decrypt, bypass, or optimize protected documents.

Expected result:

- Original files are never modified in place.
- Protected documents are rejected without decryption, DRM bypass, or signature-preservation promises.
- Each output file opens.
- Repeated optimizations do not overwrite prior outputs by default.
- Very large packages complete or fail with a clear non-crashing error.
- Representative real-world documents do not expose missing-reference verifier failures.
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

- Non-sensitive settings persist locally.
- Output files are written to the selected folder during the current app session.
- The selected output folder is not restored after restart and is not written to `settings.json`.
- No recent files, processing history, result paths, report paths, or internal logs are restored after restart.
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
- Internal distribution evidence references `docs/INTERNAL_DISTRIBUTION.md` and `docs/SECURITY_REVIEW.md`.

Do not mark the product release complete if any item above is unverified.

## Evidence log — 2026-07-26 (v0.1.5 prerelease)

Environment: WSL2 + Windows-local `C:\Temp`, Node 24.13.0, self-signed Electron artifacts and CLI portable ZIP built from commit `a0ec3f0`.

| Check | Result | Notes |
|-------|--------|-------|
| Approved `#single-pass` desktop layout | Pass | 960px single-column Gauge First flow; optimization plan remains inside `세부 옵션`; Electron DOM/geometry smoke passed |
| Full test suite | Pass | 65 files, 429 passed, 1 skipped |
| Typecheck / build | Pass | Electron, CLI, core, and Tauri workspaces |
| Local sample regression corpus | Pass | 4/4, including `sample2.hwpx` and `sample3.hwpx` balanced optimization |
| Production dependency audit | Pass | 0 vulnerabilities at moderate+ under `--omit=dev`; 21 build/dev advisories documented |
| Electron artifact hygiene / native runtime / signature | Pass | EXE and ZIP clean; Windows `sharp` unpack verified; PE certificate table verified |
| Electron portable smoke `sample2.hwpx` AllModes | Pass | Windows-local copy passed safe, balanced, and aggressive through Windows PowerShell |
| CLI portable Windows smoke `sample2.hwpx` | Pass | optimize, verify, batch, dropped-file, and dropped-folder launchers; 82.99MiB / 92.50% saved |
| Combined release manifest | Pass | Three artifacts verified by `release:verify-manifest` |
| Electron EXE | Pass | 101,976,048 bytes; SHA256 `1bbd12e231a81452409c6dba5862a6c1f0290172909accb109bbaa9ad885d15b` |
| Electron ZIP | Pass | 148,685,751 bytes; SHA256 `d200bd385291aaf1e69a317ec38326dde84a2c1d714ec7f72dd1652e69aaad0d` |
| CLI Windows ZIP | Pass | 37,038,211 bytes; SHA256 `8e10d6e8b8bf0b703152bedd0db6cb5f6f6df43be32952d2be5e10b86eea45b3` |
| Open optimized output in Hancom | 미실시 | Hancom Office not installed in this environment |
| Clean institutional PC soak | 미실시 | Required before changing prerelease to final product-ready release |

## Evidence log — 2026-07-26 (v0.1.4 release candidate)

Environment: WSL2 + Windows-local `C:\Temp`, Node 20.20.2, self-signed Electron artifacts and CLI portable ZIP built from commit `a4a6f6c`.

| Check | Result | Notes |
|-------|--------|-------|
| Full test suite | Pass | 65 files, 429 passed, 1 skipped |
| Typecheck / build | Pass | Electron, CLI, core, and Tauri workspaces |
| Local sample regression corpus | Pass | 4/4, including `sample2.hwpx` and `sample3.hwpx` balanced optimization |
| Production dependency audit | Pass | 0 vulnerabilities at moderate+ under `--omit=dev`; 21 build/dev advisories documented |
| Electron artifact hygiene / native runtime / signature | Pass | EXE and ZIP clean; Windows `sharp` unpack verified; PE certificate table verified |
| Electron portable smoke `sample2.hwpx` AllModes | Pass | Final EXE passed safe, balanced, and aggressive through Windows PowerShell |
| CLI portable Windows smoke `sample2.hwpx` | Pass | optimize, verify, batch, dropped-file, and dropped-folder launchers; 82.99MiB / 92.50% saved |
| Combined release manifest | Pass | Three artifacts verified by `release:verify-manifest` |
| Electron EXE | Pass | 101,971,616 bytes; SHA256 `56559812749474ecf37b48bc628a5c55c9dd6246eef0e99967e8f8c77f9ca2bf` |
| Electron ZIP | Pass | 148,686,450 bytes; SHA256 `78b0871e95e35aa832d178344da526c2d067749681c269955b25bde7b4005db5` |
| CLI Windows ZIP | Pass | 37,038,211 bytes; SHA256 `86068faa186b3e5a1ff42213d3d234d0620343c8a52d0af9ac02dcdf6d06f1b3` |
| Open optimized output in Hancom | 미실시 | Hancom Office not installed in this environment |
| Clean institutional PC soak | 미실시 | Required before changing prerelease to final product-ready release |

## Evidence log — 2026-07-26 (quality tracks)

Environment: WSL2 + Windows-visible temp (`C:\Temp`), Node 20, packaged `HWPX Optimizer-0.1.2-x64.exe` from `release/`, plus source-built Electron smoke for post-0.1.2 code changes.

| Check | Result | Notes |
|-------|--------|-------|
| Artifact SHA256 vs `SHA256SUMS.txt` | Pass | Matched during portable smoke |
| Portable smoke synthetic (prior gate) | Pass | `release:check:win-portable` on 0.1.2 |
| Portable smoke `sample2.hwpx` safe | Pass | Drag/drop overlay + analysis-details regressions included |
| Portable smoke `sample2.hwpx` balanced | Pass | After wiring `HWPX_OPT_SMOKE_MODE`/`INPUT` into PS1 args |
| Portable smoke `sample2.hwpx` aggressive | Pass | Same wrapper path |
| Source `npm run desktop:smoke` (xvfb) | Pass | Includes quality-track Desktop build |
| Unit/integration `npm test` | Pass | 423 passed, 1 skipped |
| `npm run typecheck` | Pass | |
| Manual batch UI on packaged EXE | Partial | Automated smoke covers optimize path; full multi-select UI not separately filmed |
| Settings persistence / zero-history restart | 미실시 | Needs dedicated clean PC soak |
| Open optimized output in Hancom | 미실시 | Hancom not available in this environment |
| NSIS installer gate | Pass (CI) | `windows-release.yml` on `main` after audit fix |
| Institutional clean-PC sign-off | 미실시 | Documented remaining gap in `KNOWN_LIMITATIONS.md` |

## Evidence log — 2026-07-26 (v0.1.3)

Environment: WSL2 + `C:\Temp`, Node 20, artifact `HWPX Optimizer-0.1.3-x64.exe` (self-signed). Hancom Office not detected on this machine.

| Check | Result | Notes |
|-------|--------|-------|
| `release:check:win-portable` | Pass | Includes audit, pack, signature, manifest, smoke |
| SHA256 match | Pass | `f2a239cd…` EXE / `3b9eb440…` ZIP |
| Portable smoke `sample2.hwpx` AllModes | Pass | safe / balanced / aggressive |
| Open optimized output in Hancom | 미실시 | No Hnc/Hancom install found under Program Files |
| Clean institutional PC soak | 미실시 | Operator: extract ZIP on clean PC, drag/drop, restart, confirm no history |

### Operator checklist (Hancom / clean PC) — do manually

1. Extract `HWPX Optimizer-0.1.5-x64.zip` on a clean Windows 10/11 PC.
2. Drag/drop a real local `.hwpx`, run balanced, confirm original untouched.
3. Open `*_optimized.hwpx` in 한글(Hancom) and spot-check text/images/tables.
4. Restart app; confirm no recent-file/history restore.
5. Tick the corresponding rows above and attach hashes from `SHA256SUMS.txt` to the approval record.
