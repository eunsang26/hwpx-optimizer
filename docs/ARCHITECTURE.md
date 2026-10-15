# Architecture

## Product Principles

HWPX Optimizer is built as a local utility. The core engine never needs a server, account, or network upload. The CLI and desktop app call the same TypeScript core package so optimization behavior stays consistent.

The original document is read-only input. Every optimization path writes a separate output buffer or output file.

## Workspace Layout

```text
packages/core
  HWPX ZIP reading, analysis, planning, optimization, writing, verification, reports

packages/io
  Shared filesystem reservations, exclusive publication, and owned-file cleanup

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

Batch writes use a private `.hwpx-optimizer-batch.lock` workspace in the output folder. It contains staging files and a process ownership record; a second active batch targeting the same canonical folder is rejected. Recovery only removes recorded, unchanged reservations belonging to an exited process, along with that private workspace. New reservations are empty directories; recovery also supports legacy zero-byte file reservations. Generic `.tmp` files and unrecorded files are never swept. Unrecognized lock directories are preserved and reported for inspection.

## Filesystem Publication Boundary

`packages/io` is shared by CLI and desktop; core remains buffer-oriented and does not import it. `publication.ts` owns reservations and single-file publication; `artifactTransaction.ts` owns document/report saves. Non-overwrite saves reserve names with exclusive directory creation. A document/report pair obtains both names before staging either artifact. Desktop saves and batch jobs select suffixes on conflicts; standalone CLI saves may report an explicit collision.

Stages use exclusive file creation. Publication removes only the unchanged, empty reservation and hardlinks the complete stage into the final name. Link creation fails if another file appears in the gap. On filesystems without hardlinks, publication streams into a file opened with `O_EXCL`, retaining the exclusive-name guarantee while bytes are copied. This fallback does not publish all bytes atomically. Cleanup checks filesystem identity, modification time, and size before deleting owned files; reservations never use recursive deletion.

Before saving a pair, the transaction rejects equal destinations, canonical paths through symbolic links, and existing hardlink aliases. It validates every stage and destination before moving existing results. In overwrite mode, existing entries move into private sibling `.hwpx-save-*` directories until both new artifacts have been published. A handled write/publication failure rolls the entire pair back, including restoring a symbolic link itself without changing its referent. CLI single saves, CLI batch commits and desktop saves share this policy; batch failures identify the document or report stage and do not count as optimized results.

Rollback removes only unchanged artifacts created by the transaction and restores old entries exclusively. If a new user file blocks restoration, it is preserved and the error identifies the retained backup directory for recovery. Cleanup trouble after a successful commit returns a warning rather than changing a complete save into a failure; CLI prints these warnings, batch summaries retain them, and desktop includes them in the returned warnings. Stored optimization reports describe optimization; subsequent filesystem-cleanup warnings belong to the save operation.

These rules do not provide a multi-file crash transaction or isolate intermediate names from concurrent readers. Desktop computation workers never publish files, so terminating a worker cannot interrupt the main-owned save. Cooperative cancellation, inactivity timeouts and normal application shutdown await rollback before releasing the operation lock. Abrupt termination of the main process or power loss can still interrupt backup/publish/restore; there is no durable restart journal, and remaining `.hwpx-save-*` directories may require manual recovery.

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

Analysis and optimization computation run through `apps/desktop/src/main/documentWorker.ts`, a persistent Node worker thread. It returns verified bytes and the optimization report without reserving or writing output names. Dedicated ArrayBuffers transfer ownership to main; small or pooled buffers are copied. Input-cache views sharing the transferred buffer are evicted before transfer so later analysis cannot reuse detached bytes.

`documentWorkerClient.ts` owns request IDs and worker generations. Cancellation waits for worker termination, ignores late replies from the stopping generation, and isolates its pending requests from a replacement worker. Unexpected exits retain a distinct error with the exit code. `documentOperations.ts` serializes authorization, computation, main-owned asynchronous publication and recovery. Its five-minute inactivity timer resets on real progress rather than imposing a total-duration limit; a timeout identifies the last stage and remains distinct from user cancellation.

The main process passes an AbortSignal through staging and exclusive publication. Aborting before the synchronous commit decision rolls back the pair; after that decision, cancellation cannot turn a completed save into a cancelled result. Cancel acknowledgement and the busy lock wait for cleanup. Recovery errors preserve user replacements and identify retained backups. Normal application shutdown closes the operation queue, waits for recovery or committed cleanup, and then disposes the worker. Image computation remains off the main thread. See `DESKTOP_CANCELLATION_2026-10-15.md` for phase tests, native UI checks, synthetic timing and crash-recovery limits.

Core analysis normalizes the omitted mode to `quick` across inventory, structural opportunities and image opportunities. Quick performs header/byte analysis and estimates image candidates; it does not decode pixels, compute visual duplicate hashes or encode images. Deep enables those diagnostics and candidate encode measurements. Desktop initial single and batch imports use quick; the single-file detail panel can request deep through the validated preload/IPC/worker path. Reports disclose the work performed in optional `analysis` coverage metadata, and the renderer labels deferred checks and estimated sizes. Older reports without metadata retain unknown coverage. Candidate encode measurements remain distinct from actual final ZIP bytes. See `QUICK_ANALYSIS_2026-10-15.md` for measurements.

## Processing Resource Limits

ZIP metadata preflight covers normal and ZIP64 end records, locators, entry counts and 64-bit sizes/offsets before JSZip loads metadata. The 20,000-record default includes directories. Default limits remain 512MiB per expanded entry and 2GiB total expanded data. Unicode-decoded names are checked again after loading. Actual entry streams are checked before accumulating each chunk and concatenating the accepted entry; false declared sizes cannot bypass the entry/aggregate limits. This avoids allocating a complete untrusted expanded entry before validation, although decompressor chunks and its current input block still have transient cost.

`resourceLimits.ts` defines a 24-million-pixel image ceiling. Larger images are retained with a warning, including BMP before RGB allocation; native decode/encode pipelines also set Sharp's input pixel limit. Preview outputs have at most 12 pairs and 1024-pixel edges/samples; one pair runs at a time. Core image mappers default to two concurrent items and cap explicit requests at four. CLI uses at most four workers, each requesting image concurrency one; requested and effective worker counts are recorded in its batch report.

Buffer analysis, optimization and verification use an AsyncLocalStorage-owned decoded-image cache. Ready entries are bounded by 64MiB including encoded-source and decoded-pixel backing buffers, and by 64 slots. Old entries are evicted and oversized entries are returned without caching. Concurrent requests for one buffer share the pending decode. Success and failure dispose the scope; late callbacks cannot repopulate it. Nested operations share their active owner. Standalone image helpers use a bounded cache and expose an explicit clear operation. JPEG encoding no longer launches a separate unawaited raw decode to warm this cache.

These limits do not bound total RSS: ZIP buffers, active decodes, native intermediates, thumbnails, externally retained returned buffers and allocator/native caches also consume memory. The largest permitted archive/pixel/worker limits have not been proven safe in every combination on low-memory PCs. See `RESOURCE_LIMITS_2026-10-15.md` for synthetic RSS measurements and their scope.

## Safety Rules

- Never overwrite the original input file.
- Do not delete referenced resources.
- Do not create an output if verification fails.
- Keep safe mode free of resizing, lossy JPEG changes, BMP conversion, font changes, OLE changes, style rewrites, and layout recalculation.
- If behavior is uncertain, skip the action and report a warning.
