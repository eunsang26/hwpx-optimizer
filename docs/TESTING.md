# Testing

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

Automated smoke checks only confirm that Electron can create and load the app window. Before a desktop release, still run:

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
