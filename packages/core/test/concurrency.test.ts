import { describe, expect, it } from "vitest";
import { mapLimit } from "../src/concurrency.js";

function defer<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("mapLimit", () => {
  it("returns results in input order regardless of completion order", async () => {
    const results = await mapLimit([10, 5, 1], 3, async (value) => {
      await new Promise((resolve) => setTimeout(resolve, value));
      return value * 2;
    });
    expect(results).toEqual([20, 10, 2]);
  });

  it("never runs more than `limit` mappers concurrently", async () => {
    let inflight = 0;
    let peak = 0;
    await mapLimit(Array.from({ length: 8 }, (_unused, index) => index), 3, async () => {
      inflight += 1;
      peak = Math.max(peak, inflight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inflight -= 1;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("stops scheduling new work after the first mapper failure", async () => {
    let started = 0;
    await expect(
      mapLimit([0, 1, 2, 3, 4, 5, 6, 7], 2, async (value) => {
        started += 1;
        if (value === 1) throw new Error("boom");
        await new Promise((resolve) => setTimeout(resolve, 5));
        return value;
      })
    ).rejects.toThrow("boom");
    // 2 workers were running, so at most one extra item starts before the
    // failure short-circuit kicks in. The remaining 5 items must not start.
    expect(started).toBeLessThanOrEqual(3);
  });

  it("aborts in-flight scheduling when the provided signal aborts", async () => {
    const controller = new AbortController();
    const gate = defer<void>();
    let started = 0;

    const work = mapLimit(
      Array.from({ length: 6 }, (_unused, index) => index),
      2,
      async () => {
        started += 1;
        await gate.promise;
        return 1;
      },
      { signal: controller.signal }
    );

    await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();
    gate.resolve();

    await expect(work).rejects.toBeDefined();
    // Only the initial worker batch (=limit) should have started.
    expect(started).toBeLessThanOrEqual(2);
  });
});
