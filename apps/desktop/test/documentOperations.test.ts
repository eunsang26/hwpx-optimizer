import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtifactSaveError } from "@hwpx-optimizer/io";
import { DocumentOperations } from "../src/main/documentOperations.js";
import { isDocumentCancellation } from "../src/shared/cancellation.js";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
afterEach(() => vi.useRealTimers());

describe("document operation lifecycle", () => {
  it("keeps the busy lock and cancel response pending until cleanup has finished", async () => {
    const operations = new DocumentOperations();
    const started = deferred(); const release = deferred();
    const run = operations.run("analyze", async ({ signal }) => {
      started.resolve(); await release.promise; signal.throwIfAborted(); return "unreachable";
    });
    const rejected = expect(run).rejects.toThrow("Analysis cancelled.");
    await started.promise;
    let acknowledged = false;
    const cancel = operations.cancel("analyze").then(result => { acknowledged = true; return result; });
    expect(operations.busy).toBe(true);
    await expect(operations.run("analyze", async () => "second")).rejects.toThrow(/already running/);
    expect(acknowledged).toBe(false);
    release.resolve(); await rejected;
    expect(await cancel).toEqual({ cancelled: true });
    expect(operations.busy).toBe(false);
    expect(await operations.run("analyze", async () => "next")).toBe("next");
  });
  it("cancels before authorization begins if the request has not started", async () => {
    const operations = new DocumentOperations(); const task = vi.fn(async () => "result");
    const run = operations.run("optimize", task);
    const rejected = expect(run).rejects.toThrow("Optimization cancelled.");
    const cancel = operations.cancel("optimize");
    await rejected; expect(await cancel).toEqual({ cancelled: true }); expect(task).not.toHaveBeenCalled();
  });
  it("rejects queued follow-up work once application shutdown starts", async () => {
    const operations = new DocumentOperations(); const started = deferred(); const release = deferred();
    const run = operations.run("analyze", async () => { started.resolve(); await release.promise; return "read"; });
    const rejected = expect(run).rejects.toThrow("Analysis cancelled.");
    await started.promise; const closed = operations.close();
    await expect(operations.run("analyze", async () => "queued")).rejects.toThrow(/종료하는 중/);
    release.resolve(); await rejected; expect(await closed).toEqual({ cancelled: true });
    await expect(operations.run("analyze", async () => "late")).rejects.toThrow(/종료하는 중/);
  });
  it("ignores cancellation after commit and waits for successful cleanup", async () => {
    vi.useFakeTimers();
    const operations = new DocumentOperations(50); const started = deferred(); const cleanup = deferred();
    let signal!: AbortSignal;
    const run = operations.run("optimize", async (context) => {
      signal = context.signal; context.commitState.committed = true; started.resolve(); await cleanup.promise; return "saved";
    });
    await started.promise;
    const cancel = operations.cancel("optimize");
    await vi.advanceTimersByTimeAsync(1000);
    expect(signal.aborted).toBe(false); expect(operations.busy).toBe(true);
    cleanup.resolve(); expect(await run).toBe("saved"); expect(await cancel).toEqual({ cancelled: false, completed: true });
  });
  it("uses inactivity rather than total elapsed time for a healthy long operation", async () => {
    vi.useFakeTimers();
    const operations = new DocumentOperations(50); const done = deferred<string>();
    let progress!: (item: { percent: number; item: string }) => void;
    let signal!: AbortSignal;
    const run = operations.run("analyze", context => { progress = context.progress; signal = context.signal; return done.promise; });
    await Promise.resolve();
    for (let index = 0; index < 5; index += 1) {
      await vi.advanceTimersByTimeAsync(40); progress({ percent: index * 10, item: `resource ${index}` });
    }
    expect(signal.aborted).toBe(false); done.resolve("complete"); expect(await run).toBe("complete");
  });
  it("keeps timeout reason and last stage distinct from a user cancellation", async () => {
    vi.useFakeTimers();
    const operations = new DocumentOperations(50);
    const run = operations.run("optimize", ({ signal, progress }) => {
      progress({ percent: 95, item: "Writing optimized document" });
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => {
        const error = new Error("The operation was aborted", { cause: signal.reason }); error.name = "AbortError"; reject(error);
      }));
    });
    const rejected = expect(run).rejects.toThrow(/진행 응답.*저장/);
    await vi.advanceTimersByTimeAsync(60); await rejected;
    expect(operations.busy).toBe(false);
    expect(isDocumentCancellation(await run.catch(error => error))).toBe(false);
  });
  it("never hides failed rollback behind a cancellation label", async () => {
    const operations = new DocumentOperations(); const started = deferred(); const release = deferred();
    const run = operations.run("optimize", async () => {
      started.resolve(); await release.promise;
      throw new ArtifactSaveError("output.hwpx", new DOMException("cancel", "AbortError"), ["recovery"], ["replacement preserved"]);
    });
    const rejected = expect(run).rejects.toThrow(/Rollback incomplete/);
    await started.promise; const cancel = operations.cancel("optimize"); release.resolve(); await rejected;
    expect(await cancel).toMatchObject({ cancelled: false, error: expect.stringContaining("recovery") });
  });
  it("does not classify a queue stop or an interrupted save with recovery errors as cancellation", () => {
    expect(isDocumentCancellation(new Error("Error invoking remote method: Optimization cancelled."))).toBe(true);
    expect(isDocumentCancellation(new Error("Error invoking remote method 'hwpx:optimize': Error: Optimization cancelled."))).toBe(true);
    expect(isDocumentCancellation("분석이 취소되었습니다.")).toBe(true);
    expect(isDocumentCancellation(new Error("timeout"))).toBe(false);
    expect(isDocumentCancellation(new Error("Optimization cancelled. Rollback incomplete."))).toBe(false);
  });
});
