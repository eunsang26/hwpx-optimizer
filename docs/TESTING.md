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

Real user sample files must not be committed. Root-level `sample*.hwpx`, `sample*.hwp`, `sample*.json`, and `sample*.txt` are ignored.

## Manual Desktop Checks

Manual GUI checks are not yet automated. Before a desktop release, run:

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
