# Phase A measurement bench (dev-only)

This directory holds the jpegli capacity GO/NO-GO harness and Hangul WebP/AVIF compatibility spike artifacts. It does not change production optimizer policy or release dependencies.

**Spec:** [docs/superpowers/specs/2026-07-24-phase-a-measurement-gate-design.md](../../docs/superpowers/specs/2026-07-24-phase-a-measurement-gate-design.md)

**Implementation plan:** [docs/superpowers/plans/2026-07-24-phase-a-measurement-gate.md](../../docs/superpowers/plans/2026-07-24-phase-a-measurement-gate.md)

## Prerequisites

- Node.js **22.12+ (recommended 24.21 LTS)** for bench execution (`sharp` 0.35). Root `package.json` `engines` matches this.
- If your shell default is older Node, `npm run bench:*` auto-reexecs via `scripts/bench/run.mjs` when `~/.nvm/versions/node/v24.21.0/bin/node` exists, or set `HWPX_OPT_NODE`.
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

If SSIMULACRA2 is missing, `rd` still writes a report but marks the run **INVALID** (`metric-tool-missing`). Missing jpegli similarly produces **INVALID** (`jpegli-unavailable`). A configured executable that cannot be spawned is recorded in the same way, including when it disappears during a document; earlier results remain visible and remaining documents are marked skipped.

## Real corpus setup (`HWPX_BENCH_DIR`)

1. Place real `.hwpx` files in a local directory (never commit document bytes).
2. Hash and update the committed manifest:

```bash
export HWPX_BENCH_DIR=/path/to/your/hwpx/corpus
npm run bench:manifest
```

3. Commit only the updated `corpus.manifest.json` (SHA-256 hashes and sizes, no file contents).

When `HWPX_BENCH_DIR` is unset or empty, the bench runs **fixtures only**. That smoke path is useful for CI and local wiring checks, but it is **INVALID for investment GO** (`invalidReason: synthetic-only`).

A matching empty corpus is also **INVALID** (`empty-corpus`). A manifest mismatch runs only fixtures and remains **INVALID**; it does not make fixture results evidence about the real corpus.

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
| `go` | `true` only with an eligible nonempty real corpus, available tools, complete document processing, a matched JPEG in each JPEG-bearing document, JPEG exclusion ≤ 20%, and median savings ≥ 15% |
| `goReason` | Stable reason code, including `document-processing-failed`, `document-no-valid-jpegs`, `jpeg-exclusion-too-high` or `median-below-threshold` |
| `corpus.goEligible` | `false` for synthetic-only, manifest mismatch or an empty real corpus |
| `corpus.invalidReason` | Corpus eligibility reason: `synthetic-only`, `manifest-mismatch`, `empty-corpus` |
| `invalidReasons` | Run invalidity reasons, retaining corpus eligibility and the blocking tool problem together |
| `corpus.documentCount` / `statistics.documentCount` | Number of documents in the selected statistics scope, including failed/skipped/no-data documents. Fixture-only runs now report their fixture count instead of zero |
| `corpus.realDocumentCount` / `fixtureDocumentCount` | Source counts; fixtures never enlarge the real-corpus denominator |
| `documents` | One row per loaded document: source/relative name, status, stage/image/reason/message, measured stats or null, statistics inclusion and median exclusion reason |
| `statistics` | Explicit `real` or `fixture` scope; failed/partial/no-data/skipped counts and the actual median document count |
| `jpegli.medianPackageSavingsPercent` | Primary GO metric |
| `jpegli.jpegTotal` / `jpegExcluded` / `jpegExclusionRatio` | Counts and share of JPEG images without an iso-quality match in completed scoped measurements; > 20% yields NO-GO |
| `softFlags` | Investigation hints (encode CPU > 2×, Axis B failures, recompress-grow) — do not alone flip GO |

**CI ≠ GO:** CI runs fixture/invariant tests only. A green CI run without `HWPX_BENCH_DIR` and external metric tools does not approve jpegli investment.

**Capacity-GO ≠ integration approval:** Even a GO on real corpus does not approve Windows packaging, wasm vs native cost, or product integration — those are separate follow-ons.

Axis B (`computeVisualMetrics` on original BinData) is secondary and recorded for diagnostics; it does not flip the primary GO boolean.

### Failure and statistics policy

All JPEG savings/exclusions, PNG control bytes, CPU/wall-clock medians, growth counts and Axis B soft flags use **the same source scope**: real documents when present, otherwise fixtures for an invalid smoke run. Fixture rows remain in the report as diagnostics, with `fixture-diagnostic` as their median exclusion reason. Their successes or ordinary processing errors cannot change a real-corpus verdict.

A read/ZIP/decode/encode/metric/repack exception records the document as `error`, with the failing stage, optional image path and error text. Its stats are null rather than invented zero samples. Other documents continue. **Any selected document error prevents GO**, even if the successful-document median exceeds 15%. The reported median is descriptive for the surviving measurements; failed/missing/skipped document counts remain visible. Missing outcomes also fail closed.

An iso-quality curve miss is a measured exclusion, recorded per image. A document with both matches and misses is `partial`; it retains a package comparison and counts every JPEG in the 20% exclusion limit. If a JPEG-bearing document has no matches at all, it is `no-data` (`no-valid-jpegs`) and prevents GO even when other large documents dilute the global exclusion ratio. A document with no JPEGs is explicitly `no-data` (`no-jpeg-images`); it has no savings/wall-clock sample, but its completed PNG control measurement remains in scope. If no document has a primary sample, the result is NO-GO. Document failures and threshold misses are **NO-GO**; corpus/tool invalidity is **INVALID** and takes precedence. Neither changes the exit-zero-when-written contract.

Reports contain local relative document/image names and diagnostic error text, which can include local paths. Keep `out/` local; do not upload private reports or corpus bytes. CI tests use generated inputs, controlled curves/encoder stand-ins and isolated copies of the command. They validate accounting and report publication, not real SSIMULACRA2/jpegli capacity. [Failure-tracking evidence](../../docs/BENCHMARK_FAILURES_2026-10-15.md).

## Hangul WebP/AVIF compatibility spike

Generate spike artifacts (requires a real HWPX template shell — default: repo-root `sample2.hwpx`):

```bash
npm run bench:spike
```

Uses `sample2.hwpx` (or `HWPX_SPIKE_TEMPLATE`) as the OCF/HWPML shell — same `version.xml`, `header.xml`, `META-INF/*`, `Preview/*` as a document Hangul already accepts — and swaps only `BinData` images plus manifest/section references. Minimal hand-built ZIPs are rejected by Hangul as corrupted.

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
npm run bench -- rd --profile balanced
```

Expect the RD smoke run to write `out/rd-report.json` with `go: false` and `invalidReason: synthetic-only` (and often `metric-tool-missing` or `jpegli-unavailable` when CLIs are absent).

`npm run typecheck` also checks the benchmark source/tests with `scripts/bench/tsconfig.json`; no benchmark JS is emitted or added to release artifacts. Run the separate spike only with an authorized local template as described above.

## npm scripts

| Script | Command |
| --- | --- |
| `npm run bench -- rd --profile balanced` | RD report + GO verdict |
| `npm run bench:manifest` | Update `corpus.manifest.json` from `HWPX_BENCH_DIR` |
| `npm run bench:spike` | Emit Hangul compatibility spike artifacts |

## Related follow-ups (not Phase A)

- Verifier 256×256 PSNR gate may be supplemented in a future product change; Phase A Axis A uses full-res resized raw + SSIMULACRA2 only.
- decode-once instrumentation and perceptual-Q tuning are out of scope for this harness.
