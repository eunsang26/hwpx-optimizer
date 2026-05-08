# HWPX Optimizer Design

Date: 2026-05-08
Status: Draft for review

## Goal

Build a free local utility that reduces HWPX document size while preserving the visible document form as much as possible. The first release focuses on conservative, low-risk optimizations and produces clear analysis and change reports.

The final product shape is a local CLI plus a desktop app. The CLI and desktop app share the same core optimization engine.

## Product Shape

- Local-only utility.
- No server upload.
- No login, account, billing, cloud storage, or telemetry.
- Original files are never modified in place.
- Optimized files are written next to the original file unless the user provides an output path.
- Default output name: `<original>.optimized.hwpx`.

## v1 Scope

v1 supports only `safe` mode.

### Analyze

The analyzer reads an HWPX package and reports:

- ZIP/package validity.
- Internal file list and size by category.
- XML files.
- BinData files.
- Image files.
- Image format.
- Image byte size.
- Pixel dimensions when detectable.
- EXIF or metadata presence when detectable.
- BMP image candidates.
- Unreferenced BinData candidates.
- Total document size.
- Estimated safe savings where practical.

### Optimize Safe Mode

Safe mode may perform:

- ZIP repacking with stronger compression.
- XML minification that preserves XML semantics.
- EXIF and non-essential image metadata removal where the image can be rewritten without changing dimensions or quality settings.
- PNG/JPEG lossless optimization only when pixel dimensions, image format, and visible use are preserved.
- Removal of unreferenced BinData files after reference graph validation.

Safe mode does not perform:

- Pixel resizing.
- JPEG quality reduction.
- PNG color reduction.
- BMP to PNG conversion.
- Image reference deduplication.
- Font removal or replacement.
- OLE conversion or removal for referenced objects.
- Style ID rewrites.
- Page layout recalculation.
- Text, table, paragraph, margin, section, or visible shape edits.

## Future Scope

### v2 Balanced Mode

Balanced mode may add:

- BMP to PNG conversion.
- Oversized image resizing based on visible document size.
- JPEG quality 85-90 as an explicit option.
- Duplicate image reference consolidation.
- More detailed HTML report.

### v3 Aggressive Mode

Aggressive mode may add:

- Stronger image resizing.
- JPEG quality 75-85.
- PNG palette/color optimization.
- Larger visual-difference warnings.
- Optional before/after rendering comparison if a reliable renderer is available.

## Architecture

```text
packages/core
  HwpxReader
  PackageAnalyzer
  ReferenceGraphBuilder
  OptimizationPlanner
  SafeOptimizer
  HwpxWriter
  Verifier
  ReportGenerator

packages/cli
  hwpx-opt analyze
  hwpx-opt optimize
  hwpx-opt batch

apps/desktop
  Electron UI, added after the CLI/core are stable
```

The core package owns all HWPX parsing, resource analysis, optimization, verification, and report generation. The CLI and desktop app are thin wrappers around the core.

## Data Flow

```text
Input HWPX
  -> read ZIP entries
  -> classify XML, BinData, images, fonts, OLE, other files
  -> parse XML files
  -> build resource reference graph
  -> create optimization plan
  -> execute safe actions in a temporary workspace
  -> verify optimized package
  -> write output HWPX
  -> write JSON report
```

## Core Components

### HwpxReader

Responsibilities:

- Confirm the input is a readable ZIP package.
- Load entries without modifying the source file.
- Preserve internal paths.
- Classify files by path and detected content type.

### PackageAnalyzer

Responsibilities:

- Identify XML, BinData, image, font, OLE, and miscellaneous entries.
- Extract image metadata such as format, dimensions, size, and metadata presence.
- Detect BMP candidates.
- Feed XML documents into the reference graph builder.

### ReferenceGraphBuilder

Responsibilities:

- Parse XML files with a real XML parser.
- Identify resource references to internal package paths and BinData IDs.
- Mark resources as referenced or unreferenced.
- Detect missing target files.

String-only replacement is not allowed for reference updates. XML must be parsed and serialized through a structured XML layer when modification is required.

### OptimizationPlanner

Responsibilities:

- Produce a plan before changing files.
- Assign each action a risk level.
- Exclude actions outside the selected mode.
- Estimate savings where cheap and reliable.

v1 only emits safe-mode actions.

### SafeOptimizer

Responsibilities:

- Execute the safe plan in a temporary workspace.
- Preserve image dimensions.
- Preserve image format unless a future mode explicitly allows conversion.
- Skip a failed item instead of failing the whole document when the original package can remain valid.
- Record every applied, skipped, and failed action.

### HwpxWriter

Responsibilities:

- Repack entries into an HWPX ZIP.
- Preserve required internal paths.
- Apply stronger ZIP compression.
- Avoid writing output if verification fails.

### Verifier

Responsibilities:

- Confirm the output ZIP opens.
- Confirm required HWPX package files exist.
- Confirm XML files parse.
- Confirm all referenced internal files exist.
- Confirm safe mode did not delete referenced resources.
- Confirm used image dimensions did not change.

### ReportGenerator

Responsibilities:

- Produce JSON report for CLI and desktop UI.
- Include original size, optimized size, saved bytes, and saved percentage.
- Include image inventory.
- Include applied, skipped, and failed actions.
- Include warnings for unsupported or risky candidates such as BMP conversion, OLE, embedded fonts, or aggressive image opportunities.

## CLI UX

Initial commands:

```bash
hwpx-opt analyze input.hwpx
hwpx-opt optimize input.hwpx --mode safe
hwpx-opt optimize input.hwpx --mode safe --out output.hwpx
hwpx-opt batch ./docs --mode safe --out ./optimized
```

Expected default outputs:

- Optimized HWPX file.
- JSON report next to the output file.
- Human-readable terminal summary.

## Desktop UX

The desktop app is implemented after the core and CLI stabilize.

Main flow:

```text
Drop/select HWPX files
  -> analyze
  -> show original size, image inventory, and safe optimization opportunities
  -> run safe optimization
  -> show saved size and action report
  -> reveal output file
```

The first desktop version should not expose balanced or aggressive controls until those modes are implemented and tested in the core.

## Error Handling

- Invalid HWPX: fail with a clear error and no output file.
- Unsupported package shape: analyze what is possible, warn about the rest.
- Image optimization failure: keep the original image and record a skipped action.
- Verification failure: delete or withhold the optimized output and preserve the report.
- Output path conflict: require explicit overwrite flag or choose a deterministic non-conflicting suffix.

## Testing Strategy

Targeted tests come first.

Core tests:

- Valid HWPX package is read and classified.
- Invalid ZIP fails clearly.
- XML files parse successfully.
- Referenced BinData is not removed.
- Unreferenced BinData can be removed.
- Safe mode preserves image dimensions.
- Safe mode does not emit BMP conversion actions.
- Repacked output can be reopened.
- Verification catches missing referenced files.

Fixture tests:

- Small text-only HWPX.
- HWPX with PNG/JPEG images.
- HWPX with BMP image.
- HWPX with unused BinData.
- HWPX with embedded metadata.
- HWPX with OLE or unsupported object, if available.

CLI tests:

- `analyze` emits JSON and terminal summary.
- `optimize --mode safe` writes an output file and report.
- `batch` processes multiple files and reports partial failures.

## Initial Tech Stack

- Runtime: Node.js.
- Language: TypeScript.
- Image processing: `sharp`.
- ZIP handling: implementation to be selected during planning after evaluating streaming and path-preservation needs.
- XML parsing: implementation to be selected during planning after checking namespace preservation and serialization behavior.
- Desktop shell: Electron, after core and CLI.

## Open Implementation Decisions

These decisions are intentionally deferred to the implementation plan:

- Exact ZIP library.
- Exact XML parser/serializer.
- Package manager and monorepo tooling.
- Whether safe-mode PNG/JPEG optimization should rely only on `sharp` or optional external optimizers.
- Fixture generation strategy if real sample HWPX files are not available.

## Acceptance Criteria for v1

v1 is complete when:

- The CLI can analyze a valid HWPX file.
- The CLI can produce a safe-mode optimized HWPX file.
- The original file is never modified.
- The output passes verifier checks.
- The JSON report lists size savings and all applied/skipped actions.
- Safe mode does not change image dimensions, perform BMP conversion, or reduce JPEG quality.
- Targeted automated tests pass.
