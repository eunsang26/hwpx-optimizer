# Known Limitations

This file separates release blockers from non-blockers so the project does not overstate readiness.

## Blockers Before Final Product Release

- Desktop drag/drop uses Electron `webUtils.getPathForFile`. Automated portable smoke and local Windows-path hands-on checks are recorded in `docs/WINDOWS_QA_CHECKLIST.md` (2026-07-26 quality tracks and v0.1.4/v0.1.5). Remaining gaps on a dedicated clean institutional PC: Hancom viewer open of optimized outputs, very large packages, and long-running zero-history restart sign-off. These gaps permit a clearly labeled prerelease, but not a final product-ready claim.

## Verified Release Infrastructure

- Desktop app supports Windows x64 unpacked, portable, ZIP, and NSIS installer builds.
- Windows ZIP is the preferred local artifact for faster repeated startup. The single portable EXE remains available, but it can start slower because it self-extracts each time.
- GitHub Actions Windows release gate passes on `windows-latest` when artifact upload is disabled for manual runs.
- Artifact upload is optional for manual workflow runs to avoid Actions storage quota failures. Tag builds still upload release artifacts.
- Local Windows portable packaging verifies that the `sharp` Windows native runtime is unpacked outside `app.asar`.
- With an original document and mode, verification compares XML text/layout and resource uses at each original position, and preserves other package parts. Unknown reference forms skip duplicate reassignment. UTF-8 XML is required; unsupported declared encodings and invalid UTF-8 are rejected. Generated shape-comment filename/dimension lines may be removed in advanced modes, while authored descriptions remain.
- Verifier checks mode-specific image format and dimension invariants and rejects balanced/aggressive outputs whose per-image PSNR and SSIM scores fall below the per-mode thresholds (512×512 `contain` samples). The reject error includes the original/output dimensions, format, and EXIF orientation to make catastrophic regressions (rotation bake, dimension swap) self-explanatory. Quality scoring lives in `packages/core/src/imagePreview.ts`. The 8x8 average hash in `packages/core/src/visualSimilarity.ts` is used for near-duplicate candidate reporting in Desktop deep analyze (review-only; never auto-merged), not as a release gate.
- Reference graph detection resolves manifest `id -> href` links, generic id-valued XML attributes, relative or percent-encoded BinData paths, and direct BinData path attributes. This keeps unused-resource deletion conservative when unfamiliar XML reference forms appear. Explicit binaryItemIDRef values must resolve; local manifest hrefs must exist and IDs must be unique. Generic style/paragraph Ref values are not required to be manifest binary IDs. External manifest URLs are never fetched; using them as a binary resource fails verification.
- Advanced optimization reports record actual image destinations and ID aliases, including BMP/TIFF and JPEG path collisions. Verifier follows each XML use to its actual destination; image previews use these mappings or stable IDs/positions for older reports. Explicitly converted images without a manifest or visible use require their report mapping for preview.
- Duplicate image consolidation handles byte-identical image files and exact decoded-pixel same-visual duplicates across lossless encodings, such as BMP and PNG resources that decode to identical pixels. Near-duplicate images are reported as review-only candidates and are not automatically merged.
- HWPX zip-slip defense: reader rejects entries whose path contains `..`, `.`, drive letters, leading slash, or empty segments.

## Non-Blockers For Continued Development

- Non-overwrite saves reserve document/report names and publish complete staged bytes by hardlink where supported. On FAT or other filesystems without hardlinks, an exclusive copy preserves existing names but a reader can observe partial bytes during the copy. Forced termination recovery and overwrite-mode document/report rollback are still tracked in OPT-012 and OPT-011 respectively; no multi-file crash-atomic guarantee is made.
- Future reference graph additions should be driven by real HWPX samples that expose new reference forms.
- Duplicate image consolidation does not automatically merge near-duplicates or lossy re-encodes whose decoded pixels differ.
- PSNR and SSIM thresholds are conservative quality gates, not perceptual proof that every image is visually identical. Manual review is still appropriate for high-stakes documents.
- Embedded fonts and OLE objects are reported as risky resources and preserved in every mode, even when no supported reference is found.
- Display-size based image budgets depend on detectable HWPX picture size fields. If those fields are missing, fallback mode profile limits are used.
- JPEG XMP/IPTC/comment metadata removal can produce little or no size reduction when metadata is already small or ZIP compression dominates the package size. Safe metadata stripping preserves EXIF orientation. Advanced JPEG processing may bake it into pixels, with displayed axes and visual scores verified.
- Safe-mode optimization can still take time on image-heavy documents because it performs lossless image metadata/PNG processing and ZIP verification even when final savings are zero.
- Some safe-mode rewrites can make an individual entry slightly larger. The optimizer records skipped or applied actions so this can be audited.
- Desktop settings controls are functional. Output folder selection is session-only by policy, and final visual QA on the target Windows desktop environment is still required.
- Desktop analysis and optimization run off the main UI path. Progress includes analysis, planning, per-image transform counts, verification, and file-write stages, but it is still estimated progress rather than byte-accurate package progress.
- 2026-10-14 full audit after sharp/Electron patching still reports 20 build/development advisories (high 8, moderate 11, low 1), including electron-builder, Vitest, and their transitive tools. This is not a zero-vulnerability release claim.
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
