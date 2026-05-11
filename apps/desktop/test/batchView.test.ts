import { describe, expect, it } from "vitest";
import {
  applyOptimizationResultToBatchItem,
  batchItemMetaText,
  selectionModeForPaths,
  summarizeBatchItems
} from "../src/shared/batchView.js";
import type { BatchItemLike } from "../src/shared/batchView.js";
import type { OptimizationReport } from "@hwpx-optimizer/core";

describe("batchView helpers", () => {
  it("summarizes analyzed pending files with expected output", () => {
    const summary = summarizeBatchItems([
      {
        path: "/a.hwpx",
        fileName: "a.hwpx",
        status: "pending",
        originalSizeBytes: 28 * 1024 * 1024,
        expectedSizeBytes: 16 * 1024 * 1024,
        originalSizeLabel: "28.00 MiB",
        expectedSizeLabel: "16.00 MiB"
      },
      {
        path: "/b.hwpx",
        fileName: "b.hwpx",
        status: "pending",
        originalSizeBytes: 54 * 1024 * 1024,
        expectedSizeBytes: 19 * 1024 * 1024,
        originalSizeLabel: "54.00 MiB",
        expectedSizeLabel: "19.00 MiB"
      }
    ]);

    expect(summary.text).toBe("선택: 2개 파일 · 총 원본 용량: 82.00 MiB");
  });

  it("routes one selected path to single mode and multiple selected paths to batch mode", () => {
    expect(selectionModeForPaths([])).toBe("empty");
    expect(selectionModeForPaths(["/x/a.hwpx"])).toBe("single");
    expect(selectionModeForPaths(["/x/a.hwpx", "/x/b.hwpx"])).toBe("batch");
  });

  it("renders target status in pending row meta", () => {
    expect(
      batchItemMetaText({
        path: "/report.hwpx",
        fileName: "report.hwpx",
        status: "pending",
        originalSizeLabel: "61.80 MiB",
        expectedSizeLabel: "27.40 MiB",
        targetStatusLabel: "목표 미달 가능"
      })
    ).toBe("61.80 MiB → 27.40 MiB · 목표 미달 가능");
  });

  it("returns a placeholder summary when the queue is empty", () => {
    const summary = summarizeBatchItems([]);
    expect(summary.totalCount).toBe(0);
    expect(summary.text).toContain("파일을 추가하면");
  });

  it("counts statuses, hides 대기 while running, and adds total saving when relevant", () => {
    const items: BatchItemLike[] = [
      { path: "a.hwpx", fileName: "a.hwpx", status: "done", savedBytes: 1024 * 1024 * 2, savedPercent: 25 },
      { path: "b.hwpx", fileName: "b.hwpx", status: "failed", error: "boom" },
      { path: "c.hwpx", fileName: "c.hwpx", status: "pending" }
    ];
    const idle = summarizeBatchItems(items, { running: false });
    expect(idle.counts).toMatchObject({ done: 1, failed: 1, pending: 1, running: 0, cancelled: 0 });
    expect(idle.text).toContain("3개 파일");
    expect(idle.text).toContain("완료 1");
    expect(idle.text).toContain("실패 1");
    expect(idle.text).toContain("대기 1");
    expect(idle.text).toContain("총 절감 2.00 MiB");

    const busy = summarizeBatchItems(items, { running: true });
    expect(busy.text).not.toContain("대기 1");
  });

  it("describes each item according to its terminal status", () => {
    expect(
      batchItemMetaText({
        path: "/x/a.hwpx",
        fileName: "a.hwpx",
        status: "done",
        savedBytes: 1024,
        savedPercent: 1.5
      })
    ).toBe("절감 1.0 KiB (1.50%)");
    expect(
      batchItemMetaText({ path: "/x/b.hwpx", fileName: "b.hwpx", status: "failed", error: "broken" })
    ).toBe("broken");
    expect(
      batchItemMetaText({ path: "/x/c.hwpx", fileName: "c.hwpx", status: "cancelled" })
    ).toBe("취소됨");
    expect(
      batchItemMetaText({ path: "/x/d.hwpx", fileName: "d.hwpx", status: "pending" })
    ).toBe("/x/d.hwpx");
  });

  it("merges optimize response fields into the batch item", () => {
    const item: BatchItemLike = { path: "/x/a.hwpx", fileName: "a.hwpx", status: "running" };
    const updated = applyOptimizationResultToBatchItem(item, {
      outputPath: "/x/a.optimized.hwpx",
      reportPath: "/x/a.optimized.hwpx.report.json",
      report: { savedBytes: 4096, savedPercent: 12.5 } as OptimizationReport
    });
    expect(updated).toMatchObject({
      status: "done",
      outputPath: "/x/a.optimized.hwpx",
      reportPath: "/x/a.optimized.hwpx.report.json",
      savedBytes: 4096,
      savedPercent: 12.5
    });
    expect(item.status).toBe("running");
  });
});
