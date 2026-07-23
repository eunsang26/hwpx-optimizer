# Worker-Pool Batch — Design

- Date: 2026-07-23
- Status: Approved (pending spec review)
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
own worker thread, with output byte-for-byte identical to sequential processing.

## 2. Non-Goals

- No change to desktop, to single-file `optimize`, or to the core optimization
  algorithm/quality.
- No change to what a document optimization produces — only *where* it runs.
- Not switching to a process pool (see Approach C, rejected below).

## 3. Chosen Approach (B): full-file workers, paths pre-allocated in main

Considered:
- **A — optimize-only workers:** main reads/writes, worker optimizes; large input
  and output buffers cross the thread boundary. Rejected: extra buffer transfer
  and lifetime management for no benefit.
- **B — full-file workers (chosen):** worker does read → optimize → write; main
  pre-computes each file's output/report paths and enforces safety. No large
  buffers cross the boundary; I/O parallelizes too.
- **C — child_process pool:** full isolation but reloads `sharp` per process,
  heavier startup and IPC. Rejected for same-machine batch.

## 4. Architecture

```
Main (packages/cli/src/index.ts :: runBatch)
  1. Enumerate *.hwpx (sorted, unchanged)
  2. Read original sizes; allocate per-file targets (unchanged)
  3. For each file, PRE-ALLOCATE output + report paths:
       - nextAvailablePath (no-overwrite) against disk AND a reservedPaths Set
         so two jobs never claim the same name
       - assertDoesNotTargetAnyInput(output/report, inputPaths)  [safety kept in main]
  4. Create WorkerPool(size) and submit one job per file
  5. Collect result summaries (by index) + print per-file progress lines
  6. Assemble batch-report.json from summaries (aggregation logic unchanged)

WorkerPool (packages/cli/src/workerPool.ts, new)
  - Spawns `size` long-lived workers
  - Dispatches queued jobs as workers free up
  - Relays each job's progress/result/error back to main
  - Respawns a worker that exits unexpectedly and fails only its in-flight job
  - terminate(): kills all workers (cancellation / process exit)

Worker (packages/cli/src/optimizeWorker.ts, new)
  - On startup: sharp.concurrency(1); request per-document image concurrency = 1
  - Per job {sourcePath, outputPath, reportPath, mode, options, targetBytes}:
      read → optimizeByMode → writeOptimizationArtifacts(output, report)
      postMessage summary {index, status: "optimized", originalSize,
        optimizedSize, savedBytes, savedPercent} OR
        {index, status: "failed", stage, error}
```

`optimizeByMode`, `writeOptimizationArtifacts`, `nextAvailablePath`,
`readSupportedInput`, and the batch-report assembly are reused as-is; they move
call sites (into the worker / stay in main) but their logic does not change.

## 5. Concurrency Policy

- **Default (conservative, memory-safe):** `size = max(1, min(availableParallelism() - 1, 4))`.
  Each worker holds one document's buffers in memory, so the cap protects
  low-RAM office PCs.
- **Max throughput (opt-in):** `--jobs max` → `size = availableParallelism()`.
- **Manual:** `--jobs N` → `size = N` (positive integer). The current hard
  `min(jobs, 4)` cap is removed; the user is trusted when they pass an explicit
  number or `max`.
- **Oversubscription guard:** parallelism comes from the *pool* (across
  documents), not from inside each document. In workers, `sharp.concurrency(1)`
  and per-document image concurrency is forced to 1 so total concurrent image
  work ≈ pool size rather than `size × defaultImageConcurrency`.
  - Mechanism: a per-run override honored by
    [concurrency.ts](../../../packages/core/src/concurrency.ts) `defaultImageConcurrency()`,
    set via the `HWPX_OPT_IMAGE_CONCURRENCY` environment variable (a tuning knob,
    not I/O; core stays free of fs/terminal work). The worker sets it to `1`
    before importing/using core. When unset, current behavior is unchanged.

## 6. Job & Result Messages

```
Job (main → worker):
  { index, sourcePath, outputPath, reportPath, mode, options, targetBytes? }

Result (worker → main):
  { index, status: "optimized", originalSize, optimizedSize, savedBytes, savedPercent }
  | { index, status: "failed", stage: BatchFailureStage, error: string }
  | { index, kind: "progress", ... }   // optional, mirrors today's per-file line
```

`options` is the already-parsed plain `Record<string, string>` batch options
(mode/actions/allow-larger/max-input-bytes …) — structured-cloneable, small.

## 7. Safety, Errors, Cancellation

- **Original never touched; no overwrite:** enforced in main before dispatch
  (path pre-allocation + `assertDoesNotTargetAnyInput`), exactly as today. Workers
  only ever write to the main-assigned `outputPath`/`reportPath`.
- **Per-file failure isolation:** a thrown error becomes a `failed` result with
  the same `stage` values used today (`read-input` | `optimize` |
  `resolve-output-path` | `write-output`). Other files continue.
- **Worker crash:** on unexpected `error`/`exit`, the pool marks the in-flight
  job failed (`stage` = current stage) and respawns a replacement worker so
  throughput is preserved.
- **Cancellation:** a SIGINT handler in main calls `pool.terminate()` and stops
  dispatch; already-written outputs remain (each is a complete, verified file).

## 8. Output Parity (hard requirement)

Optimized files, per-file `*.report.json`, and `batch-report.json` must be byte/
content identical to sequential output. Determinism holds because: file order is
sorted; results are placed by `index`; target allocation is unchanged; and each
document's optimization is independent of the others. Only `batch-report.totals`
timing (`elapsedMs`) and the recorded `jobs` value differ (jobs now = pool size).

## 9. Dev/Prod Worker Resolution (known wrinkle)

Desktop always runs built `.js` (`new Worker(join(import.meta.dirname, "main",
"documentWorker.js"))`). CLI differs: `npm run cli` runs sources via `tsx`, so a
`.js` worker file does not exist in dev.

Resolution: derive the worker path from `import.meta.url` using the *same
extension as the current module* (`.ts` under tsx, `.js` when built), and spawn
with `new Worker(workerPath, { execArgv: process.execArgv })` so the tsx loader
propagates to the worker in dev. Verified against both `npm run cli -- batch …`
and the built CLI during implementation. If `execArgv` propagation proves
unreliable, fall back to a `.mjs` worker shim that registers the tsx loader.

## 10. Testing (TDD)

- **workerPool unit tests** (no HWPX needed; use trivial jobs):
  - runs all N jobs and returns results in submission order
  - never exceeds `size` concurrent jobs
  - one failing job does not abort the others
  - a worker that exits mid-job → that job fails, pool respawns and drains queue
- **batch integration test:** temp dir with a few small `.hwpx` fixtures →
  `runBatch` → assert every output + report written, `batch-report.json` totals
  correct, and **each optimized output equals the sequential
  `optimizeByMode` result** for the same input/mode.
- **concurrency override test:** `HWPX_OPT_IMAGE_CONCURRENCY=1` makes
  `defaultImageConcurrency()` return 1; unset leaves current behavior.
- Reuse Node 20 runner note from repo memory; keep existing pre-existing CLI
  failure out of scope.

## 11. Files

- New: `packages/cli/src/workerPool.ts`, `packages/cli/src/optimizeWorker.ts`
- Changed: `packages/cli/src/index.ts` (`runBatch` dispatch + path pre-allocation
  + `--jobs max` parsing; remove `min(jobs,4)` cap), `parseBatchJobs`
- Changed (small): `packages/core/src/concurrency.ts` (`defaultImageConcurrency`
  honors `HWPX_OPT_IMAGE_CONCURRENCY`)
- Tests: `packages/cli/test/workerPool.test.ts`, extend
  `packages/cli/test/cli.test.ts`; `packages/core/test/concurrency.test.ts`

## 12. Risks

- tsx-under-worker resolution (§9) is the main implementation risk; mitigated by
  the `.mjs` shim fallback.
- Memory on low-RAM PCs with very large HWPX × pool size; mitigated by the
  conservative default cap (§5).
- Oversubscription if the concurrency override is missed; mitigated by test in §10.
