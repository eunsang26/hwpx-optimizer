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

Create an unpacked desktop build for the current platform:

```bash
npm run desktop:pack
```

The packaging script stores Electron downloads under the project-local `.npm-cache/electron` directory. This avoids relying on a writable home-directory cache in locked-down environments.

Create an unpacked Windows x64 folder from Linux/WSL without executable resource editing:

```bash
npm run desktop:pack:win
```

Create a Windows x64 installer build:

```bash
npm run desktop:dist:win
```

On Linux/WSL, the installer build requires `wine`. If `wine` is unavailable, use `desktop:pack:win` for a Windows unpacked folder build and create the installer on a Windows release machine or a Linux environment with Wine configured.

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

The project has an `electron-builder` configuration and scripts for unpacked desktop builds and Windows x64 installer builds.

Before treating a build as releasable:

1. Run `npm run desktop:pack`.
2. Launch the unpacked app on the target platform.
3. Verify the app can analyze and optimize a local HWPX file.
4. Run `npm run desktop:pack:win` to confirm a Windows unpacked folder can be generated.
5. Run `npm run desktop:dist:win` on a Windows release machine or a verified Wine-enabled cross-build environment.
6. Install the generated artifact on a clean Windows machine.

Suggested future scripts:

```json
{
  "desktop:dist:linux": "npm run build && electron-builder --linux",
  "desktop:dist:mac": "npm run build && electron-builder --mac"
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
