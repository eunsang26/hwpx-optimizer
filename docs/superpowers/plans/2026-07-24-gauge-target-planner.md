# Gauge Target Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship A안 desktop UX + continuous target-fit JPEG quality planner with correct pass/need/miss verdicts and batch quality/allocation rules.

**Architecture:** Core gains a continuous quality search and a pure planner estimate helper. Desktop maps preservation → mode, defaults to 40MB/per-file, and surfaces gauge + quality controls. CLI keeps existing flags; desktop is the primary UX surface.

**Tech Stack:** TypeScript, Vitest, existing `optimize.ts` / `opportunities.ts`, Electron renderer HTML/CSS/TS.

---

### Task 1: Core continuous quality + max policy

**Files:**
- Modify: `packages/core/src/optimize.ts`
- Modify: `packages/core/src/opportunities.ts` (export quality bounds if needed)
- Test: `packages/core/test/balanced.test.ts` or new `targetQuality.test.ts`

- [x] Add `QUALITY_FLOOR=60`, `QUALITY_CEILING=95` (or mode-specific)
- [x] Balanced + `targetBytes`: binary-search jpegQuality (couple maxEdge lightly or keep display budget)
- [x] Aggressive: always use aggressive profile floor; do not early-return on target met
- [x] Optional `options.jpegQuality` manual override skips search
- [x] Tests for fit stop / max continues

### Task 2: Planner estimate + verdict

**Files:**
- Create: `packages/core/src/targetPlan.ts` (or desktop `shared/targetPlan.ts` if buffer-free estimate only needs report)
- Prefer desktop-shared first using `OptimizationReport` to avoid heavy encode in analyze UI
- Test: `apps/desktop/test/targetPlan.test.ts`

- [x] `planTargetOutcome({ original, expectedAtQuality, expectedAtFloor, target })` → pass|need|miss
- [x] Estimate curve from opportunity savings × quality ratio (reuse opportunities helpers)

### Task 3: Desktop defaults + allocation

**Files:**
- `apps/desktop/src/shared/submissionPlan.ts` — `mb40`, labels
- `apps/desktop/src/main/desktopService.ts` — default settings
- `apps/desktop/src/renderer.ts` — per-file default, selected-only aggregate alloc
- `apps/desktop/src/index.html` — limit option

- [x] Default submission limit to 40MB and migrate the legacy 41MB value
- [x] Default batch allocation to per-file and support selected-only aggregate allocation
- [x] Keep Desktop service, renderer, and browser preview defaults aligned

### Task 4: UI A — gauge, quality, batch rows

**Files:**
- `apps/desktop/src/index.html`, `styles.css`, `renderer.ts`, `viewModel`/`templates` as needed

- [x] Hero verdict + gauge
- [x] Quality auto/manual controls
- [x] Batch: no top slider in auto; bulk manual; row override
- [x] Options sheet under CTA

### Task 5: Verify

- [x] `npm test --` targeted then broader
- [x] `npm run typecheck`
