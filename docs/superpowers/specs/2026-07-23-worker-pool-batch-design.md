# Worker-Pool Batch — Design

- Date: 2026-07-23
- Status: Revised x2 after Codex review (gpt-5.6-sol) + self-review — ready to plan
- Scope: CLI `batch` subcommand only. Desktop (single interactive document + its existing single worker) is unchanged. Core stays pure (no fs/terminal I/O).

## 1. Problem & Goal

`hwpx-opt batch <dir>` optimizes every `.hwpx` in a folder. Today it runs on a
single Node event loop: `runBatch` calls `mapLimit([...files], jobs, ...)`
([packages/cli/src/index.ts](../../../packages/cli/src/index.ts) ~line 450) with
`jobs` capped at `min(jobs, 4)`. Inside each file, `sharp` offloads to libvips
native threads, but the rest of the per-document work — `pako` DEFLATE (JSZip),
PSNR/SSIM math ([imagePreview.ts](../../../packages/core/src/imagePreview.ts)),
and XML parse/minify (fast-xml-parser) — is pure JavaScript on the one main
thread. So across "parallel" files that CPU-bound JS work serializes and cores
sit idle.

**Goal:** true multi-core throughput for batch by processing each document in its
own worker thread, with output that is *semantically identical* to sequential
processing (see §8 — byte-identical is neither achievable nor the goal).

## 2. Non-Goals

- No change to desktop, to single-file `optimize`, or to the core optimization
  algorithm/quality.
- No change to what a document optimization produces (its entry content) — only
  *where* it runs.
- Not switching to a process pool (see Approach C, rejected below).
- Making ZIP output byte-reproducible (deterministic timestamps) is an optional
  follow-up, not part of this spec.
- No crash-recovery journal. Hard-crash orphans are swept on the next run
  (§7), not transactionally recovered (YAGNI for a local batch tool).

## 3. Chosen Approach (B): full-file workers, main pre-allocates + commits

Considered:
- **A — optimize-only workers:** main reads/writes, worker optimizes; large input
  and output buffers cross the thread boundary. Rejected: extra buffer transfer
  for no benefit.
- **B — full-file workers (chosen):** worker reads → optimizes → writes *temp*
  artifacts; main pre-allocates final paths, enforces safety, and commits
  (renames temp → final) on success. No large buffers cross the boundary; I/O
  parallelizes too.
- **C — child_process pool:** full isolation but reloads `sharp` per process,
  heavier startup and IPC. Rejected for same-machine batch.

## 4. Architecture

```
Main (packages/cli/src/index.ts :: runBatch)
  1. Enumerate *.hwpx (sorted). If none: write empty batch-report, no pool, return.
  2. Startup sweep: delete stale *.tmp / 0-byte *.claim placeholders left in the
     output dir by a prior hard crash (best-effort recovery, see §7).
  3. Read original sizes; allocate per-file targets (unchanged).
  4. Sequentially CLAIM each file's final output + report path (default mode):
       - open final path with 'wx' (exclusive-create) → a 0-byte placeholder;
         on EEXIST try the next nextAvailablePath suffix. Sequential + on-disk
         placeholder closes the check-then-act race and de-dups within the batch.
       - assertDoesNotTargetAnyInput(output/report, inputPaths)  [safety, in main]
       - Record every claimed path in a `claims` registry for later release.
       - A claim failure → that file's `resolve-output-path` failure; file SKIPPED,
         batch continues.
       - With `--overwrite`: skip the 'wx' claim, target the requested final path
         directly (still assertDoesNotTargetAnyInput). See §7 for its weaker
         guarantee.
  5. claimedCount = files that claimed successfully. If 0: write batch-report of
     failures, no pool, return. Else jobsEffective = max(1, min(jobsRequested,
     claimedCount)); create WorkerPool.
  6. Submit one job per claimed file.
  7. On a worker "optimized" message: main COMMITS — rename tempOutput →
     finalOutput, then tempReport → finalReport (output first; if report rename
     fails, roll back the output rename and release the claim). Reconstruct the
     batch result's input/output/report fields from job metadata.
  8. On "failed"/crash: delete that job's temp files AND release its claim(s)
     (remove the 0-byte placeholder); batch continues.
  9. Assemble batch-report to a temp file, then atomic-rename to batch-report.json.
```

`optimizeByMode`, `nextAvailablePath` (extended to exclusive-create),
`readSupportedInput`, `writeOptimizationArtifacts` (now writing temp paths), and
the batch-report aggregation are reused; their call sites move but their content
logic is unchanged.

## 5. Concurrency Policy

- **Default (conservative):** `jobsRequested = max(1, min(availableParallelism() - 1, 4))`.
  This *reduces* memory pressure but is not a hard safety guarantee: the reader
  permits up to 512 MiB compressed / 2 GiB expanded per document
  ([reader.ts](../../../packages/core/src/reader.ts) DEFAULT_READ_LIMITS), so even
  4 workers on very large files can exhaust a low-RAM office PC. Documented as a
  caveat; a memory-based cap is a possible follow-up.
- **Max throughput (opt-in):** `--jobs max` → `jobsRequested = availableParallelism()`.
- **Manual:** `--jobs N` (positive integer). The current hard `min(jobs, 4)` cap
  is removed.
- **Effective pool:** `jobsEffective = max(1, min(jobsRequested, claimedCount))`;
  no pool is created when `claimedCount === 0`. batch-report records both
  `jobsRequested` and `jobsEffective`.
- **Oversubscription guard (per worker):**
  - `sharp.concurrency(1)` — process-global, but every worker sets the same value
    before its ready handshake, so it is consistent.
  - Per-document image concurrency is forced to 1 via an **explicit
    `imageConcurrency` option**, read at call time (NOT an env var, NOT an
    import-time global). This single validated value must be threaded through
    **every** image-related `mapLimit` fan-out invoked during a document
    optimization, not just the apply/verify surfaces. The authoritative list of
    image `mapLimit` sites (verified by grep — every `defaultImageConcurrency()`
    call in core) is exactly:
    `analyzeHwpxPackage` ([analyzer.ts:65](../../../packages/core/src/analyzer.ts)),
    duplicate detection — **two** sites
    ([imageDuplicates.ts:55](../../../packages/core/src/imageDuplicates.ts) and
    [imageDuplicates.ts:103](../../../packages/core/src/imageDuplicates.ts)),
    `applySafeOptimizationPlan` ([optimizer.ts:34](../../../packages/core/src/optimizer.ts)),
    `applyBalancedOptimizationPlan` ([balancedOptimizer.ts:57](../../../packages/core/src/balancedOptimizer.ts)),
    and `verifyHwpxOutput` ([verifier.ts:144](../../../packages/core/src/verifier.ts)).
    (`opportunities.ts` is NOT a site — its `sharp` calls run *inside*
    balancedOptimizer's `mapLimit`, so they are already bounded by it.)
    Each site defaults to `defaultImageConcurrency()`
    ([concurrency.ts](../../../packages/core/src/concurrency.ts)) when the option
    is omitted, preserving current behavior for non-batch callers.
  - **Honest claim:** total image throughput is NOT simply `pool size`. sharp also
    uses the process-wide libuv threadpool (default 4 concurrent operations), so
    `--jobs max` beyond ~4 does not linearly increase sharp throughput. Actual
    speedup must be **benchmarked**; `UV_THREADPOOL_SIZE` tuning is an optional
    lever, not assumed.

## 6. Job & Result Messages

```
Job (main → worker):
  { index, sourcePath, tempOutputPath, tempReportPath, mode, options,
    targetBytes?, imageConcurrency: 1 }

Result (worker → main):
  { index, status: "optimized", originalSize, optimizedSize, savedBytes, savedPercent }
  | { index, status: "failed", stage: BatchFailureStage, error: string }
```

`options` is the parsed plain `Record<string, string>` batch options
(structured-cloneable). The batch result's `input` / `output` / `report` fields
(present in today's `BatchFileResult`) are reconstructed in main from job
metadata (source filename + claimed final paths), so the batch-report schema is
unchanged.

## 7. Safety, Errors, Cancellation

- **Original never touched; no overwrite (default):** final paths are claimed in
  main by atomic exclusive-create before dispatch, plus `assertDoesNotTargetAnyInput`.
  Workers only ever write to their assigned *temp* paths.
- **`--overwrite`:** skips the exclusive-create claim and targets the requested
  final path directly (still refusing to target any input). Because the prior
  file is replaced in place, the two-rename commit is best-effort only for
  `--overwrite`: a failure between the output and report rename may leave the new
  output with a stale/missing report. This weaker guarantee is documented; the
  default (claimed, suffixed) path keeps the strong guarantee.
- **Claim registry + release:** every claimed placeholder is tracked and released
  (placeholder deleted) on second-claim retry, worker failure/crash, cancellation,
  and commit rollback — so failed jobs never leave 0-byte final files behind.
- **Transactional commit (handled failures):** worker writes temp artifacts; main
  renames temp → final only after "optimized". Output renamed before report; if
  the report rename fails, the output rename is rolled back and the claim
  released. Result: for handled failures, no partial *final* artifacts and never a
  promoted report without its output.
- **Crash atomicity (scoped honestly):** the strong guarantee covers handled
  errors and SIGINT/SIGTERM. A *hard* main-process crash (SIGKILL / power loss)
  between the two renames may leave a single final artifact and/or orphaned
  temp/placeholder files. These are not journaled; they are cleaned by the
  **startup sweep** (§4 step 2) on the next batch run over the same output dir, or
  manually. No recovery journal (YAGNI).
- **Per-file failure isolation:** a thrown error → `failed` result with the
  existing stage values (`read-input` | `optimize` | `resolve-output-path` |
  `write-output`); other files continue. A path-claim failure in main is likewise
  a per-file `resolve-output-path` failure, not a batch abort.
- **Worker crash:** pool fails the in-flight job, deletes its temp files, releases
  its claim, respawns a replacement, continues draining.
- **Cancellation (SIGINT/SIGTERM):** stop dispatch, signal in-flight workers to
  abort, await termination, delete temp files AND release claims of
  in-flight/queued jobs, do NOT write a normal completion report, and exit with
  the conventional signal code (130 SIGINT / 143 SIGTERM).
- **batch-report.json** is written to a temp file then atomically renamed.

## 8. Output Parity (redefined: semantic, not byte)

Byte-identical output is **not achievable and never was**, even in today's
sequential tool: JSZip stamps each ZIP entry with the *current time*
([writer.ts](../../../packages/core/src/writer.ts) sets no entry dates), and
per-file reports embed measured `performance` durations
([performance.ts](../../../packages/core/src/performance.ts)).

Parity is therefore defined **semantically**: for each input + mode, the batch
result must have (1) the same ZIP **entry set** with **byte-identical entry
data**, and (2) the same report fields **excluding** volatile ones (`performance`
timings; ZIP container timestamps ignored).

**Warning-order determinism (required change):** the balanced/aggressive path
currently appends warnings in *task-completion* order inside a `mapLimit`
([balancedOptimizer.ts](../../../packages/core/src/balancedOptimizer.ts) ~line 57),
so forcing `imageConcurrency = 1` would change warning order versus the default.
To keep reports deterministic, `applyBalancedOptimizationPlan` must return
**indexed** transform outcomes and append warnings in the **entry-order assembly
loop** (as the safe path already does), independent of completion order. Tests
add a fixture with multiple transform failures and assert stable warning order.

Tests compare **normalized reports** (strip `performance`) and **unzipped entry
data**, never raw buffers.

## 9. Dev/Prod Worker Resolution

Desktop always runs built `.js`. CLI differs: `npm run cli` runs sources via
`tsx`. `execArgv` inheritance alone is too fragile, so registration is made
**explicit** and one route is chosen:

- The `cli` npm script becomes `node --import tsx --conditions=development
  packages/cli/src/index.ts` (was `tsx …`). With `--import tsx` in
  `process.execArgv`, the worker is spawned as
  `new Worker(workerPath, { execArgv: process.execArgv })` and tsx registers in
  the worker too.
- Worker path is derived from `import.meta.url` using the current module's
  extension (`.ts` under tsx, `.js` when built); built runs spawn plain
  `<worker>.js` with no extra execArgv.
- **Validation:** real child-process runs of BOTH `npm run cli -- batch …` and the
  built CLI — not only Vitest.

## 10. Testing (TDD)

- **workerPool unit tests** (trivial jobs, no HWPX):
  - runs all N jobs; never exceeds `jobsEffective` concurrent
  - one failing job does not abort the others
  - a worker that exits mid-job → that job fails, temp + claim cleaned, pool
    respawns and drains the queue
  - `terminate()` stops pending dispatch
- **batch integration test:** temp dir with a few small `.hwpx` fixtures →
  `runBatch` → for each file, the batch output's **unzipped entry data equals the
  sequential `optimizeByMode` output**, **normalized** per-file reports match
  (performance stripped), `batch-report` totals correct, `jobsRequested` vs
  `jobsEffective` recorded.
- **claim/rollback tests:** claim failure → per-file failure, batch continues, no
  0-byte file left; worker failure → temp + claim released; failed report rename →
  output rolled back + claim released.
- **startup sweep test:** pre-seed stale `*.tmp`/`*.claim` → run → they are gone.
- **cancellation test:** SIGINT mid-batch → dispatch stops, no completion report,
  temp + claims cleaned, exit code 130.
- **warning-order test:** fixture with ≥2 transform failures → identical warning
  order at `imageConcurrency` 1 and default.
- **concurrency-option tests:** `imageConcurrency: 1` forces concurrency 1 in the
  analyzer, duplicate detection, opportunities, apply, and verifier paths; omitting
  it uses `defaultImageConcurrency()`.
- **child-process worker validation** (dev + built) per §9.

## 11. Files

- New: `packages/cli/src/workerPool.ts`, `packages/cli/src/optimizeWorker.ts`
- Changed: `packages/cli/src/index.ts` — `runBatch` (startup sweep; atomic
  exclusive-create claim + claim registry/release; `--overwrite` direct-target;
  temp-then-commit + rollback; pool dispatch; SIGINT/SIGTERM; `--jobs max`; remove
  `min(jobs,4)`; `jobsEffective = min(jobsRequested, claimedCount)` + empty/all-fail
  short-circuit; record jobsRequested/jobsEffective), `parseBatchJobs`,
  `nextAvailablePath` (exclusive-create claim), `writeOptimizationArtifacts`
  (temp-path aware)
- Changed: root [package.json](../../../package.json) `cli` script →
  `node --import tsx --conditions=development packages/cli/src/index.ts`
- Changed (core, **explicit `imageConcurrency?: number` option — no env var**),
  threaded through the 5 files / 6 image `mapLimit` sites (authoritative grep list):
  `analyzeHwpxPackage` ([analyzer.ts:65](../../../packages/core/src/analyzer.ts)),
  duplicate detection — both sites
  ([imageDuplicates.ts:55](../../../packages/core/src/imageDuplicates.ts),
  [imageDuplicates.ts:103](../../../packages/core/src/imageDuplicates.ts)),
  `applySafeOptimizationPlan` ([optimizer.ts:34](../../../packages/core/src/optimizer.ts)),
  `applyBalancedOptimizationPlan` ([balancedOptimizer.ts:57](../../../packages/core/src/balancedOptimizer.ts) —
  also change to indexed outcomes carrying the skip `reason`, and append warnings
  in the entry-order `for (const outcome of outcomes)` loop, §8),
  `verifyHwpxOutput` ([verifier.ts:144](../../../packages/core/src/verifier.ts)); each
  defaults to `defaultImageConcurrency()`
  ([concurrency.ts](../../../packages/core/src/concurrency.ts)) when omitted.
  (`opportunities.ts` is intentionally excluded — no independent fan-out.)
- Tests: `packages/cli/test/workerPool.test.ts`, extend
  `packages/cli/test/cli.test.ts`; core concurrency-option + warning-order tests.

## 12. Risks

- **tsx-under-worker registration** (§9) — main implementation risk; mitigated by
  explicit `--import tsx` in the `cli` script + real child-process validation.
- **Final-path race** between claim and rename — closed by atomic exclusive-create;
  claim registry guarantees release on every failure path.
- **Hard-crash orphans** — accepted and swept next run (§7); not journaled.
- **`--overwrite` weaker guarantee** — documented (§7); default path stays strong.
- **Memory** on low-RAM PCs with very large HWPX × pool size — conservative
  default + documented caveat; memory-based cap is a follow-up.
- **Throughput above ~4** bounded by the libuv threadpool — benchmark; optional
  `UV_THREADPOOL_SIZE` tuning.
- **Concurrency-propagation misses** — every image `mapLimit` listed in §11 must
  take the option; a missed site silently reintroduces oversubscription (covered
  by the §10 concurrency-option tests).
