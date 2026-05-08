# Known Limitations

This file separates release blockers from non-blockers so the project does not overstate readiness.

## Blockers Before Product Release

- Desktop app can produce Linux unpacked, Windows unpacked, and Windows portable builds in this environment, but a Windows NSIS installer artifact still requires a Windows or Wine-enabled release machine.
- Desktop app has an automated launch smoke test, but full manual GUI workflow testing is still required.
- Verifier checks mode-specific image format and dimension invariants, but it does not yet measure visual similarity or JPEG quality drift.
- Reference graph detection is still conservative and should be expanded with more real-world HWPX reference forms.
- Desktop optimization runs in a worker thread, but progress is currently coarse-grained rather than per-image/action.
- No Windows build has been tested on a clean Windows machine.

## Non-Blockers For Continued Development

- Some reference graph detection is conservative and may miss uncommon HWPX reference forms.
- Duplicate image consolidation currently handles byte-identical image files with manifest IDs. Near-duplicate visual matching is not implemented.
- Embedded fonts and OLE objects are reported as risky resources but not optimized.
- Display-size based image budgets depend on detectable HWPX picture size fields. If those fields are missing, fallback mode profile limits are used.
- EXIF removal can produce little or no size reduction when metadata is already small or ZIP compression dominates the package size.
- Some safe-mode rewrites can make an individual entry slightly larger. The optimizer records skipped or applied actions so this can be audited.
- Desktop settings UI is minimal and should be refined before public release.
- `npm audit` currently reports 0 vulnerabilities after dependency updates on 2026-05-08.

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

If a sample file is accidentally staged, unstage it before committing.
