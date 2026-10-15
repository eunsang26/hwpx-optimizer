import { describe, expect, it } from "vitest";
import type { OptimizationReport } from "@hwpx-optimizer/core";
import { RendererWorkflow } from "../src/renderer/workflowState.js";
import { BatchPlanner } from "../src/renderer/batchPlanning.js";
import { summarizeAggregateTargetAllocation } from "../src/shared/batchTargetAlloc.js";

const analysis: OptimizationReport = {
  kind: "analysis", originalSize: 1000, estimatedSize: 900,
  categorySizes: { xml: 1000, image: 0, font: 0, ole: 0, bindata: 0, other: 0 },
  images: [], duplicateImages: [], sameVisualDuplicateImages: [], nearDuplicateImages: [],
  unusedBinData: [], riskyResources: [], resourceDiagnostics: [], warnings: [],
  actions: { planned: [], applied: [], skipped: [] }, opportunities: [], opportunityGroups: []
};
const completed: OptimizationReport = { ...analysis, kind: "optimization", estimatedSize: undefined,
  optimizedSize: 800, savedBytes: 200, savedPercent: 20 };

describe("renderer document transitions without a DOM", () => {
  it("rejects a cancelled analysis result and its finalizer while a retry is running", () => {
    const flow = new RendererWorkflow();
    flow.selectSingle("/first.hwpx");
    const first = flow.beginAnalysis("/first.hwpx");
    flow.acceptAnalysis(first, analysis, "quick");
    flow.finishAnalysis(first);
    const cancelled = flow.beginAnalysis("/first.hwpx");
    flow.cancelAnalysis(); flow.finishCancelledAnalysis();
    const retry = flow.beginAnalysis("/first.hwpx");
    expect(flow.acceptAnalysis(cancelled, { ...analysis, originalSize: 9999 }, "deep")).toBe(false);
    expect(flow.finishAnalysis(cancelled)).toBe(false);
    expect(flow.state.analysisRunning).toBe(true);
    expect(flow.state.report).toBe(analysis);
    expect(flow.acceptAnalysis(retry, analysis, "deep")).toBe(true);
    expect(flow.finishAnalysis(retry)).toBe(true);
    expect(flow.busy).toBe(false);
  });

  it("preserves session policy across selection, deduplication, removal, promotion and reset", () => {
    const flow = new RendererWorkflow();
    flow.state.submissionLimit = { id: "custom", customBytes: 12345 };
    flow.state.preservationPreference = "size";
    flow.state.actionSelections.set("strip-metadata", false);
    flow.appendBatch(["/a.hwpx", "/b.hwpx", "/a.hwpx"], true);
    flow.appendBatch(["/b.hwpx", "/c.hwpx"], true);
    expect(flow.state.batchItems.map(item => item.path)).toEqual(["/a.hwpx", "/b.hwpx", "/c.hwpx"]);
    flow.beginBatchAnalysis();
    expect(flow.selectSingle("/other.hwpx")).toBe(false);
    expect(flow.removeBatchItem(1)).toBe(false);
    flow.finishBatchAnalysis();
    flow.removeBatchItem(2); flow.removeBatchItem(1);
    flow.promote(flow.state.batchItems[0]);
    expect(flow.state.view).toBe("single");
    expect(flow.state.filePath).toBe("/a.hwpx");
    flow.clearSelection();
    expect(flow.state.view).toBe("empty");
    expect(flow.state.batchItems).toEqual([]);
    expect(flow.state.submissionLimit).toEqual({ id: "custom", customBytes: 12345 });
    expect(flow.state.preservationPreference).toBe("size");
    expect(flow.state.actionSelections.size).toBe(0);
  });

  it("restores analysis reports on retry after mixed batch outcomes without carrying actual bytes", () => {
    const flow = new RendererWorkflow();
    flow.appendBatch(["/a.hwpx", "/b.hwpx"]);
    const [first, second] = flow.state.batchItems;
    flow.recordBatchAnalysis(first, analysis); flow.recordBatchAnalysis(second, analysis);
    flow.beginBatch(); flow.beginBatchItem(first);
    flow.completeBatchItem(first, { report: completed, outputPath: "/out/a.hwpx", reportPath: "/out/a.json" });
    flow.failBatchItem(second, "report save failed");
    flow.finishBatch(); flow.setBatchReport("/out/batch.json");
    expect(first.actualSizeBytes).toBe(800);
    expect(flow.retryBatch()).toBe(2);
    expect(flow.state.batchReportPath).toBeUndefined();
    expect(flow.state.batchRunCompleted).toBe(false);
    expect(first.report).toBe(analysis);
    expect(first.actualSizeBytes).toBeUndefined();
    expect(first.outputPath).toBeUndefined();
    expect(second.error).toBeUndefined();
    expect(flow.state.batchItems.every(item => item.status === "pending")).toBe(true);
  });

  it("does not attach an old optimization outcome to a new selection", () => {
    const flow = new RendererWorkflow();
    flow.selectSingle("/a.hwpx");
    const token = flow.beginAnalysis("/a.hwpx");
    flow.acceptAnalysis(token, analysis, "quick"); flow.finishAnalysis(token);
    const path = flow.beginOptimization()!;
    flow.finishOptimization(path); flow.clearSelection();
    flow.selectSingle("/b.hwpx");
    expect(flow.acceptOptimization(path, { outputPath: "/out/a.hwpx", report: completed })).toBe(false);
    expect(flow.state.result).toBeUndefined();
    expect(flow.state.filePath).toBe("/b.hwpx");
  });
});

describe("one batch planning policy across analysis and refresh", () => {
  it("allocates only the remaining aggregate budget and excludes unchecked files", () => {
    const flow = new RendererWorkflow();
    flow.state.batchTargetMode = "aggregate";
    flow.state.submissionLimit = { id: "custom", customBytes: 1000 };
    flow.appendBatch(["/done.hwpx", "/pending.hwpx", "/excluded.hwpx"]);
    const [done, pending, excluded] = flow.state.batchItems;
    for (const item of flow.state.batchItems) flow.recordBatchAnalysis(item, analysis);
    flow.completeBatchItem(done, { report: { ...completed, optimizedSize: 300 }, outputPath: "/out.hwpx" });
    excluded.selected = false;
    const planner = new BatchPlanner(flow.state);
    const totals = summarizeAggregateTargetAllocation(flow.state.batchItems);
    expect(planner.targetBytes(pending, totals)).toBe(700);
    expect(planner.submissionLimit(pending, totals)).toEqual({ id: "custom", customBytes: 700 });
    expect(planner.targetBytes(excluded, totals)).toBeUndefined();
    expect(planner.targetLabel(excluded, totals)).toBe("선택 제외");
    planner.refresh(done, totals);
    expect(done.actualSizeBytes).toBe(300);
    expect(done.report?.optimizedSize).toBe(300);
  });

  it.each([
    ["preserve", undefined, false], ["size", 60, false], ["recommended", 91, true]
  ] as const)("keeps row quality consistent for %s despite a saved per-file override", (preference, expected, editable) => {
    const flow = new RendererWorkflow();
    flow.state.preservationPreference = preference;
    flow.state.qualityMode = "manual"; flow.state.jpegQuality = 77;
    flow.appendBatch(["/a.hwpx"]);
    const item = flow.state.batchItems[0];
    flow.recordBatchAnalysis(item, analysis); item.jpegQualityOverride = 91;
    const planner = new BatchPlanner(flow.state);
    planner.refresh(item, summarizeAggregateTargetAllocation(flow.state.batchItems));
    expect(item.jpegQualityDisplay).toBe(expected);
    expect(item.qualityEditable).toBe(editable);
    const firstEstimate = item.expectedSizeBytes;
    planner.refresh(item, summarizeAggregateTargetAllocation(flow.state.batchItems));
    expect(item.expectedSizeBytes).toBe(firstEstimate);
  });
});
