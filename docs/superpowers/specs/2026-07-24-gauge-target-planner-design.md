# Gauge UI + Target Quality Planner — Design

Date: 2026-07-24  
Status: approved via mockup iteration (A안)

## Product policies

1. **Default submission limit:** under 40MB (`mb40`, label `40MB 미만`).
2. **Batch judgment default:** per-file (each file &lt; 40MB). Aggregate is optional.
3. **Preservation:**
   - `preserve` (safe): no image quality ladder.
   - `recommended` (balanced): **target-fit** — compress only as far as needed.
   - `size` (aggressive): **always max** — ignore early stop at target.
4. **Verdict labels:**
   - `제출 가능` — planned/expected size under limit.
   - `더 압축 필요` — current/manual quality over limit, but floor quality would pass.
   - `기준 미달` — even at quality floor (max compression), still over limit.
5. **JPEG quality:** continuous integer in `[60, 95]` (not discrete ladder only).
   - Auto: binary-search highest quality that meets `targetBytes` (balanced).
   - Manual: slider + number; optional per-file override in batch.
6. **Batch quality UX:**
   - Auto: no top JPEG slider; per-row planned `%`; click row `%` to override one file.
   - Bulk manual: top slider/number applies to all selected; row number overrides one file.
7. **Aggregate mode:** recompute per-file byte budgets from **selected** files only whenever selection changes.
8. Fonts / near-dup: report/review only; not auto-removed (existing). Detail options sheet under CTA.

## Engine

- Replace/augment `createTargetProfileLadder` discrete steps with continuous `jpegQuality` search when `targetBytes` is set and mode is balanced.
- Aggressive with target still runs at aggressive floor (no “stop when met”).
- Planner estimate API for UI: given report + target + mode + optional manual quality → expected size + verdict + planned quality.

## Desktop UI (A)

- Hero = submission verdict + capacity gauge vs 40MB tick.
- Planned JPEG quality control (auto/manual).
- Detail options = anchored sheet under CTA.
- Help/settings = existing right sheets (keep).
- Typography/density tokens from mockup (Pretendard retained).

## Non-goals (this pass)

- Font subsetting / auto font drop.
- Near-duplicate auto-merge (stays default OFF).
- Full visual restyle of every leftover panel in one PR if timeboxed — hero + quality + defaults + verdict first.
