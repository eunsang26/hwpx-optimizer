# Release Quality Tracks Design (2026-07-26)

## Goal

Ship four coordinated quality tracks after `v0.1.2` without waiting on a public CA certificate:

1. Windows QA evidence on this machine (automated + hands-on)
2. Near-duplicate **review-only** exposure in Desktop
3. Public CA code-signing **prep** (pipeline/docs/gates; self-signed remains default)
4. Light verifier sample improvement (no threshold retune)

Also set Desktop default window size to match the denser gauge UI.

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| Public CA | **Prep only** — no cert yet; keep self-signed release path |
| Near-dup | **Review only** — detect + UI; never auto-merge |
| Verifier | **Light** — 512px `inside` sample; keep PSNR/SSIM thresholds |
| Windows QA | **Automate + run on this PC**; Hancom-open items may stay “not run” |
| Default window | **960×780**, min **920×700** |

## Non-goals

- Near-duplicate auto-merge / consolidate by aHash similarity
- SSIMULACRA2 (or other Phase A metrics) as product verifier gate
- Raising/lowering balanced/aggressive PSNR/SSIM thresholds
- Purchasing or installing a public CA certificate in this cycle
- Claiming “clean Windows QA complete” if Hancom/clean-machine items are not actually run

---

## Track 1 — Windows QA

### Scope

- Run what this environment can run: portable smoke, desktop smoke with real samples when present, drag/drop and batch hands-on on Windows-visible artifacts.
- Fill `docs/WINDOWS_QA_CHECKLIST.md` with dated pass/fail/not-run cells.
- Update `docs/KNOWN_LIMITATIONS.md` / completion notes to match evidence (do not over-claim).

### Automated

- `npm run release:check:win-portable` (or equivalent already-green subset if full gate is redundant)
- `npm run release:verify-win-portable-smoke` with optional `HWPX_OPT_SMOKE_INPUT` when local samples exist
- Existing Electron smoke regressions (drag/drop overlay, analysis details)

### Manual on this PC

- Launch packaged ZIP/EXE, drag/drop single + multi, safe/balanced/aggressive once each if samples allow
- Batch flow smoke
- Settings persistence quick check
- Mark Hancom open / institutional clean-PC items **미실시** if tools/machine unavailable

### Success

Checklist has concrete evidence rows; limitations doc no longer implies “zero Windows hands-on” if we did run local Windows paths.

---

## Track 2 — Near-duplicate review-only

### Current gap

Core can detect near-dups (`findNearDuplicateImageGroups`, aHash Hamming ≤ 6), but Desktop analyze uses `analysisMode: "quick"`, which disables near-dup diagnostics. UI checkbox “유사 이미지 병합” is permanently disabled (correct for merge).

### Behavior

1. Desktop analyze requests near-dup diagnostics (prefer `analysisMode: "deep"` **or** an explicit `includeNearDuplicateImages: true` if a lighter deep subset is cleaner — prefer the smallest API change that populates report groups).
2. Renderer shows existing chips/warnings/guidance from real `nearDuplicateImageGroups` counts.
3. Merge checkbox stays **disabled**, labeled as review-only / default off (no enable path).
4. Optimize paths unchanged: no near-dup merge action.
5. Verifier continues to analyze with near-dup off (performance; merge not applied).

### Performance note

Deep-ish analyze may cost more CPU on large Bindata sets. Acceptable for Desktop; if needed, document “유사 이미지 검토는 분석에 추가 시간이 걸릴 수 있음”.

### Tests

- Desktop/shared tests: analyze options enable near-dup fields when fixture has near-dups (or unit-level service option assertion).
- Core already covered; add Desktop wiring test if missing.

---

## Track 3 — Public CA signing prep

### Current

Self-signed PFX via `ensure-self-signed-codesign-cert.mjs` + `sign-self-signed-release-artifacts.mjs`. Release notice treats “has Authenticode table” as self-signed.

### Behavior when cert **absent** (default)

Identical to today: generate/use self-signed PFX, sign portable EXE + unpacked EXE, rebuild ZIP, verify PE cert table.

### Behavior when cert **present** (future)

Document and wire env (do not require values in CI):

| Env | Meaning |
|-----|---------|
| `HWPX_WIN_CSC_LINK` | Path or base64 to org PFX (preferred project-specific name; also document electron-builder `CSC_LINK` alias if used) |
| `HWPX_WIN_CSC_KEY_PASSWORD` | PFX password |

Signing script preference order:

1. If org PFX env present → sign with that material
2. Else → existing self-signed path

Release notice / manifest:

- Distinguish **self-signed** vs **organization/public-CA PFX** (subject/issuer string if available)
- Do not claim SmartScreen reputation improvement without EV + reputation history

Verification:

- Keep PE Authenticode table check
- Optionally record publisher subject when parsable; do **not** fail gate on untrusted root in this prep cycle

### Docs

Update `INTERNAL_DISTRIBUTION.md`, `SECURITY_REVIEW.md`, `RELEASE.md` with “how to plug in CA PFX” and “what remains self-signed until then”.

---

## Track 4 — Verifier light improvement

### Change

In `packages/core/src/imagePreview.ts` (and any shared constant):

- Sample size **256 → 512**
- Resize fit **`fill` → `inside`** (preserve aspect; letterboxing/padding as sharp requires for equal compare dims — implementation must keep both sides comparable without distorting)

### Unchanged

- Mode thresholds: balanced PSNR 18 / SSIM 0.72; aggressive 14 / 0.55
- Safe mode: structural only
- Format/dimension rules in `verifier.ts`

### Docs

- Fix stale “SSIM is future” in `COMPLETION_AUDIT.md` if still present
- Align ARCHITECTURE / KNOWN_LIMITATIONS wording with 512px inside sampling

### Tests

- Update or add preview/verifier tests that assume sample geometry if any hard-code 256
- Regression corpus / existing verifier tests must still pass

---

## Desktop window size

In `apps/desktop/src/main.ts` `BrowserWindow` defaults:

| | Value |
|--|------|
| width × height | **960 × 780** |
| minWidth × minHeight | **920 × 700** |

Smoke assertions that depend on layout width should remain valid or be updated if they assume larger chrome.

---

## Delivery order

1. Verifier sample change + tests  
2. Near-dup Desktop analyze wiring + UI copy  
3. Window size constants  
4. CA signing prep (script + docs + notice distinction)  
5. Windows QA runs + checklist / limitations updates  

Commits separated by intent (conventional): `fix(core)`, `feat(desktop)`, `chore(desktop)`, `feat(release)`, `docs`.

## Risks

| Risk | Mitigation |
|------|------------|
| Deep analyze slower | Accept; copy in UI; keep merge off |
| 512px compare changes pass/fail edge cases | Keep thresholds; run corpus + verifier tests |
| CA env mis-set breaks signing | Fall back to self-signed only when org env absent; if present and sign fails, fail loudly |
| Over-claiming Windows QA | Explicit 미실시 cells |

## Success criteria

- [ ] Verifier uses 512 / inside; thresholds unchanged; tests green  
- [ ] Desktop shows near-dup review signals on documents that have them; merge stays off  
- [ ] Default window 960×780 / min 920×700  
- [ ] CA PFX path documented and coded but unused without env  
- [ ] Windows QA checklist filled from this PC run; limitations updated honestly  
