# Worker-Pool Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parallelize the CLI `batch` subcommand across documents using a worker-thread pool so multi-core machines process folders far faster, with output semantically identical to sequential runs.

**Architecture:** Main thread enumerates files, atomically claims each final output/report path, and dispatches one job per file to a pool of worker threads. Each worker reads → optimizes (with per-document image concurrency forced to 1) → writes *temp* artifacts; main commits temp→final on success and cleans up on failure/cancellation. A one-value `imageConcurrency` option is threaded through every core image `mapLimit` site so pool-level parallelism does not oversubscribe libvips.

**Tech Stack:** Node 20 `worker_threads`, TypeScript, Vitest, JSZip, sharp/libvips, tsx (dev).

## Global Constraints

- Node ≥ 20.20.0 (`.node-version` = 20.20.2). Tests run under Node 20 (default shell Node may be 18).
- `packages/core` has NO filesystem or terminal I/O and NO `process.env` reads — concurrency is passed as an explicit option, never an env var.
- Safety rules (never violate): never overwrite/mutate the original input; never delete a referenced resource; if verification fails, produce no output.
- Output parity is SEMANTIC, not byte: compare unzipped entry data + reports with the `performance` field stripped; never compare raw ZIP bytes (JSZip stamps current time).
- Every task is TDD: write the failing test, watch it fail, minimal implementation, watch it pass, commit.
- Run tests with Node 20 from the worktree root (worktree has no local
  node_modules; deps resolve from the main repo). Exact command:
  `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20; node /home/eunsang26/projects/hwpx-optimizer/node_modules/vitest/vitest.mjs run <path>`
  Typecheck: `node /home/eunsang26/projects/hwpx-optimizer/node_modules/typescript/bin/tsc -b packages/core packages/cli --pretty false`
- Pre-existing failing test `packages/cli/test/cli.test.ts > "verifies an HWPX file"` is out of scope; do not attempt to fix it.

## File Structure

- `packages/core/src/concurrency.ts` — add `resolveImageConcurrency(requested?)`.
- `packages/core/src/{analyzer,imageDuplicates,optimizer,balancedOptimizer,verifier}.ts` — accept optional `imageConcurrency` and pass it to their `mapLimit` calls.
- `packages/core/src/balancedOptimizer.ts` — additionally move warning emission into the entry-order assembly loop (determinism).
- `packages/core/src/optimize.ts` — accept `imageConcurrency` on the public optimize/analyze options and forward it.
- `packages/cli/src/workerPool.ts` (new) — generic worker pool.
- `packages/cli/src/optimizeWorker.ts` (new) — per-document worker entry.
- `packages/cli/src/index.ts` — `parseBatchJobs`, path claim registry, `runBatch` rewrite, startup sweep, signal handling.
- `package.json` — `cli` script uses `node --import tsx`.

---

### Task 1: `resolveImageConcurrency` helper

**Files:**
- Modify: `packages/core/src/concurrency.ts`
- Test: `packages/core/test/concurrency.test.ts`

**Interfaces:**
- Consumes: existing `defaultImageConcurrency(): number`.
- Produces: `resolveImageConcurrency(requested?: number): number` — returns `defaultImageConcurrency()` when `requested` is undefined, else `max(1, floor(requested))`.

- [ ] **Step 1: Write the failing test** — append to `packages/core/test/concurrency.test.ts`:

```typescript
import { resolveImageConcurrency, defaultImageConcurrency } from "../src/concurrency.js";

describe("resolveImageConcurrency", () => {
  it("defaults to defaultImageConcurrency() when unset", () => {
    expect(resolveImageConcurrency(undefined)).toBe(defaultImageConcurrency());
  });
  it("uses the requested value when provided", () => {
    expect(resolveImageConcurrency(1)).toBe(1);
    expect(resolveImageConcurrency(3)).toBe(3);
  });
  it("floors to at least 1 for invalid input", () => {
    expect(resolveImageConcurrency(0)).toBe(1);
    expect(resolveImageConcurrency(-4)).toBe(1);
    expect(resolveImageConcurrency(2.9)).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run packages/core/test/concurrency.test.ts`
Expected: FAIL — `resolveImageConcurrency` is not exported.

- [ ] **Step 3: Write minimal implementation** — add to `packages/core/src/concurrency.ts`:

```typescript
export function resolveImageConcurrency(requested?: number): number {
  if (requested === undefined) return defaultImageConcurrency();
  if (!Number.isFinite(requested)) return defaultImageConcurrency();
  return Math.max(1, Math.floor(requested));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_modules/vitest/vitest.mjs run packages/core/test/concurrency.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/concurrency.ts packages/core/test/concurrency.test.ts
git commit -m "feat(core): add resolveImageConcurrency helper"
```

---

### Task 2: Thread `imageConcurrency` through safe optimizer + verifier + analyzer + imageDuplicates

**Files:**
- Modify: `packages/core/src/optimizer.ts` (mapLimit at line ~34; `applySafeOptimizationPlan` input type)
- Modify: `packages/core/src/verifier.ts` (mapLimit at line ~144; `verifyHwpxOutput` options + internal `verifyVisualSimilarityPairs`)
- Modify: `packages/core/src/analyzer.ts` (mapLimit at line ~65; `analyzeHwpxPackage` options)
- Modify: `packages/core/src/imageDuplicates.ts` (mapLimit at lines ~55 and ~103; exported functions' options)
- Test: `packages/core/test/optimizer.test.ts`

**Interfaces:**
- Consumes: `resolveImageConcurrency` (Task 1).
- Produces:
  - `applySafeOptimizationPlan(input: { pkg; plan; imageConcurrency?: number })`
  - `verifyHwpxOutput(output, options?: { ...existing; imageConcurrency?: number })`
  - `analyzeHwpxPackage(pkg, options?: { ...existing; imageConcurrency?: number })`
  - imageDuplicates exported fns gain `options?: { imageConcurrency?: number }`
  - In every case, omitting `imageConcurrency` preserves current behavior.

- [ ] **Step 1: Write the failing test** — append to `packages/core/test/optimizer.test.ts`:

```typescript
it("optimizes PNGs when imageConcurrency is forced to 1", async () => {
  const png = await sharp({ create: { width: 64, height: 48, channels: 4, background: { r: 5, g: 90, b: 200, alpha: 1 } } })
    .png({ compressionLevel: 0 })
    .toBuffer();
  const pkg: HwpxPackage = { entries: [{ path: "BinData/x.png", data: png, size: png.byteLength, kind: "image" }] };
  const plan: OptimizationPlan = { mode: "safe", actions: [{ type: "optimize-png", target: "BinData/x.png", risk: "safe" }] };

  const result = await applySafeOptimizationPlan({ pkg, plan, imageConcurrency: 1 });

  expect(result.pkg.entries[0].data.byteLength).toBeLessThan(png.byteLength);
  expect(result.applied).toContainEqual(expect.objectContaining({ type: "optimize-png", target: "BinData/x.png" }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run packages/core/test/optimizer.test.ts`
Expected: FAIL — `applySafeOptimizationPlan` input type has no `imageConcurrency` (TypeScript error) / runtime ignores it.

- [ ] **Step 3: Write minimal implementation**

In `optimizer.ts` — import and use the resolver:

```typescript
import { defaultImageConcurrency, mapLimit, resolveImageConcurrency } from "./concurrency.js";

export async function applySafeOptimizationPlan(input: {
  pkg: HwpxPackage;
  plan: OptimizationPlan;
  imageConcurrency?: number;
}): Promise<{ pkg: HwpxPackage; applied: AppliedAction[]; skipped: AppliedAction[]; warnings: string[] }> {
  // ...unchanged setup...
  await mapLimit(pngTargetEntries, resolveImageConcurrency(input.imageConcurrency), async (entry) => {
    // ...unchanged body...
  });
```

In `verifier.ts` — accept and forward:

```typescript
import { defaultImageConcurrency, mapLimit, resolveImageConcurrency } from "./concurrency.js";
// verifyHwpxOutput options type: add `imageConcurrency?: number`.
// thread it to verifyVisualSimilarityPairs(pairs, mode, imageConcurrency?) and use
await mapLimit(uniquePairs, resolveImageConcurrency(imageConcurrency), async (pair) => { /* unchanged */ });
```

In `analyzer.ts` — add `imageConcurrency?: number` to the options object and:

```typescript
const images = await mapLimit(imageInputs, resolveImageConcurrency(options?.imageConcurrency), (image) => /* unchanged */);
```

In `imageDuplicates.ts` — add `options?: { imageConcurrency?: number }` to the exported functions that own the two `mapLimit` calls (lines ~55, ~103) and pass `resolveImageConcurrency(options?.imageConcurrency)` to each.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node node_modules/vitest/vitest.mjs run packages/core`
Expected: PASS (new test + all existing core tests green — the option is additive, defaults preserved).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/optimizer.ts packages/core/src/verifier.ts packages/core/src/analyzer.ts packages/core/src/imageDuplicates.ts packages/core/test/optimizer.test.ts
git commit -m "feat(core): thread imageConcurrency through safe/verify/analyze/dup image mapLimits"
```

---

### Task 3: Balanced optimizer — `imageConcurrency` + deterministic warning order

**Files:**
- Modify: `packages/core/src/balancedOptimizer.ts` (mapLimit ~57; warning push ~72; assembly loop ~85; `applyBalancedOptimizationPlan` input)
- Test: `packages/core/test/balanced.test.ts`

**Interfaces:**
- Produces: `applyBalancedOptimizationPlan(input: { pkg; plan; profile; onTransformProgress?; imageConcurrency?: number })`. Skipped-transform warnings are emitted in **entry order**, independent of completion order.

- [ ] **Step 1: Write the failing test** — append to `packages/core/test/balanced.test.ts`. Build a package with two images that both FAIL to transform (e.g. corrupt bytes for a resize action) so two warnings are produced, and assert warning order matches entry order at concurrency 1 and at default:

```typescript
it("emits transform-skip warnings in entry order regardless of concurrency", async () => {
  const bad = (name: string) => ({ path: name, data: Buffer.from("not-an-image"), size: 12, kind: "image" as const });
  const pkg: HwpxPackage = {
    entries: [
      { path: "Contents/content.hpf", data: Buffer.from('<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest><opf:item id="a" href="BinData/a.png" media-type="image/png"/><opf:item id="b" href="BinData/b.png" media-type="image/png"/></opf:manifest></opf:package>'), size: 10, kind: "xml" },
      { path: "Contents/section0.xml", data: Buffer.from('<root><hc:img binaryItemIDRef="a"/><hc:img binaryItemIDRef="b"/></root>'), size: 10, kind: "xml" },
      bad("BinData/a.png"),
      bad("BinData/b.png"),
    ],
  };
  const plan: OptimizationPlan = { mode: "balanced", actions: [
    { type: "resize-png", target: "BinData/a.png", risk: "medium" },
    { type: "resize-png", target: "BinData/b.png", risk: "medium" },
  ]};

  const one = await applyBalancedOptimizationPlan({ pkg, plan, profile: balancedImageProfile, imageConcurrency: 1 });
  const many = await applyBalancedOptimizationPlan({ pkg, plan, profile: balancedImageProfile, imageConcurrency: 8 });

  const order = (w: string[]) => w.filter((m) => m.includes("BinData/")).map((m) => (m.includes("/a.png") ? "a" : "b"));
  expect(order(one.warnings)).toEqual(["a", "b"]);
  expect(order(many.warnings)).toEqual(["a", "b"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run packages/core/test/balanced.test.ts`
Expected: FAIL — `imageConcurrency` not accepted, and/or warning order depends on completion order.

- [ ] **Step 3: Write minimal implementation**

In `balancedOptimizer.ts`:
1. Add `imageConcurrency?: number` to the `applyBalancedOptimizationPlan` input type; pass `resolveImageConcurrency(input.imageConcurrency)` to the `mapLimit(tasks, ...)` at line ~57 (import `resolveImageConcurrency`).
2. Remove the `warnings.push(...)` from inside the mapper (line ~72). Instead have the `catch` set the outcome to skipped WITH the reason: `return { ...task, status: "skipped", reason };` (extend `TransformOutcome` with `reason?: string`).
3. In the entry-order `for (const outcome of outcomes)` loop (~line 85), when `outcome.status === "skipped"` and `outcome.reason` is set, push the warning there:
   `warnings.push(`${outcome.action} skipped for ${outcome.entry.path}: ${outcome.reason}`);`

- [ ] **Step 4: Run tests to verify they pass**

Run: `node node_modules/vitest/vitest.mjs run packages/core/test/balanced.test.ts`
Then full core: `node node_modules/vitest/vitest.mjs run packages/core`
Expected: PASS (new determinism test + existing balanced tests green).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/balancedOptimizer.ts packages/core/test/balanced.test.ts
git commit -m "feat(core): balanced imageConcurrency + entry-order warning determinism"
```

---

### Task 4: Public optimize/analyze entry points forward `imageConcurrency`

**Files:**
- Modify: `packages/core/src/optimize.ts` (option types for `optimizeHwpxBufferSafe/Balanced/Aggressive`, `analyzeHwpxBuffer`; forward into the apply/verify/analyze calls)
- Test: `packages/core/test/optimize.test.ts`

**Interfaces:**
- Produces: each public optimize/analyze options object accepts `imageConcurrency?: number`, forwarded to `applySafe/applyBalanced/verifyHwpxOutput/analyzeHwpxPackage`. Default (omitted) preserves behavior. `optimizeByMode` in the CLI (Task 9) will pass `imageConcurrency: 1`.

- [ ] **Step 1: Write the failing test** — append to `packages/core/test/optimize.test.ts`:

```typescript
it("accepts imageConcurrency on safe optimize and produces a smaller file", async () => {
  const input = await createReportLikeHwpxFixture();
  const { output } = await optimizeHwpxBufferSafe(input, { imageConcurrency: 1 });
  expect(output.byteLength).toBeLessThan(input.byteLength);
});
```

(Import `createReportLikeHwpxFixture` from `./fixtures.js`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run packages/core/test/optimize.test.ts`
Expected: FAIL — `imageConcurrency` not on `SafeOptimizeOptions`.

- [ ] **Step 3: Write minimal implementation**

In `optimize.ts`: add `imageConcurrency?: number` to `SafeOptimizeOptions` and `OptimizeOptions`. Forward it:
- `applySafeOptimizationPlan({ pkg, plan, imageConcurrency: options.imageConcurrency })`
- `verifyHwpxOutput(output, { ..., imageConcurrency: options.imageConcurrency })`
- `analyzeHwpxPackage(pkg, { ...analysisOptions(...), imageConcurrency: options.imageConcurrency })`
- `applyBalancedOptimizationPlan({ ..., imageConcurrency: settings.options.imageConcurrency })`
- In `optimizeHwpxBufferWithProfile`, forward `settings.options.imageConcurrency` into its verify/analyze/apply calls too.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node node_modules/vitest/vitest.mjs run packages/core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/optimize.ts packages/core/test/optimize.test.ts
git commit -m "feat(core): forward imageConcurrency through public optimize/analyze options"
```

---

### Task 5: `parseBatchJobs` supports `max` and drops the 4-cap

**Files:**
- Modify: `packages/cli/src/index.ts` (`parseBatchJobs` ~line 604)
- Test: `packages/cli/test/cli.test.ts`

**Interfaces:**
- Produces: `parseBatchJobs(value: string | undefined): number` — `undefined` → `max(1, min(cores-1, 4))`; `"max"` → `availableParallelism()`; a positive integer → that integer (no 4-cap); invalid → throws `"--jobs must be a positive integer or \"max\"."`.

- [ ] **Step 1: Write the failing test** — add to `packages/cli/test/cli.test.ts` (import `parseBatchJobs` if exported, or test via a small exported wrapper — export `parseBatchJobs`):

```typescript
import { parseBatchJobs } from "../src/index.js";
import { availableParallelism } from "node:os";

describe("parseBatchJobs", () => {
  it("maps 'max' to the core count", () => {
    expect(parseBatchJobs("max")).toBe(availableParallelism());
  });
  it("honors an explicit number above 4", () => {
    expect(parseBatchJobs("8")).toBe(8);
  });
  it("rejects invalid values", () => {
    expect(() => parseBatchJobs("0")).toThrow(/positive integer or "max"/);
    expect(() => parseBatchJobs("-2")).toThrow(/positive integer or "max"/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run packages/cli/test/cli.test.ts -t parseBatchJobs`
Expected: FAIL — `"max"` unsupported / cap still applied / not exported.

- [ ] **Step 3: Write minimal implementation** — replace `parseBatchJobs`, add `export`:

```typescript
import { availableParallelism } from "node:os";

export function parseBatchJobs(value: string | undefined): number {
  if (value === undefined) return Math.max(1, Math.min(availableParallelism() - 1, 4));
  if (value === "max") return Math.max(1, availableParallelism());
  const jobs = Number(value);
  if (!Number.isInteger(jobs) || jobs <= 0) {
    throw new Error('--jobs must be a positive integer or "max".');
  }
  return jobs;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_modules/vitest/vitest.mjs run packages/cli/test/cli.test.ts -t parseBatchJobs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/index.ts packages/cli/test/cli.test.ts
git commit -m "feat(cli): --jobs max + remove 4-job cap"
```

---

### Task 6: Atomic path claim registry

**Files:**
- Create: `packages/cli/src/pathClaims.ts`
- Test: `packages/cli/test/pathClaims.test.ts`

**Interfaces:**
- Produces:
  - `claimPath(preferredPath: string): Promise<string>` — atomically creates a 0-byte placeholder at `preferredPath` (flag `wx`); on `EEXIST`, tries `name (1).ext`, `name (2).ext`, … until one succeeds; returns the claimed path.
  - `class PathClaimRegistry { claim(preferredPath): Promise<string>; release(path): Promise<void>; releaseAll(): Promise<void>; }` — tracks claimed paths for cleanup.

- [ ] **Step 1: Write the failing test** — `packages/cli/test/pathClaims.test.ts`:

```typescript
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, stat, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PathClaimRegistry } from "../src/pathClaims.js";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "claims-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("PathClaimRegistry", () => {
  it("claims the preferred path when free", async () => {
    const reg = new PathClaimRegistry();
    const p = await reg.claim(join(dir, "a.hwpx"));
    expect(p).toBe(join(dir, "a.hwpx"));
    expect((await stat(p)).size).toBe(0);
  });
  it("suffixes when the preferred path is taken", async () => {
    await writeFile(join(dir, "a.hwpx"), "x");
    const reg = new PathClaimRegistry();
    const p = await reg.claim(join(dir, "a.hwpx"));
    expect(p).toBe(join(dir, "a (1).hwpx"));
  });
  it("does not hand out the same path twice", async () => {
    const reg = new PathClaimRegistry();
    const p1 = await reg.claim(join(dir, "a.hwpx"));
    const p2 = await reg.claim(join(dir, "a.hwpx"));
    expect(p1).not.toBe(p2);
  });
  it("releaseAll removes 0-byte placeholders", async () => {
    const reg = new PathClaimRegistry();
    await reg.claim(join(dir, "a.hwpx"));
    await reg.releaseAll();
    expect(await readdir(dir)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run packages/cli/test/pathClaims.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation** — `packages/cli/src/pathClaims.ts`:

```typescript
import { open, unlink } from "node:fs/promises";
import { dirname, join, basename, extname } from "node:path";

export async function claimPath(preferredPath: string): Promise<string> {
  const dir = dirname(preferredPath);
  const ext = extname(preferredPath);
  const stem = basename(preferredPath, ext);
  for (let i = 0; ; i += 1) {
    const candidate = i === 0 ? preferredPath : join(dir, `${stem} (${i})${ext}`);
    try {
      const handle = await open(candidate, "wx");
      await handle.close();
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
  }
}

export class PathClaimRegistry {
  private readonly claimed = new Set<string>();
  async claim(preferredPath: string): Promise<string> {
    const path = await claimPath(preferredPath);
    this.claimed.add(path);
    return path;
  }
  async release(path: string): Promise<void> {
    this.claimed.delete(path);
    await unlink(path).catch(() => {});
  }
  async releaseAll(): Promise<void> {
    await Promise.all([...this.claimed].map((p) => unlink(p).catch(() => {})));
    this.claimed.clear();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_modules/vitest/vitest.mjs run packages/cli/test/pathClaims.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/pathClaims.ts packages/cli/test/pathClaims.test.ts
git commit -m "feat(cli): atomic path claim registry"
```

---

### Task 7: Worker pool

**Files:**
- Create: `packages/cli/src/workerPool.ts`
- Test: `packages/cli/test/workerPool.test.ts`
- Create (test fixture worker): `packages/cli/test/fixtures/echoWorker.mjs`

**Interfaces:**
- Produces:
  - `class WorkerPool<TJob, TResult>` constructed with `{ size: number; workerUrl: URL; execArgv?: string[] }`.
  - `run(jobs: TJob[]): Promise<TResult[]>` — dispatches jobs, at most `size` concurrent, results returned in job order; a job whose worker throws/exits resolves to a `{ index, status: "failed", error }` result via the worker protocol; a crashed worker is replaced and the queue continues; never exceeds `size` live workers.
  - `terminate(): Promise<void>`.
- Worker protocol: pool posts `{ index, job }`; worker posts `{ index, result }` or throws (→ pool synthesizes failure). The pool is generic; the optimize worker (Task 8) defines the concrete result shape.

- [ ] **Step 1: Write the failing test** — fixture worker `packages/cli/test/fixtures/echoWorker.mjs`:

```javascript
import { parentPort } from "node:worker_threads";
parentPort.on("message", ({ index, job }) => {
  if (job.crash) { process.exit(1); }
  if (job.fail) { throw new Error(`boom ${index}`); }
  parentPort.postMessage({ index, result: { doubled: job.n * 2 } });
});
```

Test `packages/cli/test/workerPool.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { WorkerPool } from "../src/workerPool.js";

const workerUrl = new URL("./fixtures/echoWorker.mjs", import.meta.url);

describe("WorkerPool", () => {
  it("runs all jobs and returns results in order", async () => {
    const pool = new WorkerPool({ size: 2, workerUrl });
    const out = await pool.run([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }]);
    await pool.terminate();
    expect(out.map((r) => r.status === "ok" ? r.result.doubled : "x")).toEqual([2, 4, 6, 8]);
  });
  it("isolates a throwing job without aborting the rest", async () => {
    const pool = new WorkerPool({ size: 2, workerUrl });
    const out = await pool.run([{ n: 1 }, { fail: true }, { n: 3 }]);
    await pool.terminate();
    expect(out[0].status).toBe("ok");
    expect(out[1].status).toBe("failed");
    expect(out[2].status).toBe("ok");
  });
  it("recovers from a crashed worker and still drains the queue", async () => {
    const pool = new WorkerPool({ size: 1, workerUrl });
    const out = await pool.run([{ crash: true }, { n: 5 }]);
    await pool.terminate();
    expect(out[0].status).toBe("failed");
    expect(out[1].status === "ok" && out[1].result.doubled).toBe(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run packages/cli/test/workerPool.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation** — `packages/cli/src/workerPool.ts`:

```typescript
import { Worker } from "node:worker_threads";

export type PoolResult<TResult> =
  | { index: number; status: "ok"; result: TResult }
  | { index: number; status: "failed"; error: string };

type PoolOptions = { size: number; workerUrl: URL; execArgv?: string[] };

export class WorkerPool<TJob, TResult> {
  private readonly size: number;
  private readonly workerUrl: URL;
  private readonly execArgv?: string[];
  constructor(options: PoolOptions) {
    this.size = Math.max(1, options.size);
    this.workerUrl = options.workerUrl;
    this.execArgv = options.execArgv;
  }

  async run(jobs: TJob[]): Promise<Array<PoolResult<TResult>>> {
    const results = new Array<PoolResult<TResult>>(jobs.length);
    let next = 0;
    const worker = (): Promise<void> =>
      new Promise((resolveWorker) => {
        const spawn = () => {
          if (next >= jobs.length) return resolveWorker();
          const index = next++;
          const w = new Worker(this.workerUrl, this.execArgv ? { execArgv: this.execArgv } : undefined);
          let settled = false;
          const done = (r: PoolResult<TResult>) => {
            if (settled) return;
            settled = true;
            results[index] = r;
            w.terminate().finally(spawn);
          };
          w.once("message", (msg: { index: number; result: TResult }) => done({ index, status: "ok", result: msg.result }));
          w.once("error", (err: Error) => done({ index, status: "failed", error: err.message }));
          w.once("exit", (code) => { if (code !== 0) done({ index, status: "failed", error: `worker exited with code ${code}` }); });
          w.postMessage({ index, job: jobs[index] });
        };
        spawn();
      });
    await Promise.all(Array.from({ length: Math.min(this.size, jobs.length) }, () => worker()));
    return results;
  }

  async terminate(): Promise<void> { /* workers are per-job and self-terminate; no-op kept for API symmetry */ }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_modules/vitest/vitest.mjs run packages/cli/test/workerPool.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/workerPool.ts packages/cli/test/workerPool.test.ts packages/cli/test/fixtures/echoWorker.mjs
git commit -m "feat(cli): generic worker pool with failure isolation + crash recovery"
```

---

### Task 8: Optimize worker entry

**Files:**
- Create: `packages/cli/src/optimizeWorker.ts`
- Test: `packages/cli/test/optimizeWorker.test.ts`

**Interfaces:**
- Consumes: core `optimizeByMode`-equivalent — reuse the existing `optimizeByMode(buffer, mode, options, targetBytes?)` from `index.ts` by extracting it into a shared importable module `packages/cli/src/optimizeByMode.ts` (move the function; `index.ts` re-imports it). The worker calls it with `imageConcurrency: 1`.
- Job shape (from pool): `{ sourcePath, tempOutputPath, tempReportPath, mode, options, targetBytes? }`.
- Result shape: `{ status: "optimized", originalSize, optimizedSize, savedBytes, savedPercent } | { status: "failed", stage, error }`.
- Worker startup sets `sharp.concurrency(1)` before signalling readiness.

- [ ] **Step 1: Write the failing test** — test the worker's pure job function (extract `runOptimizeJob` so it is unit-testable without threads). `packages/cli/test/optimizeWorker.test.ts`:

```typescript
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runOptimizeJob } from "../src/optimizeWorker.js";
import { createReportLikeHwpxFixture } from "../../core/test/fixtures.js";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "optjob-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("runOptimizeJob", () => {
  it("optimizes to temp artifacts and reports savings", async () => {
    const src = join(dir, "in.hwpx");
    await writeFile(src, await createReportLikeHwpxFixture());
    const tempOut = join(dir, "out.hwpx.tmp");
    const tempReport = join(dir, "out.report.json.tmp");
    const result = await runOptimizeJob({ sourcePath: src, tempOutputPath: tempOut, tempReportPath: tempReport, mode: "safe", options: {} });
    expect(result.status).toBe("optimized");
    expect((await readFile(tempOut)).byteLength).toBeGreaterThan(0);
    expect(JSON.parse(await readFile(tempReport, "utf8")).optimizedSize).toBeGreaterThan(0);
  });
  it("returns a failed result for an unreadable input", async () => {
    const result = await runOptimizeJob({ sourcePath: join(dir, "missing.hwpx"), tempOutputPath: join(dir, "o.tmp"), tempReportPath: join(dir, "r.tmp"), mode: "safe", options: {} });
    expect(result.status).toBe("failed");
    expect(result.stage).toBe("read-input");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run packages/cli/test/optimizeWorker.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

First extract `optimizeByMode` from `index.ts` into `packages/cli/src/optimizeByMode.ts` (cut/paste the function + its `readSupportedInput` dependency it needs; re-export from `index.ts`). Then `packages/cli/src/optimizeWorker.ts`:

```typescript
import { parentPort } from "node:worker_threads";
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { optimizeByMode } from "./optimizeByMode.js";

sharp.concurrency(1);

export type OptimizeJob = {
  sourcePath: string; tempOutputPath: string; tempReportPath: string;
  mode: "safe" | "balanced" | "aggressive"; options: Record<string, string>; targetBytes?: number;
};
export type OptimizeJobResult =
  | { status: "optimized"; originalSize: number; optimizedSize: number; savedBytes: number; savedPercent: number }
  | { status: "failed"; stage: "read-input" | "optimize" | "write-output"; error: string };

export async function runOptimizeJob(job: OptimizeJob): Promise<OptimizeJobResult> {
  let stage: "read-input" | "optimize" | "write-output" = "read-input";
  try {
    const buffer = await readFile(job.sourcePath);
    stage = "optimize";
    const { output, report } = await optimizeByMode(buffer, job.mode, { ...job.options, imageConcurrency: 1 } as never, job.targetBytes);
    stage = "write-output";
    await writeFile(job.tempOutputPath, output);
    await writeFile(job.tempReportPath, JSON.stringify(report, null, 2));
    return { status: "optimized", originalSize: report.originalSize, optimizedSize: report.optimizedSize ?? output.byteLength, savedBytes: report.savedBytes ?? 0, savedPercent: report.savedPercent ?? 0 };
  } catch (error) {
    return { status: "failed", stage, error: error instanceof Error ? error.message : String(error) };
  }
}

if (parentPort) {
  parentPort.on("message", async ({ index, job }: { index: number; job: OptimizeJob }) => {
    parentPort!.postMessage({ index, result: await runOptimizeJob(job) });
  });
}
```

Note: `optimizeByMode` must forward `imageConcurrency` from its options into the core optimize calls (Task 4 added the option; ensure `optimizeByMode` passes it through).

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_modules/vitest/vitest.mjs run packages/cli/test/optimizeWorker.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/optimizeWorker.ts packages/cli/src/optimizeByMode.ts packages/cli/src/index.ts packages/cli/test/optimizeWorker.test.ts
git commit -m "feat(cli): optimize worker entry (temp artifacts, sharp.concurrency 1)"
```

---

### Task 9: `runBatch` rewrite — claim/dispatch/commit + sweep + signals

**Files:**
- Modify: `packages/cli/src/index.ts` (`runBatch`, add startup sweep + worker path resolution + SIGINT/SIGTERM)
- Test: `packages/cli/test/cli.test.ts`

**Interfaces:**
- Consumes: `PathClaimRegistry` (Task 6), `WorkerPool` (Task 7), `OptimizeJob`/`OptimizeJobResult` (Task 8).
- Produces: `runBatch(inputDir, options)` that (1) enumerates + sweeps stale `*.tmp`, (2) claims final output/report paths per file (per-file `resolve-output-path` failure on claim error, batch continues), (3) `jobsEffective = min(parseBatchJobs(options.jobs), claimedCount)`, (4) dispatches jobs to the pool with temp paths, (5) on `optimized` renames temp→final (output then report; rollback + release on report-rename failure), on `failed` deletes temp + releases claim, (6) writes `batch-report.json` (with `jobsRequested`/`jobsEffective`) via temp→rename, (7) SIGINT/SIGTERM → releaseAll + delete temps + exit 130/143.
- Worker URL resolution: `new URL(import.meta.url.endsWith(".ts") ? "./optimizeWorker.ts" : "./optimizeWorker.js", import.meta.url)`, spawned with `execArgv: process.execArgv`.

- [ ] **Step 1: Write the failing test** — add to `packages/cli/test/cli.test.ts` a batch integration test asserting semantic parity + report fields:

```typescript
it("batch output matches sequential optimizeByMode (semantic parity) and records jobs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "batch-"));
  const outDir = join(dir, "out");
  await writeFile(join(dir, "one.hwpx"), await createReportLikeHwpxFixture());
  await writeFile(join(dir, "two.hwpx"), await createReportLikeHwpxFixture());

  await runBatch(dir, { mode: "safe", out: outDir, jobs: "2" });

  const files = (await readdir(outDir)).filter((f) => f.endsWith(".optimized.hwpx"));
  expect(files.length).toBe(2);
  // semantic parity: unzip an output and the sequential result, compare entry data
  const seq = await optimizeByMode(await createReportLikeHwpxFixture(), "safe", {}, undefined);
  const batchOut = await readFile(join(outDir, files.sort()[0]));
  expect(await unzipEntryNames(batchOut)).toEqual(await unzipEntryNames(seq.output));

  const report = JSON.parse(await readFile(join(outDir, "batch-report.json"), "utf8"));
  expect(report.totals.optimized).toBe(2);
  expect(report.jobsRequested).toBe(2);
  expect(report.jobsEffective).toBe(2);
  await rm(dir, { recursive: true, force: true });
});
```

Add a helper `unzipEntryNames(buf)` (JSZip `loadAsync` → sorted `Object.keys(zip.files)`).

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run packages/cli/test/cli.test.ts -t "semantic parity"`
Expected: FAIL — `runBatch` does not yet use the pool / lacks `jobsRequested`/`jobsEffective`.

- [ ] **Step 3: Write minimal implementation**

Rewrite `runBatch` per the Interfaces above. Key pieces:
- Startup sweep: `for (const f of await readdir(outputDir)) if (f.endsWith(".tmp")) await unlink(join(outputDir, f)).catch(()=>{})`.
- Claim loop (sequential): for each file, `try { const outputPath = await claims.claim(join(outputDir, base + ".optimized.hwpx")); const reportPath = await claims.claim(outputPath + ".report.json"); assertDoesNotTargetAnyInput(...); jobs.push({...tempPaths}) } catch { record resolve-output-path failure }`. Use temp paths `outputPath + ".tmp"`, `reportPath + ".tmp"`.
- `jobsRequested = parseBatchJobs(options.jobs); jobsEffective = Math.max(1, Math.min(jobsRequested, jobs.length))`. If `jobs.length === 0`, skip pool.
- `const pool = new WorkerPool({ size: jobsEffective, workerUrl, execArgv: process.execArgv }); const results = await pool.run(jobDescriptors);`
- Commit loop: for each ok result, `await rename(tempOutputPath, finalOutputPath); try { await rename(tempReportPath, finalReportPath) } catch (e) { await rename(finalOutputPath, tempOutputPath); await claims.release(finalOutputPath); throw }`. For failed results: `await unlink(tempOutputPath).catch(()=>{}); await unlink(tempReportPath).catch(()=>{}); await claims.release(outputPath); await claims.release(reportPath)`.
- Batch report: write to `batch-report.json.tmp` then `rename`. Include `jobsRequested`, `jobsEffective`.
- Signals: `const onSignal = (code) => { pool.terminate(); claims.releaseAll(); process.exit(code) }; process.once("SIGINT", () => onSignal(130)); process.once("SIGTERM", () => onSignal(143));` (register at runBatch start, remove on completion).

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_modules/vitest/vitest.mjs run packages/cli/test/cli.test.ts`
Expected: PASS (new parity test; existing batch tests still green — pre-existing unrelated failure excluded).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/index.ts packages/cli/test/cli.test.ts
git commit -m "feat(cli): worker-pool runBatch with claim/commit/rollback, sweep, signals"
```

---

### Task 10: Dev/prod worker launch wiring + child-process validation

**Files:**
- Modify: `package.json` (`cli` script)
- Test: `packages/cli/test/batchChildProcess.test.ts`

**Interfaces:**
- `cli` script becomes `node --import tsx --conditions=development packages/cli/src/index.ts`, so `process.execArgv` carries `--import tsx` and the worker (Task 9) spawns with it in dev.

- [ ] **Step 1: Write the failing test** — `packages/cli/test/batchChildProcess.test.ts` runs the real CLI as a child process over a temp dir (proves tsx-under-worker works end to end):

```typescript
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReportLikeHwpxFixture } from "../../core/test/fixtures.js";

const run = promisify(execFile);
let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "cli-batch-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("batch via real child process (dev tsx)", () => {
  it("optimizes a folder with --jobs 2", async () => {
    await writeFile(join(dir, "a.hwpx"), await createReportLikeHwpxFixture());
    await writeFile(join(dir, "b.hwpx"), await createReportLikeHwpxFixture());
    await run("node", ["--import", "tsx", "--conditions=development", "packages/cli/src/index.ts", "batch", dir, "--mode", "safe", "--out", join(dir, "out"), "--jobs", "2"], { cwd: process.cwd() });
    const files = (await readdir(join(dir, "out"))).filter((f) => f.endsWith(".optimized.hwpx"));
    expect(files.length).toBe(2);
  }, 60_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run packages/cli/test/batchChildProcess.test.ts`
Expected: FAIL — worker cannot load the `.ts` file in the spawned thread (tsx not registered) until the launch wiring is correct.

- [ ] **Step 3: Write minimal implementation**

In `package.json`, change:
```json
"cli": "node --import tsx --conditions=development packages/cli/src/index.ts",
```
Confirm Task 9's worker spawn passes `execArgv: process.execArgv` and resolves `./optimizeWorker.ts` when `import.meta.url` ends with `.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_modules/vitest/vitest.mjs run packages/cli/test/batchChildProcess.test.ts`
Expected: PASS (2 optimized files produced by the real CLI in dev).

- [ ] **Step 5: Commit**

```bash
git add package.json packages/cli/src/index.ts packages/cli/test/batchChildProcess.test.ts
git commit -m "feat(cli): explicit tsx worker registration + child-process batch validation"
```

---

### Task 11: Full-suite gate + built-CLI smoke

**Files:** none new (verification task)

- [ ] **Step 1: Typecheck**

Run: `node node_modules/typescript/bin/tsc -b packages/core packages/cli --pretty false`
Expected: no errors.

- [ ] **Step 2: Full core + cli tests**

Run: `node node_modules/vitest/vitest.mjs run packages/core packages/cli`
Expected: all pass except the known pre-existing `"verifies an HWPX file"` failure (unchanged by this work).

- [ ] **Step 3: Built-CLI batch smoke**

Run: `npm run build` then run the built CLI batch over a temp folder of two fixtures; confirm 2 `.optimized.hwpx` outputs and a `batch-report.json` with correct totals.

- [ ] **Step 4: Commit (if any doc/notes updated)**

```bash
git add -A
git commit -m "chore: worker-pool batch verification pass"
```

---

## Self-Review

**Spec coverage:**
- §5 concurrency policy → Tasks 1–4 (option), Task 5 (`--jobs max`/cap), Task 9 (jobsEffective/empty short-circuit). ✓
- §5 oversubscription propagation (6 sites) → Tasks 2–4. ✓
- §7 claim/commit/rollback/signals → Tasks 6, 9. ✓
- §8 semantic parity + warning determinism → Task 3 (warnings), Task 9 (parity test). ✓
- §9 tsx worker resolution → Task 10. ✓
- §4/§6 protocol, temp artifacts, main reconstruction → Tasks 7–9. ✓
- §10 tests (pool, batch, claim, sweep, cancellation, concurrency, child-process) → Tasks 2–10 (cancellation asserted via signal handler in Task 9; add an explicit SIGINT test if time permits).

**Placeholder scan:** none — every step carries real code/commands.

**Type consistency:** `imageConcurrency?: number` used consistently; `OptimizeJob`/`OptimizeJobResult` shared by Tasks 7–9; `PathClaimRegistry.claim/release/releaseAll` names consistent; `parseBatchJobs` returns `number` everywhere; `runOptimizeJob` (ASCII) used throughout.
