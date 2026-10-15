import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHwpxFixture, createReportLikeHwpxFixture } from "../../../packages/core/test/fixtures.js";
import { verifyHwpxOutput } from "../../../packages/core/src/verifier.js";
import { defaultDesktopSettings, saveDesktopOptimization } from "../src/main/desktopService.js";
import { DocumentOperations } from "../src/main/documentOperations.js";
import { DocumentWorkerClient } from "../src/main/documentWorkerClient.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
let directory: string;
let input: string;
let source: Buffer;
let bootstrap: string;
let clients: DocumentWorkerClient[];
let operations: DocumentOperations[];
let gates: ReturnType<typeof deferred>[];
beforeEach(async () => {
  clients = []; operations = []; gates = [];
  directory = await mkdtemp(join(tmpdir(), "hwpx-document-cancel-"));
  input = join(directory, "input.hwpx"); source = await createHwpxFixture({ entries: {} }); await writeFile(input, source);
  bootstrap = join(directory, "worker.mjs");
  // Real production worker, with an external test gate that freezes its exact
  // emitted phase. No test-only delay or termination hooks ship in the app.
  await writeFile(bootstrap, `
    import { createRequire } from "node:module";
    import { pathToFileURL } from "node:url";
    import { parentPort, workerData } from "node:worker_threads";
    const require = createRequire(${JSON.stringify(resolve("package.json"))});
    const { register } = await import(pathToFileURL(require.resolve("tsx/esm/api")).href); register();
    const post = parentPort.postMessage.bind(parentPort);
    parentPort.postMessage = (message, ...args) => {
      post(message, ...args);
      if (message.type === "progress" && workerData?.blockAt && message.item.startsWith(workerData.blockAt)) {
        Atomics.wait(new Int32Array(workerData.gate), 0, 0);
      }
    };
    if (workerData?.exitCode) parentPort.on("message", () => process.exit(workerData.exitCode));
    await import(${JSON.stringify(pathToFileURL(resolve("apps/desktop/src/main/documentWorker.ts")).href)});
  `);
});
afterEach(async () => {
  for (const gate of gates) gate.resolve();
  for (const operation of operations) await operation.cancel();
  for (const client of clients) await client.dispose();
  vi.useRealTimers();
  await rm(directory, { recursive: true, force: true });
});
function client(workerData?: object) {
  const result = new DocumentWorkerClient(() => new Worker(bootstrap, { execArgv: ["--conditions=development"], workerData }));
  clients.push(result); return result;
}
function manager(timeout?: number) { const result = new DocumentOperations(timeout); operations.push(result); return result; }
function gate() { const result = deferred(); gates.push(result); return result; }
function request() { return { filePath: input, mode: "safe" as const, settings: { ...defaultDesktopSettings, saveReport: true, preventOverwrite: false } }; }
async function expectOldPair() {
  expect(await readFile(join(directory, "input_optimized.hwpx"), "utf8")).toBe("old document");
  expect(await readFile(join(directory, "input_optimized.hwpx.report.json"), "utf8")).toBe("old report");
  expect((await readdir(directory)).sort()).toEqual(["input.hwpx", "input_optimized.hwpx", "input_optimized.hwpx.report.json", "worker.mjs"]);
  expect((await readFile(input)).equals(source)).toBe(true);
}

describe("real document worker cancellation and restart", () => {
  it.each(["Reading HWPX package", "Applying safe document cleanup", "Verifying optimized document", "Transforming images"])(
    "terminates at %s without publishing files, then runs the next operation", async (blockAt) => {
      if (blockAt === "Transforming images") { source = await createReportLikeHwpxFixture(); await writeFile(input, source); }
      const worker = client({ blockAt, gate: new SharedArrayBuffer(4) }); const run = manager();
      const settings = { ...request(), mode: blockAt === "Transforming images" ? "balanced" as const : "safe" as const };
      const result = run.run("optimize", ({ signal, progress }) => worker.prepare(settings, signal, progress), (item) => {
        if (item.item.startsWith(blockAt)) void run.cancel("optimize");
      });
      await expect(result).rejects.toThrow("Optimization cancelled.");
      expect(run.busy).toBe(false);
      expect((await readdir(directory)).sort()).toEqual(["input.hwpx", "worker.mjs"]);
      const analysis = await run.run("analyze", ({ signal }) => worker.analyze(input, signal));
      expect(analysis.report.originalSize).toBe(source.length);
      expect((await readFile(input)).equals(source)).toBe(true);
    }, 15_000
  );
  it("forwards default quick and explicit detailed analysis through the real worker", async () => {
    source = await createReportLikeHwpxFixture(); await writeFile(input, source);
    const worker = client(); const run = manager();
    const quick = await run.run("analyze", ({ signal }) => worker.analyze(input, signal));
    const deep = await run.run("analyze", ({ signal }) => worker.analyze(input, signal, "deep"));
    expect(quick.report.analysis).toEqual({ mode: "quick", imageSizes: "estimated", visualDuplicatesChecked: false });
    expect(deep.report.analysis).toEqual({ mode: "deep", imageSizes: "encoded", visualDuplicatesChecked: true });
    expect(quick.report.nearDuplicateImages).toEqual([]);
    expect((await readFile(input)).equals(source)).toBe(true);
  }, 15_000);
  it("reports unexpected worker exit separately and isolates the next worker generation", async () => {
    let generation = 0;
    const worker = new DocumentWorkerClient(() => new Worker(bootstrap, { execArgv: ["--conditions=development"],
      workerData: ++generation === 1 ? { exitCode: 7 } : undefined }));
    clients.push(worker); const run = manager();
    await expect(run.run("analyze", ({ signal }) => worker.analyze(input, signal))).rejects.toThrow(/예기치 않게.*7/);
    const result = await run.run("analyze", ({ signal }) => worker.analyze(input, signal));
    expect(result.report.originalSize).toBe(source.length); expect(generation).toBe(2);
  }, 15_000);
  it("transfers a large unchanged output without detaching the worker's reusable input cache", async () => {
    source = await createHwpxFixture({ entries: { "Fonts/font.ttf": randomBytes(64 * 1024) } }); await writeFile(input, source);
    const worker = client(); const run = manager();
    const prepared = await run.run("optimize", ({ signal, progress }) => worker.prepare(request(), signal, progress));
    expect(prepared.output.byteLength).toBeGreaterThan(8192);
    await verifyHwpxOutput(Buffer.from(prepared.output));
    const next = await run.run("analyze", ({ signal }) => worker.analyze(input, signal));
    expect(next.report.originalSize).toBe(source.length);
    expect((await readFile(input)).equals(source)).toBe(true);
    expect((await readdir(directory)).sort()).toEqual(["input.hwpx", "worker.mjs"]);
  }, 15_000);
});

describe("main-owned saving and cancellation outcome", () => {
  it("waits for a rename to settle and restore the old pair before acknowledging cancellation", async () => {
    const worker = client(); const prepared = await worker.prepare(request(), new AbortController().signal, () => {});
    await writeFile(join(directory, "input_optimized.hwpx"), "old document");
    await writeFile(join(directory, "input_optimized.hwpx.report.json"), "old report");
    const started = gate(); const release = gate(); const run = manager();
    const result = run.run("optimize", context => saveDesktopOptimization(request(), prepared, context.progress,
      { ...context, operations: { move: async (from, to) => { await rename(from, to); started.resolve(); await release.promise; } } }));
    const rejected = expect(result).rejects.toThrow("Optimization cancelled.");
    await started.promise;
    const cancel = run.cancel("optimize");
    expect(run.busy).toBe(true);
    await expect(run.run("analyze", async () => "second")).rejects.toThrow(/already running/);
    release.resolve(); await rejected; expect(await cancel).toEqual({ cancelled: true }); await expectOldPair();
    expect((await run.run("analyze", ({ signal }) => worker.analyze(input, signal))).report.originalSize).toBe(source.length);
  }, 15_000);
  it("restores files after a save timeout and never reports it as a user cancellation", async () => {
    const worker = client(); const prepared = await worker.prepare(request(), new AbortController().signal, () => {});
    await writeFile(join(directory, "input_optimized.hwpx"), "old document");
    await writeFile(join(directory, "input_optimized.hwpx.report.json"), "old report");
    vi.useFakeTimers(); const started = gate(); const release = gate(); const run = manager(50);
    const result = run.run("optimize", context => saveDesktopOptimization(request(), prepared, context.progress,
      { ...context, operations: { move: async (from, to) => { await rename(from, to); started.resolve(); await release.promise; } } }));
    const rejected = expect(result).rejects.toThrow(/진행 응답.*저장/);
    await started.promise; await vi.advanceTimersByTimeAsync(60);
    expect(run.busy).toBe(true); release.resolve(); await rejected; await expectOldPair();
    expect(await run.cancel()).toEqual({ cancelled: false });
  }, 15_000);
  it("keeps a committed document/report result when cancel arrives during finalization", async () => {
    const worker = client(); const run = manager(); let cancellation: Promise<unknown> | undefined;
    const result = await run.run("optimize", async context => {
      const prepared = await worker.prepare(request(), context.signal, context.progress);
      return saveDesktopOptimization(request(), prepared, progress => {
        context.progress(progress);
        if (progress.percent === 99) cancellation = run.cancel("optimize");
      }, context);
    });
    expect(await cancellation).toEqual({ cancelled: false, completed: true });
    await verifyHwpxOutput(await readFile(result.outputPath));
    expect(JSON.parse(await readFile(result.reportPath!, "utf8")).originalSize).toBe(source.length);
    expect((await readFile(input)).equals(source)).toBe(true);
  }, 15_000);
  it("finishes a main-owned save if the now-idle computation worker terminates during publication", async () => {
    const worker = client(); const run = manager();
    const result = await run.run("optimize", async context => {
      const prepared = await worker.prepare(request(), context.signal, context.progress);
      return saveDesktopOptimization(request(), prepared, context.progress, { ...context, operations: {
        publish: async (stage, target, claims) => { await worker.dispose(); return claims.publish(stage, target); }
      } });
    });
    await verifyHwpxOutput(await readFile(result.outputPath));
    expect(JSON.parse(await readFile(result.reportPath!, "utf8")).originalSize).toBe(source.length);
    expect((await run.run("analyze", ({ signal }) => worker.analyze(input, signal))).report.originalSize).toBe(source.length);
  }, 15_000);
});
