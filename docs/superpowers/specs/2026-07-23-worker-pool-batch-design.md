# Worker-Pool Batch — Design

- Date: 2026-07-23
- Status: Revised after Codex review (gpt-5.6-sol) — pending final spec review
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
  2. Read original sizes; allocate per-file targets (unchanged).
  3. Sequentially CLAIM each file's final output + report path:
       - nextAvailablePath variant that ATOMICALLY reserves via exclusive-create
         (open with 'wx' → a 0-byte placeholder); on EEXIST, try the next suffix.
         Sequential + on-disk placeholder closes the check-then-act race and also
         de-dups within the batch (no reservedPaths Set needed).
       - assertDoesNotTargetAnyInput(output/report, inputPaths)  [safety, in main]
       - A claim failure is recorded as that file's `resolve-output-path` failure
         and the file is SKIPPED. It never aborts the batch.
  4. effectiveJobs = max(1, min(requestedJobs, files.length)); create WorkerPool.
  5. Submit one job per successfully-claimed file.
  6. On a worker "optimized" message: main COMMITS — fsync+rename tempOutput →
     finalOutput, then tempReport → finalReport (output first; if report rename
     fails, roll back the output rename). Reconstruct the batch result's
     input/output/report fields from job metadata.
  7. On "failed"/crash: main deletes that job's temp files; batch continues.
  8. Assemble batch-report to a temp file, then atomic-rename to batch-report.json.

WorkerPool (packages/cli/src/workerPool.ts, new)
  - Spawns effectiveJobs long-lived workers; dispatches queued jobs as they free.
  - Relays each job's result/error to main.
  - On unexpected worker exit/error: fails only its in-flight job, cleans temp,
    respawns a replacement, keeps draining the queue.
  - terminate(): stops dispatch and kills all workers (cancellation / exit).

Worker (packages/cli/src/optimizeWorker.ts, new)
  - Startup: sharp.concurrency(1) BEFORE signalling ready.
  - Per job {index, sourcePath, tempOutputPath, tempReportPath, mode, options,
      targetBytes?, imageConcurrency:1}:
      read → optimizeByMode(..., { imageConcurrency }) → write tempOutput +
      tempReport → post {index, status:"optimized", originalSize, optimizedSize,
      savedBytes, savedPercent} | {index, status:"failed", stage, error}.
```

`optimizeByMode`, `nextAvailablePath` (extended to exclusive-create),
`readSupportedInput`, `writeOptimizationArtifacts` (now writing temp paths), and
the batch-report aggregation are reused; their call sites move but their content
logic is unchanged.

## 5. Concurrency Policy

- **Default (conservative):** `effectiveJobs = max(1, min(availableParallelism() - 1, 4))`.
  This *reduces* memory pressure but is not a hard safety guarantee: the reader
  permits up to 512 MiB compressed / 2 GiB expanded per document
  ([reader.ts](../../../packages/core/src/reader.ts) DEFAULT_READ_LIMITS), so even
  4 workers on very large files can exhaust a low-RAM office PC. Documented as a
  caveat; a memory-based cap is a possible follow-up.
- **Max throughput (opt-in):** `--jobs max` → `requestedJobs = availableParallelism()`.
- **Manual:** `--jobs N` (positive integer). The current hard `min(jobs, 4)` cap
  is removed; effective pool is always `min(requestedJobs, files.length)`.
- **Report both:** batch-report records `jobsRequested` and `jobsEffective`.
- **Oversubscription guard (per worker):**
  - `sharp.concurrency(1)` — process-global, but every worker sets the same value
    before its ready handshake, so it is consistent.
  - Per-document image concurrency is forced to 1 via an **explicit
    `imageConcurrency` option** threaded through the optimize call (see §6/§11),
    read at call time — NOT via an environment variable and NOT via import-time
    globals.
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

- **Original never touched; no overwrite:** final paths are claimed in main by
  atomic exclusive-create before dispatch, plus `assertDoesNotTargetAnyInput`.
  Workers only ever write to their assigned *temp* paths.
- **Transactional commit:** worker writes temp artifacts; main renames temp →
  final only after the "optimized" message. Output is renamed before report; if
  the report rename fails, the output rename is rolled back. Result: no partial
  *final* artifacts, and never a promoted report without its output.
- **Per-file failure isolation:** a thrown error → `failed` result with the
  existing stage values (`read-input` | `optimize` | `resolve-output-path` |
  `write-output`); other files continue. A path-claim failure in main is likewise
  a per-file `resolve-output-path` failure, not a batch abort.
- **Worker crash:** pool fails the in-flight job, deletes its temp files, respawns
  a replacement, continues draining.
- **Cancellation (SIGINT/SIGTERM):** stop dispatch, signal in-flight workers to
  abort, await termination, delete temp files of in-flight/queued jobs, do NOT
  write a normal completion report (write nothing or a `cancelled` marker), and
  exit with the conventional signal code (130 for SIGINT, 143 for SIGTERM).
- **batch-report.json** is written to a temp file then atomically renamed, so it
  is never left partial.

## 8. Output Parity (redefined: semantic, not byte)

Byte-identical output is **not achievable and never was**, even in today's
sequential tool:
- JSZip stamps each ZIP entry with the *current time* — [writer.ts](../../../packages/core/src/writer.ts)
  does not set entry dates — so repackaging the same input twice yields different
  container bytes.
- Per-file reports embed measured `performance` durations
  ([performance.ts](../../../packages/core/src/performance.ts)).

Parity is therefore defined **semantically**: for each input + mode, the batch
result must have
1. the same ZIP **entry set** with **byte-identical entry data**, and
2. the same report fields **excluding** volatile ones (`performance` timings; ZIP
   container timestamps are ignored).

Determinism of content holds because each document's optimization is independent
and deterministic given the same input/mode/target, and warnings are emitted in
**entry order** (the safe/balanced assembly loops already push in entry order,
not completion order), so forcing `imageConcurrency = 1` cannot reorder them.
Tests compare **normalized reports** (strip `performance`) and **unzipped entry
data**, never raw buffers. (Optional follow-up: deterministic ZIP timestamps in
writer.ts for byte-reproducible output.)

## 9. Dev/Prod Worker Resolution (known wrinkle)

Desktop always runs built `.js`. CLI differs: `npm run cli` runs sources via
`tsx`, so a `.js` worker file does not exist in dev. `execArgv` is inherited by
workers by default, but relying on that to carry `tsx` registration is fragile
(it only works if the parent's argv actually contains tsx flags, an
implementation detail of the pinned tsx version).

Resolution — make registration **explicit**:
- Derive the worker path from `import.meta.url` using the current module's
  extension (`.ts` under tsx, `.js` when built).
- Dev: run the CLI as `node --import tsx --conditions=development
  packages/cli/src/index.ts` (the `cli` npm script) and spawn the worker with
  matching `execArgv`; OR use a `.mjs` shim that calls tsx `register()` FIRST and
  then `await import()`s the `.ts` worker (a static TS import runs too early).
- Built: plain `new Worker(<worker>.js)`.
- **Validation:** real child-process runs of BOTH `npm run cli -- batch …` and the
  built CLI — not only Vitest.

## 10. Testing (TDD)

- **workerPool unit tests** (trivial jobs, no HWPX):
  - runs all N jobs; never exceeds `effectiveJobs` concurrent
  - one failing job does not abort the others
  - a worker that exits mid-job → that job fails, temp cleaned, pool respawns and
    drains the queue
  - `terminate()` stops pending dispatch
- **batch integration test:** temp dir with a few small `.hwpx` fixtures →
  `runBatch` → for each file, the batch output's **unzipped entry data equals the
  sequential `optimizeByMode` output**, **normalized** per-file reports match
  (performance stripped), `batch-report` totals correct, `jobsRequested` vs
  `jobsEffective` recorded.
- **transaction test:** worker fails after temp write, before commit → no final
  artifacts exist and temp files are cleaned.
- **cancellation test:** SIGINT mid-batch → dispatch stops, no completion report
  written, temp cleaned, exit code 130.
- **concurrency-option test:** passing `imageConcurrency: 1` makes the optimize
  path use concurrency 1; omitting it uses `defaultImageConcurrency()`.
- **child-process worker validation** (dev + built) per §9.

## 11. Files

- New: `packages/cli/src/workerPool.ts`, `packages/cli/src/optimizeWorker.ts`
- Changed: `packages/cli/src/index.ts` — `runBatch` (atomic exclusive-create path
  claim; temp-then-commit; pool dispatch; SIGINT/SIGTERM handling; `--jobs max`;
  remove `min(jobs,4)`, use `effectiveJobs = min(requested, files.length)`;
  record jobsRequested/jobsEffective), `parseBatchJobs`, `nextAvailablePath`
  (exclusive-create claim), `writeOptimizationArtifacts` (temp-path aware)
- Changed (core, **explicit option — no env var**): thread an optional
  `imageConcurrency?: number` through the optimize/analyze entry points and into
  `applySafeOptimizationPlan` ([optimizer.ts](../../../packages/core/src/optimizer.ts)),
  `applyBalancedOptimizationPlan` ([balancedOptimizer.ts](../../../packages/core/src/balancedOptimizer.ts)),
  and [verifier.ts](../../../packages/core/src/verifier.ts); default to
  `defaultImageConcurrency()` ([concurrency.ts](../../../packages/core/src/concurrency.ts))
  when unset.
- Tests: `packages/cli/test/workerPool.test.ts`, extend
  `packages/cli/test/cli.test.ts`; core concurrency-option tests.

## 12. Risks

- **tsx-under-worker registration** (§9) — main implementation risk; mitigated by
  explicit `--import tsx` + real child-process validation (dev and built).
- **Final-path race** between claim and rename — mitigated by atomic
  exclusive-create placeholder claim.
- **Memory** on low-RAM PCs with very large HWPX × pool size — mitigated by the
  conservative default and documented caveat; memory-based cap is a follow-up.
- **Throughput above ~4** bounded by the libuv threadpool — benchmark; optional
  `UV_THREADPOOL_SIZE` tuning.
- **Flaky parity tests** if reports are not normalized — tests MUST strip
  `performance` and compare entry data, not raw bytes.
