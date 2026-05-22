# Target Size Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add target-size behavior that keeps single-file optimization goal-aware and lets batch mode optimize toward an aggregate output-size goal.

**Architecture:** Keep optimization in the existing TypeScript core and CLI/desktop orchestration layers. Preserve local-only behavior, never mutate source files, and expose aggregate batch targets separately from existing per-file targets.

**Tech Stack:** TypeScript, Vitest, Electron IPC, npm workspaces.

---

### Task 1: CLI Batch Aggregate Target

**Files:**
- Modify: `packages/cli/src/index.ts`
- Test: `packages/cli/test/cli.test.ts`

- [x] Add `--batch-target-bytes` and `--batch-target-mb` parsing with mutual exclusion from per-file target flags.
- [x] Allocate aggregate target bytes across batch files by original input size.
- [x] Pass the allocated target to each file optimization.
- [x] Record aggregate fields in `batch-report.json`: `batchTargetBytes`, `batchTargetStatus`, `totalOriginalSize`, `totalOptimizedSize`, and `batchTargetMissReason`.
- [x] Run targeted CLI tests.

### Task 2: Desktop Batch Aggregate Target

**Files:**
- Modify: `apps/desktop/src/main/desktopService.ts`
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/desktop/src/preload.ts`
- Modify: `apps/desktop/src/renderer.ts`
- Test: `apps/desktop/test/desktopService.test.ts`
- Test: `apps/desktop/test/batchView.test.ts`

- [x] Add optional per-call `targetBytes` override to desktop optimization IPC.
- [x] In desktop batch runs, allocate the selected submission limit across analyzed files by original size.
- [x] Persist aggregate target fields in saved desktop batch reports.
- [x] Update batch summary/result copy to show aggregate target status.
- [x] Run targeted desktop tests.

### Task 3: Verification and Delivery

**Files:**
- Verify all changed packages.

- [x] Run targeted tests first.
- [x] Run `npm test`.
- [x] Run `npm run typecheck`.
- [x] Run `npm run build`.
- [ ] Run release/build command available for this repo and report any platform limits.
- [ ] Commit, push branch, and report deployment artifact state.
