# Known Limitations

This file separates release blockers from non-blockers so the project does not overstate readiness.

## Blockers Before Product Release

- Desktop app has packaging scripts, but a Windows installer artifact has not been built and tested yet.
- Desktop app has not passed a GUI smoke test in this environment.
- Verifier has safe-mode image format and dimension checks, but balanced/aggressive policies still need stricter comparison rules.
- XML reference updates are not fully structural in all advanced paths.
- Long-running desktop optimization is not isolated in a worker or child process.
- No Windows release artifact has been built or tested on a clean Windows machine.

## Non-Blockers For Continued Development

- Some reference graph detection is conservative and may miss uncommon HWPX reference forms.
- Duplicate image groups are detected but not yet consolidated.
- Embedded fonts and OLE objects are reported as risky resources but not optimized.
- Display-size based image budgets depend on detectable HWPX picture size fields. If those fields are missing, fallback mode profile limits are used.
- EXIF removal can produce little or no size reduction when metadata is already small or ZIP compression dominates the package size.
- Some safe-mode rewrites can make an individual entry slightly larger. The optimizer records skipped or applied actions so this can be audited.
- Desktop settings UI is minimal and should be refined before public release.
- `npm audit` currently reports moderate dependency advisories. These have not been triaged yet.

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
