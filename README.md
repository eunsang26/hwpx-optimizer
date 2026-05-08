# HWPX Optimizer

HWPX Optimizer is a free local utility for analyzing and reducing HWPX document size while preserving the original file. It provides a shared TypeScript core engine, a CLI, and an Electron desktop app scaffold.

The project is intentionally local-only:

- No server upload.
- No login, account, billing, cloud storage, or telemetry.
- The input file is never modified in place.
- Optimized output defaults to `<original>.optimized.hwpx`.
- JSON reports are written next to the optimized output unless disabled by the desktop settings.

## Current Status

Implemented:

- Core HWPX ZIP reader and entry classifier.
- Package analysis for XML, BinData, images, fonts, OLE, and other files.
- Image inventory with format, byte size, dimensions, metadata flag, BMP candidates, display-size references, duplicate groups, and oversize hints.
- Conservative reference graph for internal package resources.
- Safe, balanced, and aggressive optimization modes.
- CLI commands for analyze, report, verify, optimize, and batch.
- Electron desktop app scaffold with file selection, drag/drop, analysis, mode selection, optimize, result links, and local settings.
- Vitest coverage for core, CLI, and desktop service/view-model behavior.

Not complete yet:

- Desktop packaging for Windows installers.
- GUI smoke tests on a real display session.
- Full mode-aware verifier comparison between original and optimized packages.
- Broader HWPX reference graph coverage for uncommon XML reference forms.
- Worker/process separation for long-running desktop optimization.

See [Known Limitations](docs/KNOWN_LIMITATIONS.md) for the current blocker and non-blocker list.

## Requirements

- Node.js 20 or newer.
- npm.
- A platform supported by `sharp` and `electron`.

Install dependencies:

```bash
npm install
```

Electron downloads are cached under the project-local `.npm-cache/electron` path when needed:

```bash
electron_config_cache=.npm-cache/electron node node_modules/electron/install.js
```

## CLI Usage

Run the CLI through the workspace script during development:

```bash
npm run cli -- analyze input.hwpx
```

Analyze a document and write a JSON report:

```bash
npm run cli -- analyze input.hwpx --report input.report.json
```

Create a human-readable report:

```bash
npm run cli -- report input.hwpx --out input.report.txt
```

Optimize with safe mode:

```bash
npm run cli -- optimize input.hwpx --mode safe
```

Optimize with balanced mode:

```bash
npm run cli -- optimize input.hwpx --mode balanced
```

Optimize with aggressive mode:

```bash
npm run cli -- optimize input.hwpx --mode aggressive --out output.hwpx
```

Run only selected advanced actions:

```bash
npm run cli -- optimize input.hwpx --mode balanced --actions resize-jpeg,optimize-png
```

Allow an individual optimized resource to be kept even if it becomes larger:

```bash
npm run cli -- optimize input.hwpx --mode balanced --allow-larger
```

Verify an HWPX output:

```bash
npm run cli -- verify output.hwpx
```

Batch optimize all `.hwpx` files in a directory:

```bash
npm run cli -- batch ./docs --mode safe --out ./optimized
```

Batch mode continues after per-file failures and writes `batch-report.json` in the output directory.

## Desktop Usage

Build the app assets:

```bash
npm run build
```

Start the Electron desktop app:

```bash
npm run desktop:start
```

Desktop flow:

1. Drop an HWPX file or select one with `Choose File`.
2. Review the analysis metrics and warnings.
3. Select `Safe`, `Balanced`, or `Aggressive`.
4. Run optimization.
5. Open the optimized file or reveal the output folder.

Settings are stored only on the local machine through Electron's user data path.

## Optimization Modes

Safe mode is intended for low-risk local cleanup:

- ZIP repack.
- XML minify.
- JPEG metadata stripping where format and dimensions remain unchanged.
- PNG optimization when lossless and beneficial.
- Removal of unreferenced BinData.
- No resizing.
- No JPEG quality reduction.
- No BMP conversion.

Balanced mode targets the common large-document causes:

- Safe mode actions.
- BMP to PNG conversion.
- Oversized JPEG resizing by display-size budget when detectable.
- JPEG quality around 88.
- PNG optimization.
- Shape-comment metadata cleanup.
- Duplicate image reference consolidation.

Aggressive mode prioritizes file size:

- Balanced mode actions.
- Stronger image pixel budget.
- JPEG quality around 80.
- PNG palette optimization.
- Duplicate image reference consolidation.
- Higher chance of visible image differences.

The analyzer reports opportunities before optimization so users can see why the file is large and which work is expected to save the most space.

## Development

Run targeted tests first when editing a focused area:

```bash
npm test -- packages/core/test/optimizer.test.ts
```

Run the full verification set before committing:

```bash
npm test
npm run typecheck
npm run build
```

Sample user documents should stay local. The repository ignores root-level `sample*.hwpx`, `sample*.hwp`, `sample*.json`, and `sample*.txt` files.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Testing](docs/TESTING.md)
- [Release](docs/RELEASE.md)
- [Known Limitations](docs/KNOWN_LIMITATIONS.md)
