# Release Quality Tracks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver verifier 512px aspect-preserving samples, Desktop near-dup review-only wiring, 960×780 window, public-CA signing prep, and Windows QA evidence on this machine.

**Architecture:** Core preview/metrics change first (gates optimize quality). Desktop analyze switches to deep diagnostics for near-dup chips without enabling merge. Signing script prefers org PFX env then self-signed. QA fills checklist from real runs.

**Tech Stack:** TypeScript monorepo, Vitest, Electron, sharp, osslsigncode, PowerShell portable smoke.

## Global Constraints

- Near-dup: review only — never auto-merge
- Public CA: prep only; self-signed default without `HWPX_WIN_CSC_*`
- Verifier thresholds unchanged (balanced 18/0.72, aggressive 14/0.55)
- Window: 960×780, min 920×700
- Never overwrite original HWPX inputs
- Do not commit `sample*.hwpx` / private reports

## File map

| File | Role |
|------|------|
| `packages/core/src/imagePreview.ts` | 512 + contain/letterbox metrics decode |
| `packages/core/test/*` | Preview/verifier regressions |
| `apps/desktop/src/main/desktopService.ts` | Default analyze `deep` (or near-dup on) |
| `apps/desktop/src/main/documentWorker.ts` | Pass-through if needed |
| `apps/desktop/src/index.html` | Review-only copy |
| `apps/desktop/src/main.ts` | Window size |
| `scripts/sign-self-signed-release-artifacts.mjs` | Org PFX env branch |
| `scripts/write-release-manifest.mjs` | Notice self-signed vs org |
| `docs/RELEASE.md`, `INTERNAL_DISTRIBUTION.md`, `SECURITY_REVIEW.md`, `KNOWN_LIMITATIONS.md`, `WINDOWS_QA_CHECKLIST.md`, `COMPLETION_AUDIT.md` | Docs + QA evidence |

---

### Task 1: Verifier sample geometry

**Files:**
- Modify: `packages/core/src/imagePreview.ts`
- Test: `packages/core/test/` (add or extend preview/verifier test)

**Interfaces:**
- Produces: `decodeForMetrics` samples at 512×512 with aspect preserved via `fit: "contain"` + neutral background (equal buffer lengths)

- [ ] **Step 1:** Add/adjust test that identical images still get high PSNR; differently-aspect images still return metrics (not null from length mismatch)
- [ ] **Step 2:** Change `PSNR_DEFAULT_SAMPLE_SIZE` / `SSIM_DEFAULT_SAMPLE_SIZE` to `512`; resize `{ fit: "contain", background: { r: 0, g: 0, b: 0 } }`
- [ ] **Step 3:** Run `npm test -- packages/core/test` relevant files; fix breakages
- [ ] **Step 4:** Commit `fix(core): sample verifier metrics at 512px contain`

### Task 2: Near-dup Desktop review-only

**Files:**
- Modify: `apps/desktop/src/main/desktopService.ts` (default `analysisMode: "deep"`)
- Modify: `apps/desktop/src/index.html` copy for disabled merge row
- Test: `apps/desktop/test/desktopService.test.ts` and/or `repoConfig.test.ts`

- [ ] **Step 1:** Test that analyze without options uses deep / near-dup groups populated when fixture supports it
- [ ] **Step 2:** Default `analysisMode` to `"deep"` in `analyzeDesktopFile`
- [ ] **Step 3:** Clarify UI: “검토만 · 자동 병합 안 함”
- [ ] **Step 4:** Commit `feat(desktop): enable near-dup review on analyze`

### Task 3: Default window size

**Files:**
- Modify: `apps/desktop/src/main.ts`
- Test: smoke/repoConfig if size asserted

- [ ] **Step 1:** Set width 960, height 780, minWidth 920, minHeight 700
- [ ] **Step 2:** Commit `chore(desktop): shrink default window to 960x780`

### Task 4: Public CA signing prep

**Files:**
- Modify: `scripts/sign-self-signed-release-artifacts.mjs` (consider rename later; keep filename for script stability)
- Modify: `scripts/write-release-manifest.mjs`
- Docs: RELEASE / INTERNAL_DISTRIBUTION / SECURITY_REVIEW

- [ ] **Step 1:** If `HWPX_WIN_CSC_LINK` (+ password) set, resolve PFX (path or base64→temp) and sign; else self-signed
- [ ] **Step 2:** Notice text distinguishes org vs self-signed
- [ ] **Step 3:** Document env vars; commit `feat(release): optional org PFX codesign path`

### Task 5: Windows QA evidence

**Files:**
- Modify: `docs/WINDOWS_QA_CHECKLIST.md`, `KNOWN_LIMITATIONS.md`, optionally `COMPLETION_AUDIT.md`

- [ ] **Step 1:** Run portable smoke / desktop smoke with samples if available
- [ ] **Step 2:** Hands-on notes for drag/drop/batch where possible
- [ ] **Step 3:** Fill checklist; honest 미실시 for Hancom/clean PC
- [ ] **Step 4:** Commit `docs: record Windows QA evidence for quality tracks`

### Task 6: Doc drift + gate smoke

- [ ] Fix COMPLETION_AUDIT SSIM “future” if present; ARCHITECTURE 256→512
- [ ] `npm test && npm run typecheck` (targeted then broad)
- [ ] Final summary for user
