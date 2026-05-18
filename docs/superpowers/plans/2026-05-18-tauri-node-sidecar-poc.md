# Tauri Node Sidecar PoC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second Tauri desktop app that talks to the existing TypeScript core through a Node sidecar.

**Architecture:** Keep `apps/desktop` as the Electron release app. Add `apps/tauri-desktop` as a separate workspace with a Tauri shell, a browser API adapter, and a Node JSON-RPC sidecar importing `@hwpx-optimizer/core`. Tests pin the scaffold and sidecar protocol before implementation.

**Tech Stack:** npm workspaces, TypeScript, Vitest, Tauri v2, Rust, Node sidecar, `@hwpx-optimizer/core`.

---

### Task 1: Contract Tests

**Files:**
- Create: `apps/tauri-desktop/test/tauriConfig.test.ts`
- Create: `apps/tauri-desktop/test/sidecarProtocol.test.ts`

- [x] **Step 1: Write failing tests**

Add tests that assert the workspace includes `apps/tauri-desktop`, Tauri config exists, `externalBin` references the sidecar, the browser adapter exposes `window.hwpxOptimizer`, and the sidecar can respond to a `health` request.

- [x] **Step 2: Run tests to verify RED**

Run:

```bash
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm test -- apps/tauri-desktop/test/tauriConfig.test.ts apps/tauri-desktop/test/sidecarProtocol.test.ts
```

Expected: fail because the scaffold and sidecar files are missing.

### Task 2: Tauri Scaffold

**Files:**
- Create: `apps/tauri-desktop/package.json`
- Create: `apps/tauri-desktop/tsconfig.json`
- Create: `apps/tauri-desktop/src/index.html`
- Create: `apps/tauri-desktop/src/main.ts`
- Create: `apps/tauri-desktop/src/tauriApi.ts`
- Create: `apps/tauri-desktop/src-tauri/Cargo.toml`
- Create: `apps/tauri-desktop/src-tauri/tauri.conf.json`
- Create: `apps/tauri-desktop/src-tauri/src/main.rs`
- Modify: `package.json`

- [x] **Step 1: Add workspace and scripts**

Add `apps/tauri-desktop` to npm workspaces and top-level scripts for `tauri:build`, `tauri:dev`, and `tauri:sidecar`.

- [x] **Step 2: Add Tauri frontend adapter**

Implement `src/tauriApi.ts` so the renderer gets a `window.hwpxOptimizer` object with analyze, optimize, verify, file selection, settings, and shell methods.

- [x] **Step 3: Add Rust shell commands**

Implement Tauri commands that call the sidecar for HWPX operations and use Tauri dialog/shell plugins for native integration.

### Task 3: Node Sidecar

**Files:**
- Create: `apps/tauri-desktop/sidecar/index.ts`
- Create: `apps/tauri-desktop/sidecar/protocol.ts`
- Create: `apps/tauri-desktop/sidecar/desktopCore.ts`

- [x] **Step 1: Implement JSON-RPC line protocol**

Read newline-delimited JSON from stdin and write newline-delimited responses to stdout.

- [x] **Step 2: Implement core methods**

Support `health`, `analyze`, `optimize`, and `verify` through `@hwpx-optimizer/core`.

- [x] **Step 3: Run protocol tests**

Run the sidecar protocol test and confirm it passes.

### Task 4: Verification

**Files:**
- Modify only files required by failing tests.

- [x] **Step 1: Run targeted tests**

```bash
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm test -- apps/tauri-desktop/test/tauriConfig.test.ts apps/tauri-desktop/test/sidecarProtocol.test.ts
```

- [x] **Step 2: Run repo gates**

```bash
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm test
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm run typecheck
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm run build
```

- [x] **Step 3: Record environment blocker**

If `cargo` is unavailable, record that Rust/Tauri binary build was not run in this environment and list the command to run on a Rust-enabled Windows or Linux machine.
