# Architecture

## Product Principles

HWPX Optimizer is built as a local utility. The core engine never needs a server, account, or network upload. The CLI and desktop app call the same TypeScript core package so optimization behavior stays consistent.

The original document is read-only input. Every optimization path writes a separate output buffer or output file.

## Workspace Layout

```text
packages/core
  HWPX ZIP reading, analysis, planning, optimization, writing, verification, reports

packages/cli
  hwpx-opt command line wrapper around packages/core

apps/desktop
  Electron shell, renderer UI, preload bridge, desktop file service

docs
  User, developer, testing, release, and limitation notes
```

## Core Flow

```text
input.hwpx
  -> readHwpxPackage
  -> analyzePackage
  -> buildReferenceGraph
  -> planSafeOptimization or advanced opportunity detection
  -> optimizeHwpxBufferSafe/Balanced/Aggressive
  -> writeHwpxPackage
  -> verifyHwpxOutput
  -> buildOptimizationReport
```

## Core Modules

### Reader

`packages/core/src/reader.ts`

- Opens HWPX as ZIP.
- Rejects invalid ZIP data.
- Rejects legacy binary HWP input with a clear message.
- Requires the minimum HWPX package structure: `Contents/content.hpf` and at least one `Contents/section*.xml`.
- Loads entries as buffers.
- Classifies XML, image, font, OLE, BinData, and other files.

### Analyzer

`packages/core/src/analyzer.ts`

- Calculates total size and category sizes.
- Builds image inventory.
- Extracts image format, dimensions, metadata flags, and BMP candidates.
- Detects byte-identical duplicate images by SHA-256.
- Detects same-visual duplicate images by exact decoded pixel hash across lossless encodings.
- Detects unreferenced BinData candidates. Validates content.hpf local declarations and explicit binaryItemIDRef resolution; deleting unused BinData removes its manifest declaration as part of the same operation.
- Reports font and OLE resources as risky resources. A shared removal policy preserves these resources in every mode, including caller-supplied plans.

### Image Display Analysis

`packages/core/src/imageDisplay.ts`

- Reads HWPX package manifest references.
- Locates `binaryItemIDRef` image references.
- Extracts display dimensions from picture size tags when present.
- Converts HWP units to a 96-DPI pixel estimate.
- Produces recommended pixel budgets for balanced and aggressive resizing.

### Reference Graph

`packages/core/src/referenceGraph.ts`

- Tracks internal package paths referenced by XML files.
- Resolves manifest ids, generic id-valued XML attributes, direct BinData paths, and relative or percent-encoded BinData paths.
- Marks referenced and unreferenced resources.
- Reports missing references.

### Planner

`packages/core/src/planner.ts`

- Creates a safe-mode action plan before mutation.
- Includes action type, target, and risk.
- Keeps unsafe work out of safe mode.

### Safe Optimizer

`packages/core/src/optimizer.ts`

- Minifies XML by parsing and serializing it.
- Strips JPEG metadata segments while preserving format and dimensions.
- Optimizes PNG where beneficial.
- Removes unreferenced BinData only after graph analysis.
- Skips an item if a specific optimization fails.

### Balanced and Aggressive Optimizers

`packages/core/src/balancedOptimizer.ts`
`packages/core/src/opportunities.ts`

- Convert BMP to PNG.
- Resize oversized JPEGs according to mode profile and display budgets.
- Optimize PNG resources.
- Clean shape-comment metadata.
- Consolidate byte-identical or exact same-visual duplicate image resources by redirecting XML image IDs to a canonical resource.
- Record applied and skipped actions.
- Update manifest `href` and `media-type` attributes through a parsed XML tree.

Balanced uses a less aggressive pixel and JPEG profile. Aggressive uses a stronger profile and marks higher visual-difference risk in reports.

### Writer

`packages/core/src/writer.ts`

- Repackages entries into an HWPX ZIP.
- Preserves internal paths.
- Uses DEFLATE compression level 9.

### Verifier

`packages/core/src/verifier.ts`

- Confirms the output ZIP opens.
- Confirms the minimum HWPX package structure is present.
- Confirms XML entries parse.
- Confirms referenced internal resources exist.
- Compares original and output packages when a mode policy is provided. Document XML parts retain text, element order, and layout/style attributes; each resource use is compared in its original position. Attribute order and known structural formatting may differ. Allowed changes are unused-resource manifest deletion, exact duplicate aliasing, supported image conversion, and generated shape-comment filename/dimension lines. Authored alternative text remains intact.
- Preserves opaque package parts, fonts, and embedded objects byte-for-byte. Accepted legacy inputs may gain the canonical mimetype marker.
- Unknown ID reference forms prevent duplicate consolidation; style/paragraph IDs are never reassigned as binary IDs.
- Rejects safe-mode outputs that change referenced image dimensions or format.
- Rejects changed safe-mode referenced image bytes unless decoded pixel and alpha hashes remain equal and EXIF orientation is unchanged. Protected image representations must remain byte-identical, including when exact duplicates are aliased.
- Rejects balanced/aggressive outputs that remove referenced images without an allowed replacement. The optimizer records actual original/output paths and manifest IDs, composes duplicate aliases with later conversions, and passes the resulting mappings to verification and the optimization report. Serialized XML uses must agree with those mappings.
- Rejects balanced/aggressive image conversions outside the current policy: BMP may become PNG, JPEG must remain JPEG, and PNG must remain PNG.
- Rejects balanced/aggressive outputs that enlarge referenced image dimensions.
- Rejects balanced/aggressive outputs whose referenced image PSNR and SSIM scores fall below the per-mode quality thresholds.

Decoded image reuse retains RGB or RGBA channels. Same-visual hashes include alpha, canonicalizing fully opaque RGBA to RGB only for hashing. Advanced quality samples retain alpha and compare composites over both dark and light backgrounds, using the lower score. Images with ICC profiles, high sample precision, multiple frames/pages, unsupported BMP alpha or oriented PNG metadata retain their original bytes and report a reason.

XML handling supports UTF-8 only and rejects invalid UTF-8 or other declared encodings before optimization. Literal line endings/attribute whitespace and numeric character references follow [XML 1.0 normalization](https://www.w3.org/TR/xml/#AVNormalize); serializers preserve referenced control characters.

Current limitation: advanced mode verification uses PSNR and SSIM on 512×512 aspect-preserving (`fit: contain`) samples plus structural invariants; it does not prove every visual detail is perceptually identical. BMP/TIFF→PNG is allowed in advanced modes; JPEG stays JPEG and PNG stays PNG.

### Report

`packages/core/src/report.ts`

- Builds JSON report objects.
- Includes sizes, image inventory, duplicate groups, unused BinData, risky resources, opportunities, warnings, and applied/skipped actions. Advanced successful outputs include `resourceMappings`; image actions carry the actual `outputPath`. A rollback to the original does not retain mappings for discarded changes. Image previews receive report mappings; older reports recover identities from stable manifest IDs and XML use positions rather than extension guesses.

## CLI Boundary

`packages/cli/src/index.ts`

The CLI performs filesystem work and user-facing terminal output. It does not own HWPX parsing or optimization logic.

Commands:

- `analyze`
- `report`
- `verify`
- `optimize`
- `batch`

Batch writes use a private `.hwpx-optimizer-batch.lock` workspace in the output folder. It contains staging files and a process ownership record; a second active batch targeting the same canonical folder is rejected. Recovery only removes recorded, unchanged zero-byte reservations belonging to an exited process, along with that private workspace. Generic `.tmp` files and unrecorded files are never swept. Unrecognized lock directories are preserved and reported for inspection.

## Desktop Boundary

`apps/desktop/src/main/desktopService.ts`

The desktop file service is the testable boundary for:

- Reading selected files.
- Calling core analysis and optimization functions.
- Choosing output paths.
- Writing optimized HWPX files and reports.
- Preventing overwrite when configured.

Selected inputs are protected even when output overwrite is enabled. The main process keeps canonical input paths and filesystem identities in memory and forwards them with each optimization request, retaining protection after document worker restarts. The service checks document and report destinations before writing and keeps previously analyzed input identities separate from its bounded input-buffer cache. Generated results can be overwritten only when they have not subsequently been selected as inputs.

`apps/desktop/src/main.ts` owns Electron window and IPC wiring. `apps/desktop/src/preload.ts` exposes a narrow bridge to the renderer. `apps/desktop/src/renderer.ts` owns DOM updates and user interaction.

The runtime preload script is copied from `apps/desktop/src/preload.cjs` so Electron loads a CommonJS preload file reliably under the app's ESM package settings. `apps/desktop/src/preload.ts` remains the TypeScript API shape used by renderer code.

Analysis and optimization run through `apps/desktop/src/main/documentWorker.ts`, a persistent Node worker thread that keeps large HWPX processing off the Electron main process. The main process relays coarse progress messages to the renderer and can terminate the active document operation when the user cancels.

## Safety Rules

- Never overwrite the original input file.
- Do not delete referenced resources.
- Do not create an output if verification fails.
- Keep safe mode free of resizing, lossy JPEG changes, BMP conversion, font changes, OLE changes, style rewrites, and layout recalculation.
- If behavior is uncertain, skip the action and report a warning.
