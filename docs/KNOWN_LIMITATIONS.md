# Known Limitations

This file separates release blockers from non-blockers so the project does not overstate readiness.

## Blockers Before Product Release

- Desktop drag/drop now uses Electron `webUtils.getPathForFile`, but final hands-on QA on a clean Windows machine for drag/drop, non-sensitive settings persistence, zero-history restart behavior, repeated files, very large packages, and representative real-world documents remains pending.

## Verified Release Infrastructure

- Desktop app can produce Linux unpacked, Windows unpacked, Windows portable, and Windows NSIS installer builds.
- Windows ZIP is the preferred local artifact for faster repeated startup. The single portable EXE remains available, but it can start slower because it self-extracts each time.
- GitHub Actions Windows release gate passes on `windows-latest` when artifact upload is disabled for manual runs.
- Artifact upload is optional for manual workflow runs to avoid Actions storage quota failures. Tag builds still upload release artifacts.
- Local Windows portable packaging verifies that the `sharp` Windows native runtime is unpacked outside `app.asar`.
- Verifier checks mode-specific image format and dimension invariants and rejects balanced/aggressive outputs whose per-image PSNR and SSIM scores fall below the per-mode thresholds. The reject error includes the original/output dimensions, format, and EXIF orientation to make catastrophic regressions (rotation bake, dimension swap) self-explanatory. Quality scoring lives in `packages/core/src/imagePreview.ts`. The 8x8 average hash in `packages/core/src/visualSimilarity.ts` is used for near-duplicate candidate reporting, not as a release gate.
- Reference graph detection resolves manifest `id -> href` links, generic id-valued XML attributes, relative or percent-encoded BinData paths, and direct BinData path attributes. This keeps unused-resource deletion conservative when unfamiliar XML reference forms appear.
- Duplicate image consolidation handles byte-identical image files and exact decoded-pixel same-visual duplicates across lossless encodings, such as BMP and PNG resources that decode to identical pixels. Near-duplicate images are reported as review-only candidates and are not automatically merged.
- HWPX zip-slip defense: reader rejects entries whose path contains `..`, `.`, drive letters, leading slash, or empty segments.

## Non-Blockers For Continued Development

- Future reference graph additions should be driven by real HWPX samples that expose new reference forms.
- Duplicate image consolidation does not automatically merge near-duplicates or lossy re-encodes whose decoded pixels differ.
- PSNR and SSIM thresholds are conservative quality gates, not perceptual proof that every image is visually identical. Manual review is still appropriate for high-stakes documents.
- Embedded fonts and OLE objects are reported as risky resources but not optimized.
- Display-size based image budgets depend on detectable HWPX picture size fields. If those fields are missing, fallback mode profile limits are used.
- JPEG XMP/IPTC/comment metadata removal can produce little or no size reduction when metadata is already small or ZIP compression dominates the package size. EXIF orientation is preserved to avoid rotation regressions.
- Safe-mode optimization can still take time on image-heavy documents because it performs lossless image metadata/PNG processing and ZIP verification even when final savings are zero.
- Some safe-mode rewrites can make an individual entry slightly larger. The optimizer records skipped or applied actions so this can be audited.
- Desktop settings controls are functional. Output folder selection is session-only by policy, and final visual QA on the target Windows desktop environment is still required.
- Desktop analysis and optimization run off the main UI path. Progress includes analysis, planning, per-image transform counts, verification, and file-write stages, but it is still estimated progress rather than byte-accurate package progress.
- Release gates use `npm run release:audit`, which requires **0 production** vulnerabilities (`npm audit --omit=dev`). A full `npm audit` may still report packaging/dev advisories inside `electron-builder` / nested `@electron/asar` (`brace-expansion`) and a residual low `esbuild` dev-server advisory; those are build-toolchain only and are non-blockers.
- Windows portable smoke from WSL needs a writable Windows-visible temp (prefers `/mnt/c/Temp`). If none is available, the script fails with a clear error; set `HWPX_OPT_SKIP_WIN_PORTABLE_SMOKE=1` only when intentionally skipping on a locked-down host.

## CLI Portable Windows ZIP

- The CLI portable is a ZIP folder, not a single self-contained EXE. Users must extract the archive and run launchers from the extracted directory.
- Windows support verification uses `npm run release:verify-cli-portable-smoke` and `scripts/cli-portable-smoke.ps1`, separate from the Electron portable smoke (`scripts/windows-portable-smoke.ps1`).
- When a folder is dropped on `drop-here.bat`, batch output goes to `<folder>/optimized/` (not beside each source file).
- An interactive numbered menu launcher is not included; use `drop-here.bat`, `hwpx-opt.cmd`, and `사용법.txt`.

## Safe Mode Caveats

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
