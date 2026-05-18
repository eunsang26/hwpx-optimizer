# Tauri Node Sidecar Desktop PoC Design

## Goal

Build a second desktop application at `apps/tauri-desktop` that evaluates Tauri as a smaller Windows shell while preserving the existing TypeScript HWPX optimization core.

## Scope

This PoC does not replace the Electron desktop app. Electron remains the stable release path. The Tauri app must prove that the existing UI shape and core operations can run through a Tauri shell and a Node sidecar process before any migration decision is made.

The PoC supports:

- Tauri app scaffold and workspace scripts.
- A Node sidecar JSON-RPC contract.
- Health, analyze, optimize, and verify sidecar methods.
- A browser-side API adapter shaped like `window.hwpxOptimizer`.
- Tauri Rust command definitions that forward calls to the sidecar.
- Static tests that pin packaging, sidecar, and API contracts.

## Current PoC Limitations

The first implementation intentionally keeps several Electron behaviors out of the trusted path until the Tauri shell is proven:

- Drag/drop path registration is disabled because browser-provided dropped paths are not trusted.
- `openPath` and `showItem` return explicit errors until generated-path allowlisting is ported.
- Optimization progress events and cancellation are placeholders; Electron still has the complete worker-termination flow.
- Tauri binary packaging requires a Rust toolchain and platform system dependencies. The local Linux build now passes after installing `pkg-config`, `libglib2.0-dev`, `libgtk-3-dev`, `libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`, and `librsvg2-dev`.
- The current PoC uses Tauri-selected input/output paths only. Renderer-provided arbitrary file paths are rejected by Rust-side session allowlists.

## Sidecar Packaging

Tauri `externalBin` requires target-triple suffixed files such as `hwpx-sidecar-x86_64-unknown-linux-gnu` or `hwpx-sidecar-x86_64-pc-windows-msvc.exe`. The PoC uses `scripts/prepare-tauri-sidecar.mjs` to copy the active Node runtime into `apps/tauri-desktop/src-tauri/binaries/` with the expected suffix. The Rust shell launches that sidecar with the bundled `sidecar/index.js` resource path.

This is intentionally conservative. It proves Tauri can launch a Node sidecar without committing a large generated binary. The sidecar resource also bundles the compiled `@hwpx-optimizer/core` package and the runtime dependencies needed by the current core path. A later size-focused pass should compare this against `pkg`, `nexe`, Node SEA, or a Rust core port because the copied Node runtime is still the largest uncompressed component.

Observed build sizes from the Windows Tauri PoC workflow on Node 20.20.2:

- Tauri app executable: about 11.9 MB.
- Node sidecar executable: about 72.4 MB.
- NSIS installer: about 23.1 MB.

Out of scope for this first pass:

- Full visual parity with the Electron app.
- Windows installer signing.
- Rust port of `packages/core`.
- Removing the Electron app.
- Treating the PoC as the release app before the remaining Electron parity work is implemented.

## Architecture

`apps/tauri-desktop` is a second app inside the existing npm workspace. It reuses `packages/core` through a Node sidecar instead of reimplementing optimization in Rust. Tauri owns the native window, file dialogs, shell integration, and command bridge. The sidecar owns HWPX analysis, optimization, and verification by importing `@hwpx-optimizer/core`.

The frontend calls `window.hwpxOptimizer`, matching the Electron renderer API where possible. In Tauri, this object is provided by `src/tauriApi.ts` and backed by `@tauri-apps/api/core.invoke`. This keeps renderer migration incremental.

## Data Flow

```text
Tauri WebView UI
  -> window.hwpxOptimizer adapter
  -> Tauri Rust commands
  -> Node sidecar JSON lines over stdin/stdout
  -> packages/core
  -> local HWPX files
```

The sidecar protocol is newline-delimited JSON. Requests include `id`, `method`, and optional `params`. Responses include `id`, `ok`, and either `result` or `error`. This makes the sidecar testable without launching Tauri.

## Release Decision Criteria

The PoC is useful only if it can demonstrate:

- Sidecar methods work against existing core APIs.
- The Tauri shell can expose a renderer API close to Electron's preload API.
- The app can be built on a Rust-enabled machine.
- Windows distribution size is materially smaller than the Electron portable EXE.
- WebView2 dependency is acceptable for target Windows PCs.

If sidecar packaging or WebView2 deployment becomes the dominant operational risk, Electron remains the release path.
