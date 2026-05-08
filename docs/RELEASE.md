# Release

## Release Goals

The release target is a local Windows desktop utility plus a CLI built from the same core engine.

Release requirements:

- CLI runs locally.
- Desktop app runs locally.
- No server upload.
- No login, account, billing, cloud storage, or telemetry.
- Original files are preserved.
- Optimized outputs pass verifier.
- README commands work on a clean checkout.
- Known blockers and non-blockers are documented.

## Build Commands

Install dependencies:

```bash
npm install
```

Build all TypeScript projects and copy desktop renderer assets:

```bash
npm run build
```

Run the CLI from source:

```bash
npm run cli -- analyze input.hwpx
```

Start desktop from the built main process:

```bash
npm run desktop:start
```

## Verification Before Release

Run:

```bash
npm test
npm run typecheck
npm run build
electron_config_cache=.npm-cache/electron npx electron --version
```

Then verify at least one HWPX end-to-end:

```bash
npm run cli -- analyze sample2.hwpx --report sample2.release-analysis.json
npm run cli -- optimize sample2.hwpx --mode safe --out sample2.safe.optimized.hwpx
npm run cli -- verify sample2.safe.optimized.hwpx
```

Sample files and generated sample reports are local-only and ignored by git.

## Desktop Packaging Status

Packaging is not complete yet. The project currently starts Electron in development mode after `npm run build`.

Recommended next packaging step:

1. Add `electron-builder` as a dev dependency.
2. Add app metadata and Windows target config.
3. Build an unpacked Windows directory first.
4. Verify the app can analyze and optimize a local HWPX file.
5. Add installer target only after unpacked app checks pass.

Suggested future scripts:

```json
{
  "desktop:pack": "npm run build && electron-builder --dir",
  "desktop:dist": "npm run build && electron-builder --win"
}
```

## Versioning

Until the first user-ready release, keep package versions at `0.x`. Use clear release notes that separate:

- Safe mode support.
- Balanced mode support.
- Aggressive mode support.
- Desktop app status.
- Known limitations.

## Artifact Rules

Do not include:

- User sample HWPX/HWP documents.
- Generated optimization outputs.
- Generated report JSON or text files.
- Local Electron caches.
- `node_modules`.

Do include:

- Source code.
- Tests.
- Documentation.
- Lockfile.
- Release configuration once packaging is added.
