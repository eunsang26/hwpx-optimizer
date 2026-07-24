# Phase A: Measurement / Gate — Design

- Date: 2026-07-24
- Status: revised after adversarial review — ready for implementation planning
- Scope: **dev-only measurement harness + Hangul compatibility spike**. No production optimizer policy change in this phase. No jpegli/WebP/AVIF ship decision without the gates below.

## 1. Problem & Goal

Four investment candidates (jpegli, perceptual-Q search, decode-once, WebP/AVIF) were narrowed by the rule **gate first**: spend cheap measurement before design completion.

**Phase A goal:** produce reproducible go/no-go evidence for:

1. **jpegli** — does it beat mozjpeg on an iso-quality rate–distortion basis enough to justify a later integration design?
2. **WebP / AVIF** — does Hangul actually render and round-trip them? (capacity is secondary and only measured after compat PASS)

**Out of Phase A (separate tracks):**

| Track | Why out |
| --- | --- |
| decode-once | Build-regardless; trustworthy speed needs real-path timers in its own build spec. Fake “core-untouched prototype” numbers are not a gate. |
| Perceptual-Q binary search | Absorbed into jpegli Q-sweep / RD curves; no separate “direction check.” |
| jpegli native / Windows sharp-unpack parity | Cost estimate only after **capacity-GO**; not part of Phase A GO. |
| Verifier 256×256 PSNR coarseness fix | File as follow-up issue; **not** a Phase A completion criterion. |

## 2. Non-Goals

- Do not change `packages/core` optimizer/verifier policy to emit jpegli, WebP, or AVIF.
- Do not add jpegli/avif to the desktop/CLI production dependency graph.
- Do not treat CI green as Phase A investment GO (real corpus is local-only; see §6).
- Do not commit real HWPX samples or their contents (existing sample gitignore policy).
- Do not implement decode-once refactor or perceptual-Q search productization.

## 3. Housing

| Choice | Detail |
| --- | --- |
| Location | `scripts/bench/` (tsx-runnable), **not** a new npm workspace package |
| Deps | Bench-only deps (jpegli wasm, SSIMULACRA2/butteraugli runner, etc.) stay out of production install paths — prefer `scripts/bench/package.json` **or** root `optionalDependencies` / documented `npm install` flags so Windows portable / Electron packing never pulls them. Implementation plan picks one; constraint is **zero impact on release artifacts**. |
| Core usage | Import public core APIs only: `readHwpxPackage`, image profile / resize budget helpers, `writeHwpxPackage`, `computeVisualMetrics` (auxiliary), BMP decode as needed. |
| Tests (keep two) | (1) Synthetic fixture(s) pass `readHwpxPackage`. (2) Candidates apply the **same resize budget** before encode (apple-to-apple invariant). No Hangul render automation. |

## 4. Dual quality axes (do not mix)

These are different experiments. Mixing them was the prior methodology bug.

| Axis | Reference | Role |
| --- | --- | --- |
| **A — Investment GO (primary)** | Pixels immediately before encode = **resized raw** (identical lanczos3 / display budget for every candidate) | Iso-quality RD: which encoder gives fewer bytes at the same perceptual distortion vs that raw reference |
| **B — Shipability check (secondary)** | **Original BinData ↔ candidate output**, same pairing as production `verifyHwpxOutput` | Does this output still clear the **current** coarse PSNR/SSIM gate? Fail → record “integration would need gate/profile adjustment,” **not** an automatic capacity NO-GO |
| **C — Drop-in similarity (diagnostic)** | mozjpeg baseline output ↔ candidate output | “How mozjpeg-like?” only; never used for % savings or GO |

**Primary GO wording:** “≥15% smaller at iso-quality **vs resized raw** (Axis A), measured as **package-byte** savings (§7).”  
Never: “≥15% at same PSNR vs mozjpeg output.”

## 5. Perceptual metric & iso-quality procedure

### 5.1 Single GO metric

Pick **one** full-resolution perceptual metric as the GO axis:

- **Preferred:** SSIMULACRA2 (higher = better).
- **Alternative:** butteraugli distance (lower = better).

Do **not** use both as simultaneous GO axes. The other may appear in JSON as diagnostics.

`imagePreview`’s 256×256 `fit:"fill"` PSNR/SSIM remains **Axis B auxiliary** only (“would current verifier pass?”), not the RD matching metric.

### 5.2 Q grid & matching

- Baseline encoder: sharp mozjpeg, same progressive/mozjpeg flags as production (`opportunities.ts` path).
- Candidate: jpegli (wasm) producing standard JPEG.
- Shared front-end: decode → apply **identical** resize budget / lanczos3 → raw; then encode-only differs.
- Q grid: at least the production anchors **Q88 (balanced)** and **Q80 (aggressive)**, plus enough neighbors to interpolate (e.g. 60–95 step 5, tighten near anchors if needed).
- **Iso-quality match:** for each image, take mozjpeg at the mode anchor Q; measure metric(raw, mozjpeg). Find jpegli Q (interpolate between grid points) that matches that metric within a fixed tolerance (specify in plan, e.g. SSIMULACRA2 ±0.5 or butteraugli ±0.05 — implementation picks after tool calibration). Compare **byte sizes at those operating points**.
- Curve never meets / candidate fails encode → that `(image, candidate)` is `error` or `no-data`; **exclude from median** (do not treat as 0% savings). Report exclusion count.

### 5.3 PNG axis (independent row)

HWPX often has screenshots / BMP→PNG weight. Track separately so PNG results cannot flip jpegli GO:

| Row | Baseline | Candidate | Compat |
| --- | --- | --- | --- |
| JPEG / jpegli | mozjpeg | jpegli | N/A (still `.jpg`) |
| PNG keep | current sharp PNG profile | same (control) | N/A |
| PNG→WebP | sharp PNG | WebP | **Hangul matrix PASS only** |

Per `(image, candidate)` failure taxonomy (mark, continue): CMYK, alpha/transparency, ICC, EXIF orientation, progressive JPEG, GIF, unsupported BMP variant, wasm load fail (disables jpegli only).

## 6. Corpus & reproducibility

| Rule | Detail |
| --- | --- |
| Env | `HWPX_BENCH_DIR` → local real documents (never committed) |
| Synthetic fixtures | Under `scripts/bench/fixtures/` for reader + apple-to-apple tests / smoke only |
| **Synthetic-only run** | **NO-GO** for investment (not a banner — hard invalid for GO). Smoke may still run. |
| GO validity | Real corpus present **and** matches committed **hashed corpus manifest** |
| Manifest | Commit `scripts/bench/corpus.manifest.json` (or similar): relative names + sizes + content hashes only — **no document bytes**. Local tree must match hashes or GO is invalid. |
| CI | Fixture smoke + invariant tests only. **CI green ≠ Phase A GO.** |

## 7. What “bytes” means for GO

| Level | Use |
| --- | --- |
| Per-image outBytes | Diagnostics, failure taxonomy, RD plots |
| **Package bytes (GO)** | Substitute BinData (and manifest href/media-type when format changes) into the package and repack with **product** [`writeHwpxPackage`](../../../packages/core/src/writer.ts) (DEFLATE as production). Prefer enabling the same duplicate-consolidation behavior the optimizer uses; report **with consolidation on and off** if both are cheap — **GO uses the production-like (on) number**. |

**GO statistic:** median of **per-document package-byte savings %** over the real corpus (each document: mozjpeg-substituted package vs jpegli-iso-quality-substituted package, same non-image entries).  
Per-image unweighted median % is diagnostic only (large photos dominate user-visible wins).

Also report: images where recompress **grows** bytes; interaction with production skip floors (metadata/PNG min savings) as informational counts — not a separate GO.

## 8. Timing (report, soft flag)

Measure and report separately — do not mix columns:

| Column | Definition |
| --- | --- |
| Image-CPU encode ratio | Candidate encode time / mozjpeg encode time at the **iso-quality operating point** (same raw input) |
| Document wall-clock % | Full bench path for that document (read → shared resize → encode all → write), candidate vs baseline |

- **Capacity GO** does not hard-fail on encode time.
- Soft flag if image-CPU encode ratio **> ~2×** at iso-quality (investigation / cost note for later integration).
- Wall-clock % is the human-relevant latency signal for the cost estimate doc after capacity-GO.

Warmup: discard first encode per process; note cold wasm load separately.

## 9. WebP / AVIF compatibility spike (before capacity)

### 9.1 Order

1. Build minimal valid HWPX spikes: `webp-test.hwpx`, `avif-test.hwpx`, `jpeg-control.hwpx`, plus mixed `jpeg+webp-test.hwpx`.
2. Emit `CHECKLIST.md` with blank version IDs.
3. Human fills `RESULT.md` on **≥2 Hangul versions** (product name + build/version string).
4. **Compat matrix PASS** is the only WebP/AVIF gate. Capacity bench runs **only** for formats that PASS.
5. If WebP FAIL → **skip AVIF capacity work** (optional: still try AVIF open once for curiosity; no requirement).

### 9.2 Matrix (each cell: pass/fail + notes)

For each format ∈ {WebP, AVIF} × each Hangul version:

- Open / render
- Save As (different name)
- Re-open saved file
- Mixed doc (JPEG + candidate format)
- Print preview and/or PDF export when available

`jpeg-control.hwpx` must pass the same flow on those versions (environment sanity).

### 9.3 Policy / verifier gate (explicit)

Hangul render OK **≠** shippable. Today [`isAllowedAdvancedFormat`](../../../packages/core/src/verifier.ts) allows BMP/TIFF→PNG, JPEG→JPEG, PNG→PNG only. Phase A must record a **decision checkbox**:

- [ ] Product policy + verifier (+ manifest media-type / extension rewrite) change is accepted as a follow-on project if compat PASS.

Without that, WebP/AVIF remain research-only even after a green matrix.

## 10. GO summary

| Workstream | GO | NO-GO / invalid |
| --- | --- | --- |
| jpegli capacity | Real corpus + manifest match; Axis A iso-quality; **median document package savings ≥ 15%**; exclusions reported | Synthetic-only; manifest mismatch; median &lt; 15%; too many exclusions to trust (call out threshold in plan, e.g. &gt;20% images no-data) |
| jpegli integrate cost | **Out of Phase A** — separate estimate after capacity-GO (wasm vs native, Windows unpack) | — |
| WebP/AVIF | Compat matrix PASS on ≥2 Hangul versions | Any critical cell FAIL (open/save/reopen). Capacity numbers informational only after PASS |
| decode-once / perceptual-Q | Not in Phase A | — |

Soft flags (do not alone NO-GO capacity): encode CPU > ~2×; Axis B verifier failures; recompress-grow heavy tails; PNG→WebP interesting but JPEG row weak (or vice versa) — track as independent rows.

## 11. Error handling

- Per `(image, candidate)` failure → mark error, continue corpus.
- jpegli wasm load failure → disable jpegli candidate only; still run baseline + compat spike artifacts if requested.
- Metric tool missing → fail the bench run clearly (GO invalid); do not silently fall back to 256px PSNR for Axis A.

## 12. Deliverables

```
scripts/bench/
  README.md                 How to set HWPX_BENCH_DIR, run, interpret GO
  corpus.manifest.json      Hashes only (committed)
  fixtures/                 Synthetic HWPX for tests/smoke
  src/                      corpus, candidates, rdCurve, packageBytes, spike, report
  out/                      gitignored JSON (+ optional charts)
spike/ or scripts/bench/out/spike/
  webp-test.hwpx, avif-test.hwpx, jpeg-control.hwpx, jpeg-webp-mixed.hwpx
  CHECKLIST.md, RESULT.md   RESULT filled by human; may stay local
```

Top-level report JSON fields must include: axis definitions, metric id + version, corpus manifest id, per-doc package %, median, exclusion counts, timing columns, Axis B pass rates, soft flags, GO boolean + invalid reason.

## 13. Follow-ups (explicitly not Phase A)

1. decode-once: instrument real `optimize` path with temporary span timers → then refactor spec.
2. Verifier: replace or supplement 256×256 PSNR with a fuller perceptual gate (product change).
3. jpegli integration design + Windows packaging cost (only if capacity-GO).
4. WebP/AVIF productization (only if compat PASS **and** policy/verifier checkbox accepted).

## 14. Spec self-review notes

- Axis A vs B roles fixed to prevent baseline-PSNR underestimation of jpegli.
- Package-byte GO + document median avoids image-% lies and zip/deflate blind spots.
- Product `writeHwpxPackage` required so bench ZIP ≠ fantasy ZIP.
- CI cannot launder GO without real corpus.
- Scope cut: decode-once, perceptual-Q-as-separate, full `packages/bench` workspace, capacity threshold as WebP gate.
