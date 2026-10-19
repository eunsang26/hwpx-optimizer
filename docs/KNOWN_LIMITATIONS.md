# Known Limitations

This file separates release blockers from non-blockers so the project does not overstate readiness.

## Blockers Before Final Product Release

- Desktop drag/drop uses Electron `webUtils.getPathForFile`. Current native Windows Server 2025 packaged-runtime checks and synthetic measurements are recorded in [the 2026-10-15 evidence ledger](RELEASE_EVIDENCE_2026-10-15.md). Historical v0.1.4/v0.1.5 real-document smoke remains dated in [Windows QA](WINDOWS_QA_CHECKLIST.md), not acceptance of the current code. Hancom viewer open, representative very large real documents, and long-running zero-history restart on a clean institutional Windows 10/11 PC remain unverified. Automated short restart and 25.9MB synthetic measurements do not close those gaps. A clearly labeled prerelease is possible; final product-ready sign-off remains pending.

## Verified Release Infrastructure

- Desktop app supports Windows x64 unpacked, portable, ZIP, and NSIS installer builds.
- Windows ZIP is the preferred local artifact for faster repeated startup. The single portable EXE remains available, but it can start slower because it self-extracts each time.
- GitHub Actions Windows release gate passes on `windows-latest` when artifact upload is disabled for manual runs.
- Artifact upload is optional for manual workflow runs to avoid Actions storage quota failures. Tag builds still upload release artifacts.
- Local Windows portable packaging verifies that the `sharp` Windows native runtime is unpacked outside `app.asar`.
- With an original document and mode, verification compares XML text/layout and resource uses at each original position, and preserves other package parts. Unknown reference forms skip duplicate reassignment. UTF-8 XML is required; unsupported declared encodings and invalid UTF-8 are rejected. Generated shape-comment filename/dimension lines may be removed in advanced modes, while authored descriptions remain.
- Standalone CLI/Desktop `verify` checks package structure, XML and references without an original; it does not compare original text/layout/pixels. Optimization itself runs original-plus-mode verification before returning output. Neither replaces opening the output in Hancom.
- Verifier checks mode-specific image format and dimension invariants and rejects balanced/aggressive outputs whose per-image PSNR and SSIM scores fall below the per-mode thresholds (512×512 `contain` samples). The reject error includes the original/output dimensions, format, and EXIF orientation to make catastrophic regressions (rotation bake, dimension swap) self-explanatory. Quality scoring lives in `packages/core/src/imagePreview.ts`. The 8x8 average hash in `packages/core/src/visualSimilarity.ts` is used for near-duplicate candidate reporting in Desktop deep analyze (review-only; never auto-merged), not as a release gate.
- Reference graph detection resolves manifest `id -> href` links, generic id-valued XML attributes, relative or percent-encoded BinData paths, and direct BinData path attributes. This keeps unused-resource deletion conservative when unfamiliar XML reference forms appear. Explicit binaryItemIDRef values must resolve; local manifest hrefs must exist and IDs must be unique. Generic style/paragraph Ref values are not required to be manifest binary IDs. External manifest URLs are never fetched; using them as a binary resource fails verification.
- Advanced optimization reports record actual image destinations and ID aliases, including BMP/TIFF and JPEG path collisions. Verifier follows each XML use to its actual destination; image previews use these mappings or stable IDs/positions for older reports. Explicitly converted images without a manifest or visible use require their report mapping for preview.
- Duplicate image consolidation handles byte-identical image files and exact decoded-pixel same-visual duplicates across lossless encodings, such as BMP and PNG resources that decode to identical pixels. Near-duplicate images are reported as review-only candidates and are not automatically merged.
- HWPX zip-slip defense: reader rejects entries whose path contains `..`, `.`, drive letters, leading slash, or empty segments.

## Non-Blockers For Continued Development

- Document/report saves roll back the whole pair on a handled failure. Overwrite saves temporarily move old entries into private `.hwpx-save-*` directories. If a user replacement blocks restoration, it is preserved and the error lists recovery directories containing the old files. Desktop worker termination cannot interrupt main-owned publication. User cancellation, inactivity timeout and normal app shutdown wait for rollback or committed cleanup. Abrupt main-process termination or power loss has no durable restart journal; leftover backup directories may require manual recovery. No multi-file crash-atomic or reader-isolation guarantee is made. On FAT or other filesystems without hardlinks, exclusive copying protects names but a reader can observe partial bytes during the copy.
- Initial Desktop and default core analysis use header/byte quick analysis. Image sizes are heuristic estimates and visual duplicate diagnostics are deferred; single-file detailed analysis and CLI `--analysis-mode deep` enable pixel/similarity checks and candidate encodes. Even encoded candidate sizes are not exact final ZIP sizes. Reports and Desktop disclose coverage; see `QUICK_ANALYSIS_2026-10-15.md`.
- Analysis now uses distinct estimated fields and mode-specific source-ZIP models; only completed reports have measured output fields. Quick predictions can materially overestimate small optimized outputs (one synthetic aggressive mixed case: +761.76%); deep candidate measurements also differ from final ZIP bytes. Neither predicts final target search, safety rollback or every header/manifest rewrite exactly. New analysis JSON consumers must use `estimatedSize` instead of `optimizedSize`. See `SIZE_ESTIMATES_2026-10-15.md`.
- Resource ceilings are explicit: 24MP per image, 64MiB of retained decoded/source cache per operation, image mapper concurrency up to four (default two), and up to four CLI workers with one image mapper each. Larger images remain unchanged. Default ZIP limits are 20,000 records including directories, 512MiB per expanded entry and 2GiB aggregate. These are processing ceilings, not a total-RSS guarantee or proof for every maximum-size combination. See `RESOURCE_LIMITS_2026-10-15.md`.
- Future reference graph additions should be driven by real HWPX samples that expose new reference forms.
- Duplicate image consolidation does not automatically merge near-duplicates or lossy re-encodes whose decoded pixels differ.
- PSNR and SSIM thresholds are conservative quality gates, not perceptual proof that every image is visually identical. Manual review is still appropriate for high-stakes documents.
- Embedded fonts and OLE objects are reported as risky resources and preserved in every mode, even when no supported reference is found.
- Display-size based image budgets depend on detectable HWPX picture size fields. If those fields are missing, fallback mode profile limits are used.
- JPEG XMP/IPTC/comment metadata removal can produce little or no size reduction when metadata is already small or ZIP compression dominates the package size. Safe metadata stripping preserves EXIF orientation. Advanced JPEG processing may bake it into pixels, with displayed axes and visual scores verified.
- Safe-mode optimization can still take time on image-heavy documents because it performs lossless image metadata/PNG processing and ZIP verification even when final savings are zero.
- Some safe-mode rewrites can make an individual entry slightly larger. The optimizer records skipped or applied actions so this can be audited.
- Desktop settings controls are functional. Output folder selection is session-only by policy, and final visual QA on the target Windows desktop environment is still required.
- Desktop analysis and optimization computation run in a worker; asynchronous output publication and recovery belong to main. Progress includes analysis, planning, per-image transform counts, verification, and file-write stages, but it is still estimated progress rather than byte-accurate package progress. The five-minute timeout measures inactivity between progress events. Synthetic timings do not establish a supported limit for every large document or slow institutional PC; see `DESKTOP_CANCELLATION_2026-10-15.md`.
- The full audit at runtime commit `22546ee` on 2026-10-15 reports 20 build/development advisories (high 8, moderate 11, low 1), including electron-builder, Vitest, and their transitive tools. Production dependencies and shipped Electron have zero **moderate-or-higher** advisories in that result. Counts are dated observations, not a zero-total-vulnerability release claim; rerun the gate for each release. On 2026-10-19 (`29eed90`), non-breaking lockfile updates reduced the full audit to 8 moderate advisories (high 0, low 0), all in the electron-builder chain that needs a breaking major update; production dependencies and shipped Electron still have zero moderate-or-higher advisories. See [audit evidence](RELEASE_EVIDENCE_2026-10-15.md).
- Release gates use `npm run release:audit`, which blocks moderate-or-higher advisories in production dependencies **and the shipped Electron binary**, even though Electron is declared in `devDependencies`. Both production and full audit responses are required; invalid/unavailable responses fail closed. Remaining build-tool advisories are printed separately and do not imply zero total vulnerabilities. On Windows the helper spawns `npm.cmd` via a shell.
- Windows portable smoke from WSL needs a writable Windows-visible temp (prefers `/mnt/c/Temp`). If none is available, the script fails with a clear error; set `HWPX_OPT_SKIP_WIN_PORTABLE_SMOKE=1` only when intentionally skipping on a locked-down host.

## CLI Portable Windows ZIP

- The CLI portable is a ZIP folder, not a single self-contained EXE. Users must extract the archive and run launchers from the extracted directory.
- Windows support verification uses `npm run release:verify-cli-portable-smoke` and `scripts/cli-portable-smoke.ps1`, separate from the Electron portable smoke (`scripts/windows-portable-smoke.ps1`).
- When a folder is dropped on `drop-here.bat`, batch output goes to `<folder>/optimized/` (not beside each source file).
- An interactive numbered menu launcher is not included; use `drop-here.bat`, `hwpx-opt.cmd`, and `사용법.txt`.

## Safe Mode Caveats

Image rewrites preserve transparency. Exact same-visual duplicate detection includes alpha; fully opaque RGB and RGBA can still share a canonical pixel hash. Safe verification compares decoded pixels for changed referenced images, and advanced quality verification evaluates the worse of light- and dark-background composites so alpha loss is visible to the quality gate.

Images with embedded ICC profiles, sample depth greater than 8 bits, multiple pages/frames, or non-default PNG orientation retain their original image bytes. BMPs with alpha masks and ambiguous legacy 32-bit BI_RGB alpha are also preserved instead of converted. Reports include the preservation reason. Structural package cleanup can still reduce the document around these images. This conservative policy avoids silently losing color precision, profiles, animation/pages or transparency.

Safe mode intentionally avoids the largest size-saving operations when they could affect the visible document:

- No image resizing.
- No JPEG quality reduction.
- No BMP conversion.
- No font removal.
- No OLE conversion.
- No layout recalculation.

Because of that, safe mode may save very little on documents where the main cause is oversized image dimensions.

## Balanced And Aggressive Caveats

Balanced and aggressive modes can save much more space because they change image encoding and pixel dimensions. The document layout references are preserved, but the embedded image pixels can differ from the original.

Use balanced mode for ordinary local optimization. Use aggressive mode only when smaller file size is more important than exact image fidelity.

## Sample File Policy

Real sample documents may contain private data. Do not commit them.

The repository ignores root-level:

- `sample*.hwp`
- `sample*.hwpx`
- `sample*.json`
- `sample*.txt`
- `결과/`

If a sample file is accidentally staged, unstage it before committing.
