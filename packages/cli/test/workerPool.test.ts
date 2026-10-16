import { describe, expect, it } from "vitest";
import { WorkerPool } from "../src/workerPool.js";

const workerUrl = new URL("./fixtures/echoWorker.mjs", import.meta.url);

describe("WorkerPool", () => {
  it("caps concurrent workers even when a caller requests more than the supported limit", async () => {
    const counts = new SharedArrayBuffer(8);
    const pool = new WorkerPool({ size: 12, workerUrl: new URL("./fixtures/concurrencyWorker.mjs", import.meta.url) });
    try {
      const results = await pool.run(Array.from({ length: 8 }, () => ({ counts })));
      expect(results.every(result => result.status === "ok")).toBe(true);
      expect(new Int32Array(counts)[1]).toBeLessThanOrEqual(4);
      expect(new Int32Array(counts)[0]).toBe(0);
    } finally { await pool.terminate(); }
  }, 10_000);
  it.each([Infinity, NaN, 0, -1, 1.5])("rejects invalid worker count %s", size => {
    expect(() => new WorkerPool({ size, workerUrl })).toThrow(/Invalid worker pool size/);
  });
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
  it("settles and recovers when a worker exits 0 without posting a result (does not deadlock)", async () => {
    const pool = new WorkerPool({ size: 1, workerUrl });
    const out = await pool.run([{ silent: true }, { n: 7 }]);
    await pool.terminate();
    expect(out[0].status).toBe("failed");
    expect(out[1].status === "ok" && out[1].result.doubled).toBe(14);
  }, 10_000);
  it("terminate() stops in-flight workers and prevents further spawns", async () => {
    const pool = new WorkerPool({ size: 1, workerUrl });
    const runPromise = pool.run([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }]);
    await pool.terminate();
    const out = await runPromise;
    expect(out.length).toBe(5);
    // At most the in-flight job could have completed before terminate landed;
    // no error should be thrown and the call must resolve promptly.
  });
  it("treats a mismatched echoed index as a protocol violation, not a silent misattribution", async () => {
    const pool = new WorkerPool({ size: 1, workerUrl });
    const out = await pool.run([{ wrongIndex: true, n: 3 }]);
    await pool.terminate();
    expect(out[0].status).toBe("failed");
  });
});
