# Analysis-to-optimize image reuse gate — v0.1.9

Date: 2026-07-27 KST  
Baseline: `v0.1.9` / `76c8714b9b81ab81c927561d606490d662e8fa8c`  
Decision: **NO-GO — measurement only; do not add the session LRU cache**

## Acceptance-gate result

| Gate | Result | Evidence |
| --- | --- | --- |
| Image conversion is at least 30% of analysis time | PASS | Isolated exact-image stages were 39.85% and 63.67% of median analysis wall time. |
| Reuse only for an identical file/mode/target/JPEG quality/action set | NOT IMPLEMENTED | The speed gate failed before cache design or integration. |
| Invalidate on file or setting changes | NOT IMPLEMENTED | The speed gate failed before cache design or integration. |
| Session-only bounded LRU | NOT IMPLEMENTED | The speed gate failed before cache design or integration. |
| Do not reuse cancelled or failed transforms | NOT IMPLEMENTED | The speed gate failed before cache design or integration. |
| Preserve output, verification, and projection parity | UNCHANGED | No production code path was changed. A future prototype must compare unzipped entry bytes and normalized reports, not raw ZIP hashes. |
| At least 20% faster optimize-after-analysis | **FAIL** | Even deleting the complete reusable `apply` stage gives an upper bound of only 8.85% and 6.97% on the representative documents. |
| Memory/complexity is justified by the gain | **FAIL** | The default flow exposes only one reusable quality candidate, while adding cross-call ownership, invalidation, cancellation, and bounded-buffer accounting. |

Because the 20% adoption threshold fails, this task intentionally stops before
adding cache code.

## Workload

- Representative A: 94,078,344 bytes (89.72 MiB).
- Representative B: 23,052,827 bytes (21.98 MiB).
- Flow: deep analysis, then balanced optimization with a 40 MiB target,
  automatic JPEG quality, and the default action set.
- Both documents selected JPEG quality 95 after testing four candidate profiles:
  baseline quality 88 followed by the upward target search.
- WSL measurements: three isolated processes per document; medians are reported.
- Windows confirmation: the released `v0.1.9` portable CLI ZIP, one run per
  document.

The WSL host used Node 20.20.2, sharp 0.35.3/libvips 8.18.3, an Intel Core Ultra
5 228V exposed as 8 CPUs, and 15 GiB RAM.

## Stage definition

`analyzeHwpxBuffer` measures exact balanced and aggressive opportunity passes.
Those broad stages also include duplicate-image discovery. To avoid calling all
of that time “encoding,” the profiling pass repeated both exact opportunity
passes with byte-duplicate discovery and measured only the metadata/transform
loop. This is the `exact image transform` value below.

The optimize path used its existing `performance.stages`. Automatic target
search produced four `apply` stages. Analysis has reusable encoded buffers only
for the first balanced-quality-88 candidate. Therefore:

`maximum possible reuse speedup = first apply duration / optimize wall time`

This is deliberately generous: it assumes a cache hit makes the entire first
`apply` stage free, including its non-image work and cache lookup overhead.

## WSL three-run medians

| Metric | Representative A | Representative B |
| --- | ---: | ---: |
| Analysis wall time | 16,422.8 ms | 7,688.9 ms |
| Exact image transform time | 6,543.7 ms | 4,895.2 ms |
| Exact image share of analysis | **39.85%** | **63.67%** |
| Optimize wall time | 19,709.6 ms | 21,713.1 ms |
| All candidate `apply` share | 31.41% | 30.55% |
| Reusable first `apply` time | 1,913.3 ms | 1,434.9 ms |
| Generous maximum speedup | **8.85%** | **6.97%** |
| Final JPEG quality | 95 | 95 |
| Output bytes | 7,178,256 | 7,068,858 |

Observed median end-of-sequence memory deltas were 1,108.8 MiB RSS / 713.9 MiB
external for A and 371.3 MiB RSS / 176.7 MiB external for B. These are not cache
payload estimates or peak measurements; they show that sharp/libvips already
retains material process memory, so a buffer cache needs a strong measured gain
before adding more retained memory.

### Raw WSL runs

| Document | Run | Analysis ms | Broad exact-opportunity ms | Isolated exact-image ms | Optimize ms | First apply ms | First-apply upper bound |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A | 1 | 16,422.8 | 10,100.9 | 8,016.8 | 28,318.9 | 2,381.6 | 8.41% |
| A | 2 | 19,783.8 | 9,290.0 | 6,543.7 | 19,318.3 | 1,709.6 | 8.85% |
| A | 3 | 11,295.2 | 6,796.0 | 6,045.3 | 19,709.6 | 1,913.3 | 9.71% |
| B | 1 | 7,688.9 | 5,976.9 | 5,327.5 | 24,476.1 | 1,705.1 | 6.97% |
| B | 2 | 5,782.2 | 4,541.0 | 4,895.2 | 14,160.6 | 1,240.0 | 8.76% |
| B | 3 | 8,219.7 | 6,560.6 | 4,877.4 | 21,713.1 | 1,434.9 | 6.61% |

The isolated exact-image runs are separate processes from the end-to-end runs,
so the table uses their corresponding run number only for compact reporting.
The adoption decision uses medians, not per-row subtraction.

## Released Windows v0.1.9 confirmation

| Metric | Representative A | Representative B |
| --- | ---: | ---: |
| Analysis total | 10,236.3 ms | 6,194.1 ms |
| Broad exact-opportunity stages | 6,747.5 ms (65.92%) | 4,962.4 ms (80.12%) |
| Optimize total | 20,577.3 ms | 14,748.8 ms |
| All candidate `apply` share | 33.54% | 32.33% |
| Reusable first `apply` | 1,691.2 ms | 956.0 ms |
| Generous maximum speedup | **8.22%** | **6.48%** |
| Final JPEG quality | 95 | 95 |

Windows confirms the same shape as the isolated WSL measurements: encoding is a
real analysis cost, but the exact analysis result covers only one of four
optimization candidates in the default automatic-quality workflow.

## Why the cache is not adopted

The optimization bottleneck is the combination of all four image candidate
passes plus four write/verify passes. A cache of analysis encodes can safely
remove only the first matching quality-88 image pass. It cannot remove the
quality-92/94/95 transforms, package writes, or verification passes.

Adding a cache would still require:

- a stable document fingerprint plus mode, target, JPEG-quality, and normalized
  selected-action key;
- ownership transfer or buffer copying between analyze and optimize calls;
- immediate invalidation for file/stat or setting changes;
- cancellation/failure admission rules;
- entry-count and byte-count LRU eviction;
- worker lifetime and memory-pressure handling.

That complexity cannot turn a measured 6.48–9.71% theoretical ceiling into the
required 20% improvement.

## Re-open conditions

Reconsider this P1 only if one of these changes makes the same encoded candidate
cover at least 20% of optimize-after-analysis wall time:

1. analysis computes the final selected JPEG quality rather than only the
   balanced anchor and aggressive projection;
2. optimize reduces target search to one or two verified candidates;
3. write/verify work becomes reusable without weakening verification;
4. a representative default workload selects quality 88 directly and a
   prototype demonstrates at least 20% median improvement under the full cache
   correctness and memory limits.
