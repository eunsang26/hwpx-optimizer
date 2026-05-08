# Known Limitations

This file separates release blockers from non-blockers so the project does not overstate readiness.

## Blockers Before Product Release

- Desktop app has automated launch smoke coverage and user-confirmed Windows portable smoke across safe, balanced, and aggressive modes, but broader manual QA is still required for drag/drop, settings persistence, repeated files, and more real-world documents.
- Verifier checks mode-specific image format and dimension invariants, but it does not yet measure visual similarity or JPEG quality drift.
- Reference graph detection is still conservative and should be expanded with more real-world HWPX reference forms.

## Verified Release Infrastructure

- Desktop app can produce Linux unpacked, Windows unpacked, Windows portable, and Windows NSIS installer builds.
- GitHub Actions Windows release gate passes on `windows-latest` when artifact upload is disabled for manual runs.
- Artifact upload is optional for manual workflow runs to avoid Actions storage quota failures. Tag builds still upload release artifacts.
- Local Windows portable packaging verifies that the `sharp` Windows native runtime is unpacked outside `app.asar`.

## Non-Blockers For Continued Development

- Some reference graph detection is conservative and may miss uncommon HWPX reference forms.
- Duplicate image consolidation currently handles byte-identical image files with manifest IDs. Near-duplicate visual matching is not implemented.
- Embedded fonts and OLE objects are reported as risky resources but not optimized.
- Display-size based image budgets depend on detectable HWPX picture size fields. If those fields are missing, fallback mode profile limits are used.
- EXIF removal can produce little or no size reduction when metadata is already small or ZIP compression dominates the package size.
- Safe-mode optimization can still take time on image-heavy documents because it performs lossless image metadata/PNG processing and ZIP verification even when final savings are zero.
- Some safe-mode rewrites can make an individual entry slightly larger. The optimizer records skipped or applied actions so this can be audited.
- Desktop settings controls are functional, but final visual QA on the target Windows desktop environment is still required.
- Desktop analysis and optimization run off the main UI path, but progress is still stage-based rather than per-image/action.
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
- `결과/`

If a sample file is accidentally staged, unstage it before committing.
