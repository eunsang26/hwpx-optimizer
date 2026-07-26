# Release

## Release Goals

The release target is a local Windows desktop utility plus a CLI built from the same core engine.

Release requirements:

- CLI runs locally.
- Desktop app runs locally.
- No server upload.
- No login, account, billing, cloud storage, or telemetry.
- Original files are preserved.
- Protected documents are not decrypted, bypassed, or optimized.
- Desktop stores no recent files, processing history, output folder path, or internal logs.
- Optimized outputs pass verifier.
- README commands work on a clean checkout.
- Known blockers and non-blockers are documented.
- Internal distribution review documents are maintained.

For company distribution, include [Internal Distribution Guide](INTERNAL_DISTRIBUTION.md) and
[Security Review Checklist](SECURITY_REVIEW.md) in the release evidence package.

## Build Commands

Install dependencies:

```bash
npm install
```

Build all TypeScript projects and copy desktop renderer assets:

```bash
npm run build
```

Generate desktop icon resources:

```bash
npm run desktop:icons
```

Run the CLI from source:

```bash
npm run cli -- analyze input.hwpx
```

Start desktop from the built main process:

```bash
npm run desktop:start
```

Create an unpacked desktop build for the current platform:

```bash
npm run desktop:pack
```

The packaging scripts generate desktop icon resources under `build/` before invoking electron-builder. They also store Electron downloads under the project-local `.npm-cache/electron` directory. This avoids relying on a writable home-directory cache in locked-down environments.

Create an unpacked Windows x64 folder from Linux/WSL without executable resource editing:

```bash
npm run desktop:pack:win
```

Create a Windows x64 portable executable from Linux/WSL without NSIS:

```bash
npm run desktop:portable:win
```

Create a Windows x64 ZIP distribution for faster startup after one-time extraction:

```bash
npm run desktop:zip:win
```

Create both local Windows artifacts in one packaging pass:

```bash
npm run desktop:local:win
```

Create a Windows x64 installer build:

```bash
npm run desktop:dist:win
```

On Linux/WSL, the NSIS installer build requires `wine`. If `wine` is unavailable, use `desktop:local:win` for a Windows portable `.exe` artifact plus a ZIP distribution, or `desktop:pack:win` for a Windows unpacked folder build, then create the NSIS installer on a Windows release machine or a Linux environment with Wine configured.

For user-facing downloads, prefer the ZIP artifact when startup speed matters. The portable single EXE is convenient, but it must unpack the app payload to a temporary directory at launch. The ZIP is extracted once by the user, so launching `HWPX Optimizer.exe` inside the extracted folder avoids that repeated self-extraction cost.

## CLI Portable Windows ZIP

Build a lightweight Windows x64 CLI distribution (bundled `node.exe`, built CLI/core, win32 `sharp`, and launchers) from Linux/WSL:

```bash
npm run build:win-portable
```

Artifacts:

- `release/hwpx-opt-win-x64.zip`
- `release/hwpx-opt-win-x64.SHA256SUMS.txt` (zip-only checksum from the build script)

When `release:manifest` runs after a CLI portable build, the CLI ZIP is also included in the shared release files:

- `release/release-manifest.json`
- `release/SHA256SUMS.txt`
- `release/RELEASE_NOTICE_<version>.txt`

Verify ZIP structure, dependency tree, and launcher scripts on Linux:

```bash
npm run release:verify-cli-portable
```

Do not claim Windows runtime support until the Windows end-to-end smoke passes:

```bash
npm run release:verify-cli-portable-smoke
```

This gate uses `scripts/cli-portable-smoke.ps1` and is separate from the Electron portable smoke (`scripts/windows-portable-smoke.ps1`).

Closed-network build: pass a local Node win-x64 zip via `--node-zip <path>` or `HWPX_OPT_NODE_ZIP`, and use a populated npm cache or internal mirror for dependency installation.

Consolidated Linux release gate for the CLI portable ZIP (build, artifact hygiene, structure verify, host JS smoke):

```bash
npm run release:check:cli-portable
```

The Linux gate does **not** replace the Windows end-to-end smoke above. Once `.github/workflows/cli-portable-release.yml` is active, CI enforces Windows runtime support on `windows-latest`: the `cli-portable-windows-smoke` job downloads the Linux-built ZIP artifact, writes a **synthetic minimal HWPX** via `scripts/cli-portable/writeMinimalHwpx.mjs`, and runs `npm run release:verify-cli-portable-smoke`. That synthetic sample validates native `node.exe`, win32 `sharp`, launchers, and the optimize/verify path without committing private documents.

For real-document QA before internal distribution, run the same smoke locally with a private sample:

```bash
HWPX_OPT_SMOKE_INPUT=sample2.hwpx npm run release:verify-cli-portable-smoke
```

Root-level `sample*.hwpx` files stay local-only and are not uploaded to CI. A green Linux gate alone is insufficient for a Windows support claim once the workflow ships.

The gate uses `npm run release:audit` (`scripts/release-audit.mjs`), matching `release:preflight`. That check requires a clean **production** dependency tree (`npm audit --omit=dev --audit-level=moderate`). Packaging/dev advisories under `electron-builder` / `@electron/asar` / `esbuild` may still appear in a full `npm audit` and are documented in [Known Limitations](KNOWN_LIMITATIONS.md); they do not block the gate because they are not shipped in the optimized HWPX runtime.

GitHub Actions runs the CI-safe Linux gate on `ubuntu-latest` (`release:check:cli-portable:ci`) and the Windows smoke job on `windows-latest` via `.github/workflows/cli-portable-release.yml`. Tag builds and manual runs with `upload_artifact: true` upload the ZIP, zip-only checksum file, shared `release-manifest.json`, `SHA256SUMS.txt`, and `RELEASE_NOTICE_<version>.txt`.

## Verification Before Release

Run:

```bash
npm test
npm run typecheck
npm run build
electron_config_cache=.npm-cache/electron npx electron --version
```

Or run the consolidated local release gate:

```bash
npm run release:check
```

This gate checks release hygiene, tests, typecheck, build, audit, desktop smoke, current-platform unpacked packaging, and Windows unpacked packaging. It does not replace the final Windows installer build or clean Windows install test.

On a Windows release machine or Windows CI runner, run:

```bash
npm run release:check:win
```

This gate builds the Windows NSIS installer through `desktop:dist:win`.

On Linux/WSL without Wine, run the portable Windows release gate:

```bash
npm run release:check:win-portable:self-signed
```

This gate builds `release/HWPX Optimizer-<version>-x64.exe` as a self-signed portable Windows artifact and `release/HWPX Optimizer-<version>-x64.zip` as a faster-starting extracted-folder distribution. It verifies that packaged artifacts do not contain development files or user-history files, verifies that the Windows `sharp` native runtime files are unpacked outside `app.asar`, verifies the Windows PE Authenticode certificate table, writes `release/release-manifest.json`, `release/SHA256SUMS.txt`, and `release/RELEASE_NOTICE_<version>.txt`, and verifies that the checksum files and release notice match the artifacts. It does not replace a clean Windows runtime test.

The package also includes `TERMS.txt` with the producer, permitted-use, self-signed-status, SHA256-check, warranty-disclaimer, and user-responsibility notice. The generated release notice must repeat the artifact SHA256 values, self-signed status, permitted-use terms, warranty disclaimer, and user responsibility. It must also state that optimized outputs must be reviewed by the user before submission, distribution, or retention, and that final use responsibility remains with the user.

To verify the native Windows image runtime layout on an existing Windows build:

```bash
npm run release:verify-win-native
```

This check requires the following files to exist under `release/win-unpacked/resources/app.asar.unpacked`:

- `node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64-0.35.3.node`
- `node_modules/@img/sharp-win32-x64/lib/libvips-cpp-8.18.3.dll`
- `node_modules/@img/sharp-win32-x64/lib/libvips-42.dll`

On a Windows machine, smoke-test the portable artifact:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/windows-portable-smoke.ps1
powershell -ExecutionPolicy Bypass -File scripts/windows-portable-smoke.ps1 -Sample sample2.hwpx -Mode balanced
powershell -ExecutionPolicy Bypass -File scripts/windows-portable-smoke.ps1 -Sample sample2.hwpx -AllModes
```

For the ZIP artifact, extract `HWPX Optimizer-<version>-x64.zip`, open PowerShell in the extracted folder, and run the same script. The script defaults to `.\HWPX Optimizer.exe` when it is present.

Use [Windows QA Checklist](WINDOWS_QA_CHECKLIST.md) for the full clean-machine manual and CLI verification pass before treating a Windows artifact as product-ready.

For internal release approval, also confirm that protected HWPX files are rejected without decryption or bypass and that the app start screen states the local-only/original-preserving/security-document policy.

Also run the artifact hygiene check after packaging:

```bash
npm run release:verify-artifacts
```

This check inspects `app.asar` and the Windows ZIP, when present, and fails if they contain source maps, type declarations, tests, docs, git/editor metadata, samples, generated reports, optimized outputs, `settings.json`, recent-file/history records, logs, or smoke workspaces.

If the portable artifact already exists and only the checksum files need to be refreshed:

```bash
npm run release:manifest
```

Verify an existing manifest, checksum file, and release notice against the artifact:

```bash
npm run release:verify-manifest
```

The repository also includes `.github/workflows/windows-release.yml`, which runs the CI-safe Windows packaging gate on `workflow_dispatch` and `v*` tags. CLI portable ZIP builds use `.github/workflows/cli-portable-release.yml`: Linux assembly (`release:check:cli-portable:ci`) plus a `windows-latest` smoke job that exercises the uploaded ZIP with a synthetic HWPX. CI never uses private real HWPX samples because root-level `sample*.hwpx` files are not committed. Run the sample-backed `npm run release:check:win` or self-signed `npm run release:check:win-portable` in a local QA environment before product-ready Electron approval; for CLI portable, optionally re-run `HWPX_OPT_SMOKE_INPUT=sample*.hwpx npm run release:verify-cli-portable-smoke` locally before internal distribution. Manual `workflow_dispatch` runs skip artifact upload by default to avoid Actions storage quota failures; set the `upload_artifact` input to `true` when an uploaded artifact is needed. Tag builds upload the generated artifacts.

Then verify at least one HWPX end-to-end:

```bash
npm run cli -- analyze sample2.hwpx --report sample2.release-analysis.json
npm run cli -- optimize sample2.hwpx --mode safe --out sample2.safe.optimized.hwpx
npm run cli -- verify sample2.safe.optimized.hwpx
```

Sample files and generated sample reports are local-only and ignored by git.

## Desktop Packaging Status

The project has an `electron-builder` configuration and scripts for unpacked desktop builds and Windows x64 installer builds.

Before treating a build as releasable:

1. Run `npm run desktop:pack`.
2. Launch the unpacked app on the target platform.
3. Verify the app can analyze and optimize a local HWPX file.
4. Run `npm run desktop:pack:win` to confirm a Windows unpacked folder can be generated.
5. Run `npm run desktop:local:win:self-signed` to create both the self-signed portable EXE and the faster-starting ZIP artifact.
6. Run `npm run release:verify-artifacts`.
7. Run `scripts/windows-portable-smoke.ps1` on a clean Windows machine.
8. Complete [Windows QA Checklist](WINDOWS_QA_CHECKLIST.md) on a clean Windows machine.
9. Attach [Internal Distribution Guide](INTERNAL_DISTRIBUTION.md), [Security Review Checklist](SECURITY_REVIEW.md), SHA256 checksums, and test evidence to the internal approval record.
10. Run `npm run desktop:dist:win` on a Windows release machine or a verified Wine-enabled cross-build environment when an NSIS installer is required.
11. Use `npm run desktop:local:win:self-signed` or the self-signed release gate for internal distribution. When an organization/public-CA PFX is available, set `HWPX_WIN_CSC_LINK` and `HWPX_WIN_CSC_KEY_PASSWORD` (aliases: `CSC_LINK`, `CSC_KEY_PASSWORD`) before the same scripts; omit them to keep the self-signed path.
12. Install or launch the generated artifact on a clean Windows machine.

Suggested future scripts:

```json
{
  "desktop:dist:linux": "npm run build && electron-builder --linux",
  "desktop:dist:mac": "npm run build && electron-builder --mac"
}
```

## Versioning

Until the first user-ready release, keep package versions at `0.x`. Use clear release notes that separate:

- Safe mode support.
- Balanced mode support.
- Aggressive mode support.
- Desktop app status.
- Known limitations.

## Artifact Rules

Do not include:

- User sample HWPX/HWP documents.
- Generated optimization outputs.
- Generated report JSON or text files.
- Local `결과/` output folders.
- Local Electron caches.
- Source maps, TypeScript declaration files, test files, git/editor metadata, user settings, recent-file/history records, logs, smoke workspaces, or docs in packaged desktop artifacts.

Do include:

- Source code.
- Tests.
- Documentation.
- Lockfile.
- Release configuration once packaging is added.

Generated release artifacts, checksum files, and `RELEASE_NOTICE_<version>.txt` live under `release/` and are ignored by git.
