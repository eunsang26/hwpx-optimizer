# Changelog

All notable changes are documented here. Dates are local to the project (KST).

## Unreleased

## 0.1.9 — 2026-07-27

### Fixed

- Reduced the Windows desktop default content size from 960×720 to 800×560 and the minimum size to 720×520, while retaining the larger user-resizable maximum.
- Centralized desktop window dimensions and extended Electron smoke coverage to verify the default and minimum layouts without horizontal overflow.

## 0.1.8 — 2026-07-27

### Changed

- The shipped product is Windows-only: Electron and CLI portable builds run and verify on `windows-latest`, while packaged Electron builds reject non-Windows platforms.
- Removed the experimental desktop shell, Node sidecar, Rust workspace, generated icons, packaging scripts, tests, and workflow jobs that were no longer part of the product.
- Reduced Windows Electron payload duplication and excluded non-Windows native image runtimes from the ASAR.
- Reworked batch summary aggregation to avoid repeatedly scanning the full batch for every rendered row.

### Fixed

- Windows artifact inspection now normalizes ASAR paths consistently and rejects duplicate core runtimes or non-Windows native binaries.
- Windows portable smoke uses a writable Windows working directory, preserves WSL UNC sample paths, captures failure logs, and restores its batch policy so repeated mode runs remain deterministic.
- Removed obsolete renderer event handling and redundant batch rendering work.

## 0.1.4 — 2026-07-26

### Fixed

- Balanced and aggressive optimization now compose the safe structural baseline: XML minification and conservative unused BinData removal are applied alongside image optimization instead of being silently omitted.
- Structural cleanup protects duplicate-image members and treats embedded font/OLE resources conservatively.
- CLI projected savings now use ZIP-aware package estimates, preventing opportunity entry totals from overstating savings beyond the input package size.
- Release tests no longer rewrite the tracked benchmark fixture, and Electron smoke starts from a clean temporary state.
- Image-encoding and CLI batch integration tests use explicit bounded timeouts, avoiding false failures under parallel release-gate load.

### Changed

- Desktop workspace now matches the approved two-column Gauge Target Planner mockup: the workflow stays on the left, the optimization plan remains visible on the right, and verification details span the bottom.
- Fresh Desktop and browser-preview defaults are aligned to balanced mode, a 40MB per-file target, and five visible plan actions.
- All shipped version sources now resolve to `0.1.4`, including Electron, CLI, core, and npm lockfile metadata.

### Added

- CLI `hwpx-opt --version` and `hwpx-opt version` commands expose the embedded engine version.
- Repository regression coverage prevents release version sources from drifting apart.
- Electron smoke can capture a local release-layout screenshot through `HWPX_OPT_SMOKE_SCREENSHOT`.

### Added

- PSNR (Peak Signal-to-Noise Ratio) estimation for each image preview pair. The compare modal now shows a per-pair PSNR badge with a Korean tier (동일 / 매우 좋음 / 좋음 / 보통 / 차이 인지 / 측정 불가). Computed in `packages/core/src/imagePreview.ts` via 256×256 raw-pixel resampling; capped at 80 dB. Exposed `computePsnr()` for direct callers.
- Before/after image comparison modal: balanced/aggressive results expose an "이미지 비교" button. The renderer asks the main process for perceptual thumbnails (8×8-derived JPEG data URLs) of each modified image pair, sorted by saving size, and renders them side-by-side with format and byte deltas. Backed by `extractImageDiffPreviews()` in `packages/core/src/imagePreview.ts`.
- Renderer pure-helper modules: `apps/desktop/src/shared/labels.ts`, `format.ts`, `batchView.ts`, `templates.ts`. The renderer now delegates HTML composition, status labels, batch summarization, and item meta text to these modules so they can be unit-tested independently of the DOM.
- Unit tests for shared label and format helpers (`labels.test.ts`, `format.test.ts`), batch summary helpers (`batchView.test.ts`), and HTML template builders (`templates.test.ts`).
- Desktop multi-file batch UI: drag multiple `.hwpx` files (or use the new "여러 파일" / "폴더 선택" buttons) to queue them. Each file shows pending/running/done/failed/cancelled status, optional saving summary, and per-row open/folder/report shortcuts. Cancellation aborts the in-flight worker and marks remaining items as cancelled.
- Desktop opportunityGroup checkboxes: balanced and aggressive modes show selectable actions with risk and visual-impact badges. "전체 선택 / 해제 / 기본값으로" controls + per-mode default state. Renderer passes the selected `actions` array through IPC to the core optimizer; safe mode hides the panel since the core ignores `actions` there.
- Desktop category breakdown chart in the analysis panel: horizontal bars for image / xml / font / ole / bindata / other with byte and percentage labels.
- Desktop "다시 검증" button on the result panel: re-runs `verifyHwpxOutput` against the saved output and surfaces success/failure as a status message.
- CLI `list-actions` command listing every `--actions` key with description, applicable modes, risk, and visual impact.
- IPC: `dialog:select-hwpx-many`, `dialog:select-hwpx-folder` for multi-file/folder selection.
- Desktop drag-and-drop now resolves file paths via Electron `webUtils.getPathForFile`, restoring drop support on Electron 32+ where `File.path` was removed.
- Visual similarity verification (final form): balanced and aggressive modes compute PSNR for each referenced image pair and reject outputs whose PSNR falls below the per-mode minimum (balanced 18 dB, aggressive 14 dB). Earlier documented/experimental 8×8 average-hash gating was too coarse for detail-heavy natural photos, so the release gate now uses PSNR (raw pixel signal-to-noise ratio) instead. The reject error includes width/height, format, and EXIF orientation to make catastrophic regressions self-explanatory. The aHash building block remains in `packages/core/src/visualSimilarity.ts` (renamed to `computeAverageHash` with accurate docstring) for future near-duplicate candidate listing.
- HWPX zip-slip defense: `readHwpxPackage` rejects entries whose path contains `..`, `.`, drive letters, leading slash, or empty segments. Exposed `isSafePackagePath` helper for tests.
- Desktop "이미 최적화된 파일" warning when the user opens a file matching `*.optimized(-N)?.hwpx`.
- CLI `batch` now prints per-file progress lines and records a `stage` field on failed entries (`read-input`, `optimize`, `resolve-output-path`, `write-output`, `write-report`).
- Shared `mapLimit` concurrency helper (`packages/core/src/concurrency.ts`).
- Manifest-parsing module (`packages/core/src/manifest.ts`) with shared `extractManifestItems`, `buildManifestPathById`, `parseTagAttributes`.
- XML-node type-guard utilities (`packages/core/src/xmlNode.ts`) consolidating prior `:@` casts.

### Changed

- JPEG output media-type is now `image/jpeg` (was `image/jpg`).
- `applyBalancedOptimizationPlan` runs image transforms with `mapLimit(4)` concurrency. Order-preserving assembly retained.
- `optimize.ts` rollback path returns the original input buffer instead of `Buffer.from(input)` (no 90 MB copy on rollback).
- `repack-zip` now appears in `report.actions.applied` with `beforeSize`/`afterSize` so the report's planned/applied sets stay consistent.
- `analyzeHwpxPackage(pkg, { graph? })` accepts a precomputed reference graph; `verifier` and `optimize` reuse the cached graph instead of rebuilding it.
- Desktop settings panel hides the configured output directory while "원본 파일 옆에 저장" is enabled, eliminating contradictory state.
- `detectOptimizationOpportunities` and `detectEstimatedOptimizationOpportunities` share a single `collectOpportunities(pkg, profile, confidence)` implementation.
- `desktopService.nextOutputPath` is now async (uses `fs.promises.access`).

### Documentation

- `docs/KNOWN_LIMITATIONS.md` updated: visual-similarity check and zip-slip defense moved to verified infrastructure; remaining blockers tightened to manual Windows QA, reference-graph coverage, and continuous quality drift metrics.

### Tests

- Regression test for `clean-shape-comment` applied tracking when manifest references change.
- Regression tests for CLI batch `stage` reporting and `--allow-larger` propagation.
- Unit tests for `isSafePackagePath`.

## 0.1.0 — 2026-05-08

Initial unreleased baseline.

- Core engine: HWPX reader, analyzer, planner, safe/balanced/aggressive optimizers, writer, verifier, reports.
- CLI: `analyze`, `report`, `verify`, `optimize`, `batch`.
- Desktop: Electron app with file selection, drag-and-drop, analysis, mode selection, optimization with progress and cancel, results, and settings.
- Build artifacts: Windows unpacked, Windows portable EXE, Windows ZIP, NSIS installer.
