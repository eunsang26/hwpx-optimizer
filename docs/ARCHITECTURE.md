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
- Loads entries as buffers.
- Classifies XML, image, font, OLE, BinData, and other files.

### Analyzer

`packages/core/src/analyzer.ts`

- Calculates total size and category sizes.
- Builds image inventory.
- Extracts image format, dimensions, metadata flags, and BMP candidates.
- Detects duplicate images by hash.
- Detects unreferenced BinData candidates.
- Reports font and OLE resources as risky resources.

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
- Marks referenced and unreferenced resources.
- Reports missing references.

Current limitation: graph detection is conservative and partially pattern-based. It should be expanded as more real-world HWPX reference forms are collected.

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
- Confirms XML entries parse.
- Confirms referenced internal resources exist.
- Compares original and output packages when a mode policy is provided.
- Rejects safe-mode outputs that change referenced image dimensions or format.

Current limitation: advanced mode verification is still intentionally broad. It allows image conversion and resizing, but should eventually enforce more precise balanced/aggressive policy checks for allowed conversions, output dimensions, and reference updates.

### Report

`packages/core/src/report.ts`

- Builds JSON report objects.
- Includes sizes, image inventory, duplicate groups, unused BinData, risky resources, opportunities, warnings, and applied/skipped actions.

## CLI Boundary

`packages/cli/src/index.ts`

The CLI performs filesystem work and user-facing terminal output. It does not own HWPX parsing or optimization logic.

Commands:

- `analyze`
- `report`
- `verify`
- `optimize`
- `batch`

## Desktop Boundary

`apps/desktop/src/main/desktopService.ts`

The desktop file service is the testable boundary for:

- Reading selected files.
- Calling core analysis and optimization functions.
- Choosing output paths.
- Writing optimized HWPX files and reports.
- Preventing overwrite when configured.

`apps/desktop/src/main.ts` owns Electron window and IPC wiring. `apps/desktop/src/preload.ts` exposes a narrow bridge to the renderer. `apps/desktop/src/renderer.ts` owns DOM updates and user interaction.

## Safety Rules

- Never overwrite the original input file.
- Do not delete referenced resources.
- Do not create an output if verification fails.
- Keep safe mode free of resizing, lossy JPEG changes, BMP conversion, font changes, OLE changes, style rewrites, and layout recalculation.
- If behavior is uncertain, skip the action and report a warning.
