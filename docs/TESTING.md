# Testing

## Pull Request and Windows CI

Use Node **22.12.0 or newer** locally; `.nvmrc` and `.node-version` select **24.21.0**. Node 20 is not supported by the current toolchain. The PR matrix tests both the minimum supported runtime (22.12.0) and the pinned development runtime (24.21.0).

`.github/workflows/pr-checks.yml` runs for every pull request, pushes to `main`, and merge queue groups, including documentation changes and draft PRs. Linux jobs independently run `npm ci`, prepare fixed-version Windows sharp binary fixtures for PE/stage tests in an isolated npm prefix (Linux does not execute those binaries), then run repository hygiene, all tests (two workers), typecheck, build, the synthetic regression corpus, and the real Electron smoke under Xvfb. Before smoke, the disposable hosted runner downloads the pinned Electron binary and sets its SUID sandbox helper to root:root/4755, as required by the [Chromium helper contract](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/linux/suid_sandbox_development.md); CI does not pass `--no-sandbox` or modify the application sandbox settings. A failure stops the remaining steps of that job; matrix jobs run independently. A newer revision cancels superseded runs for the same event/ref.

The same workflow calls `cli-portable-release.yml` on Windows/Node 24.21.0. It runs all tests, typecheck, build, the shipped-runtime audit, builds the CLI ZIP with the Windows sharp native runtime, verifies extracted package/native files and the manifest, then executes the actual portable CLI's optimize/verify/batch/launcher smoke with a generated HWPX. Uploads are explicitly disabled. The separate Windows desktop release workflow runs on version tags or manual dispatch and additionally verifies the actual packaged desktop offline, including its font and native runtime. These are build/runtime checks, not evidence of Hancom or institutional-PC manual QA.

PR and `main` checks use read-only repository permissions, no inherited secrets, and no artifact upload steps. The reusable Windows workflow uploads only for a `v*` tag push or an explicit manual upload request; a `main` push calling it cannot upload artifacts. CI uses generated documents; never pass private samples, reports, screenshots, or local output directories to CI. Release uploads retain explicit file allowlists. Neither workflow enables network-dependent document processing.

Repository rules must select the Linux matrix and Windows native/portable checks if merges should require them; adding the workflows does not itself configure branch protection. Checkout/setup-node actions are pinned to their verified v6 commit SHAs and run on Node 24 independently of the project's Node matrix ([checkout](https://github.com/actions/checkout/tree/v6), [setup-node](https://github.com/actions/setup-node/tree/v6)). Merge queue triggering follows the [GitHub event contract](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#merge_group).

## Test Commands

Run a targeted test while developing:

```bash
npm test -- packages/core/test/optimizer.test.ts
```

Run all tests:

```bash
npm test
```

Run TypeScript project checks:

```bash
npm run typecheck
```

Run the full build:

```bash
npm run build
```

Electron version check when the local cache is required:

```bash
electron_config_cache=.npm-cache/electron npx electron --version
```

Desktop smoke test with a real display session:

```bash
npm run desktop:smoke
```

Desktop smoke test in Linux headless environments with Xvfb:

```bash
xvfb-run -a npm run desktop:smoke
```

Desktop smoke test with a local real HWPX sample:

```bash
HWPX_OPT_SMOKE_INPUT=sample2.hwpx npm run desktop:smoke
```

Desktop smoke test with a local real HWPX sample and a non-safe mode:

```bash
HWPX_OPT_SMOKE_INPUT=sample2.hwpx HWPX_OPT_SMOKE_MODE=balanced npm run desktop:smoke
HWPX_OPT_SMOKE_INPUT=sample2.hwpx HWPX_OPT_SMOKE_MODE=aggressive npm run desktop:smoke
```

## Current Coverage

Core tests cover:

- Valid HWPX ZIP reading.
- Invalid ZIP failures.
- Legacy binary HWP rejection.
- Entry classification.
- Package analysis.
- Reference graph construction.
- Safe optimization planning.
- Safe optimizer output.
- Balanced image conversion and resizing behavior.
- Aggressive image profile behavior.
- Report shape.

CLI tests cover:

- `analyze`
- `optimize`
- `report`
- `verify`
- `batch`
- Invalid file handling.

Desktop tests cover:

- Analysis view model metrics.
- Result view model metrics.
- Desktop file service analysis.
- Output path generation.
- Non-overwrite naming.
- Report saving.
- Verification call path.

Desktop smoke tests cover:

- Electron main process startup.
- Renderer asset loading.
- Renderer initialization through the preload bridge.
- Required desktop APIs including optimize progress and cancel.
- Synthetic HWPX analysis through renderer-to-main IPC, or a local real HWPX when `HWPX_OPT_SMOKE_INPUT` is set.
- Safe optimization through the desktop worker thread by default, or balanced/aggressive when `HWPX_OPT_SMOKE_MODE` is set.
- Verification of the optimized output through the renderer API.

The smoke test uses a synthetic local HWPX under `.tmp/electron-smoke` by default. When `HWPX_OPT_SMOKE_INPUT` is set, the app copies that local file into `.tmp/electron-smoke` for the run. `HWPX_OPT_SMOKE_MODE` can be `safe`, `balanced`, or `aggressive`; invalid values fall back to `safe`. It does not upload data, and sample files remain ignored by git.

The smoke additionally runs 11 named workflow regressions in `apps/desktop/src/main/workflowSmoke.ts`. They use actual visible DOM controls, the sandboxed preload, IPC handlers and the production worker, covering selection/addition/removal, single/batch cancellation and retry, selected-only batch completion, and document/aggregate report write failures. Each case verifies original/sentinel SHA-256 hashes; cancellation/reset cases compare the entire directory tree. Completed pairs are cross-verified against the original document and checked against measured report sizes. `desktop-workflow-complete` is emitted only after every case passes. Deliberate cancellation and blocked report paths produce expected handled IPC errors in the logs; the process must still exit zero with both workflow and final smoke completion markers.

The UI cancellation gate pauses delivery after the real worker returns, before publication, making UI/IPC ordering deterministic. Separate Vitest `documentCancellation.test.ts` tests pause real worker CPU phases and asynchronous filesystem operations to prove termination, rollback, timeout and restart behavior. Static repository tests retain manifest, packaging, version and privacy configuration checks; UI state is verified by execution rather than renderer source snippets. `documentController.test.ts` exercises the extracted controller with a real worker and filesystem, including grants, earlier-input protection after worker recreation, forged report paths and close ordering. `workflowState.test.ts` runs DOM-free cancellation/stale-finalizer, retry and batch-budget/quality scenarios. The whole desktop smoke is now loaded through `main/smoke/runtime.ts` in smoke mode only. See [workflow evidence and scope](DESKTOP_WORKFLOW_TESTS_2026-10-15.md).

## Fixture Strategy

Synthetic HWPX fixtures live in `packages/core/test/fixtures.ts`. They build ZIP packages with controlled XML and resource entries.

Fixture categories still needed for broader product confidence:

- Text-only HWPX.
- PNG and JPEG HWPX.
- BMP HWPX.
- EXIF-heavy JPEG HWPX.
- Unused BinData HWPX.
- Duplicate image HWPX.
- Large image HWPX.
- OLE HWPX.
- Embedded font HWPX.
- Broken or malformed HWPX.

Real user sample files and local optimization outputs must not be committed. Root-level `sample*.hwpx`, `sample*.hwp`, `sample*.json`, `sample*.txt`, and `결과/` are ignored.

## Manual Desktop Checks

Automated smoke checks exercise synthetic workflows and failure recovery. Visual fidelity in Hancom and target-machine integration still require manual checks. Before a desktop release, run:

1. `npm run build`
2. `npm run desktop:start`
3. Select a valid `.hwpx` file.
4. Confirm analysis metrics render.
5. Run safe optimization.
6. Confirm output file is created next to the original by default.
7. Confirm report JSON is created when enabled.
8. Confirm `Open File` and `Show Folder` work on the target OS.
9. Repeat with balanced and aggressive modes on disposable copies.

## Pre-Commit Gate

Before committing code or documentation:

```bash
npm test
npm run typecheck
npm run build
```

If a command fails, fix the cause or document the blocker before committing.
