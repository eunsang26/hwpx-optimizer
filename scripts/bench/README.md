# Phase A measurement bench (dev-only)

This directory holds the jpegli capacity GO/NO-GO harness and Hangul WebP/AVIF compatibility spike artifacts. It does not change production optimizer policy or release dependencies.

**Spec:** [docs/superpowers/specs/2026-07-24-phase-a-measurement-gate-design.md](../../docs/superpowers/specs/2026-07-24-phase-a-measurement-gate-design.md)

**Implementation plan:** [docs/superpowers/plans/2026-07-24-phase-a-measurement-gate.md](../../docs/superpowers/plans/2026-07-24-phase-a-measurement-gate.md)

## Prerequisites

- Node.js 20+ (same as the monorepo root).
- Root `npm install` (provides `sharp` and `@hwpx-optimizer/core`).
- External CLIs on PATH or via env vars (not npm dependencies):

| Tool | Resolve order | Purpose |
| --- | --- | --- |
| `cjpegli` | `HWPX_BENCH_JPEGLI` → `cjpegli` on PATH | jpegli encode candidate |
| `ssimulacra2` | `HWPX_BENCH_SSIMULACRA2` → `ssimulacra2` on PATH | Axis A perceptual metric |

### Installing external CLIs

**jpegli (`cjpegli`):** libjxl **v0.11.2** static bundle still ships `tools/cjpegli` (v0.12+ dropped it). Example:

```bash
curl -sL -o /tmp/jxl-static.zip \
  https://github.com/libjxl/libjxl/releases/download/v0.11.2/jxl-linux-x86_64-static.zip
mkdir -p ~/.local/libjxl-0.11.2 && cd ~/.local/libjxl-0.11.2
unzip -q /tmp/jxl-static.zip && tar xzf release_file.tar.gz
export HWPX_BENCH_JPEGLI="$PWD/tools/cjpegli"
```

The bench invokes:

```text
cjpegli INPUT.ppm OUTPUT.jpg -q QUALITY --quiet
```

If the binary is not on PATH, set an absolute path:

```bash
export HWPX_BENCH_JPEGLI=/path/to/cjpegli
```

**SSIMULACRA2:** install a CLI that accepts `REFERENCE.png DISTORTED.jpg` and prints a float score. Options:

- [libjxl v0.11.2 static `tools/ssimulacra2`](https://github.com/libjxl/libjxl/releases/tag/v0.11.2) (same tarball as above), or
- Rust [`as2c`](https://github.com/BuyMyMojo/another_ssimulacra2_cli): `cargo install as2c` then `export HWPX_BENCH_SSIMULACRA2=as2c`

Override with:

```bash
export HWPX_BENCH_SSIMULACRA2=/path/to/ssimulacra2
```

If SSIMULACRA2 is missing, `rd` still writes a report but marks the run **INVALID** (`metric-tool-missing`). If jpegli is missing, the jpegli row is disabled (`jpegli-unavailable`).

## Real corpus setup (`HWPX_BENCH_DIR`)

1. Place real `.hwpx` files in a local directory (never commit document bytes).
2. Hash and update the committed manifest:

```bash
export HWPX_BENCH_DIR=/path/to/your/hwpx/corpus
npm run bench:manifest
```

3. Commit only the updated `corpus.manifest.json` (SHA-256 hashes and sizes, no file contents).

When `HWPX_BENCH_DIR` is unset or empty, the bench runs **fixtures only**. That smoke path is useful for CI and local wiring checks, but it is **INVALID for investment GO** (`invalidReason: synthetic-only`).

## RD capacity run (jpegli GO)

```bash
# Fixtures-only smoke (INVALID for GO)
npm run bench -- rd --profile balanced

# Real corpus (required for GO eligibility)
HWPX_BENCH_DIR=/path/to/corpus npm run bench -- rd --profile balanced
HWPX_BENCH_DIR=/path/to/corpus npm run bench -- rd --profile aggressive
```

Output: `scripts/bench/out/rd-report.json`

Prints `GO`, `NO-GO`, or `INVALID` on stderr. Exit code is **0 whenever the report is written** — a NO-GO or INVALID result does not fail the process (CI must not treat green CI as investment GO).

### Reading the GO verdict

Primary statistic: **median per-document package-byte savings %** at iso-quality (SSIMULACRA2-matched jpegli vs mozjpeg anchor), balanced profile primary (Q88, display scale 2).

| Field | Meaning |
| --- | --- |
| `go` | `true` only when corpus is GO-eligible, jpeg exclusion ≤ 20%, and median savings ≥ 15% |
| `goReason` | Human-readable reason when `go` is false |
| `corpus.goEligible` | `false` for synthetic-only or manifest mismatch |
| `corpus.invalidReason` | e.g. `synthetic-only`, `manifest-mismatch`, `metric-tool-missing`, `jpegli-unavailable` |
| `jpegli.medianPackageSavingsPercent` | Primary GO metric |
| `jpegli.jpegExclusionRatio` | Share of JPEG images with no iso-quality match; > 20% invalidates GO |
| `softFlags` | Investigation hints (encode CPU > 2×, Axis B failures, recompress-grow) — do not alone flip GO |

**CI ≠ GO:** CI runs fixture/invariant tests only. A green CI run without `HWPX_BENCH_DIR` and external metric tools does not approve jpegli investment.

**Capacity-GO ≠ integration approval:** Even a GO on real corpus does not approve Windows packaging, wasm vs native cost, or product integration — those are separate follow-ons.

Axis B (`computeVisualMetrics` on original BinData) is secondary and recorded for diagnostics; it does not flip the primary GO boolean.

## Hangul WebP/AVIF compatibility spike

Generate spike artifacts (no real corpus required):

```bash
npm run bench:spike
```

Writes to `scripts/bench/out/spike/`:

| File | Purpose |
| --- | --- |
| `jpeg-control.hwpx` | JPEG sanity baseline |
| `webp-test.hwpx` | Single WebP image |
| `avif-test.hwpx` | Single AVIF image (skipped if local sharp cannot encode AVIF) |
| `jpeg-webp-mixed.hwpx` | JPEG + WebP in one document |
| `CHECKLIST.md` | Manual test matrix (Version A / B columns) |
| `RESULT.md` | Empty template — fill locally after testing |
| `POLICY_CHECKBOX.md` | Explicit product-policy gate before any ship decision |

Open each `.hwpx` in **≥2 Hangul versions**, complete `CHECKLIST.md`, and copy results into `RESULT.md` locally. Do not commit filled results (may contain environment details).

**WebP/AVIF capacity work** runs only for formats that pass the human compatibility matrix. Hangul render OK ≠ shippable: production verifier still allows BMP/TIFF→PNG, JPEG→JPEG, PNG→PNG only until policy and `isAllowedAdvancedFormat` change in a follow-on project (see `POLICY_CHECKBOX.md`).

## Smoke verification (no real corpus)

```bash
npm test -- scripts/bench
npm run bench:spike
npm run bench -- rd --profile balanced
```

Expect the RD smoke run to write `out/rd-report.json` with `go: false` and `invalidReason: synthetic-only` (and often `metric-tool-missing` or `jpegli-unavailable` when CLIs are absent).

## npm scripts

| Script | Command |
| --- | --- |
| `npm run bench -- rd --profile balanced` | RD report + GO verdict |
| `npm run bench:manifest` | Update `corpus.manifest.json` from `HWPX_BENCH_DIR` |
| `npm run bench:spike` | Emit Hangul compatibility spike artifacts |

## Related follow-ups (not Phase A)

- Verifier 256×256 PSNR gate may be supplemented in a future product change; Phase A Axis A uses full-res resized raw + SSIMULACRA2 only.
- decode-once instrumentation and perceptual-Q tuning are out of scope for this harness.
