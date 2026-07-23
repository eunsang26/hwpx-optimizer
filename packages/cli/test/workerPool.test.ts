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
