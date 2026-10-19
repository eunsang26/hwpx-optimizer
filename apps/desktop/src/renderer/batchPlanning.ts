import type { OptimizationReport } from "@hwpx-optimizer/core";
import type { AppState, BatchItem } from "./workflowState.js";
import { allocateRemainingAggregateTargetBytes, summarizeAggregateTargetAllocation, type AggregateTargetAllocationSummary } from "../shared/batchTargetAlloc.js";
import { createSubmissionPlan, resolveSubmissionLimitBytes, type SubmissionPlan, type SubmissionLimit } from "../shared/submissionPlan.js";
import { JPEG_QUALITY_FLOOR } from "../shared/qualityPolicy.js";
import { formatBytes } from "../shared/viewModel.js";

/** Pure planning shared by analysis, policy edits, summaries and execution. */
export class BatchPlanner {
  constructor(private readonly state: AppState) {}

  createPlan(item: BatchItem, report: OptimizationReport, allocation: AggregateTargetAllocationSummary, includeQuality = true): SubmissionPlan {
    const jpegQuality = !includeQuality || this.state.preservationPreference === "size" || this.state.preservationPreference === "preserve"
      ? undefined : item.jpegQualityOverride ?? (this.state.qualityMode === "manual" ? this.state.jpegQuality : undefined);
    return createSubmissionPlan(report, {
      submissionLimit: this.submissionLimit(item, allocation),
      preservationPreference: this.state.preservationPreference,
      actionOverrides: this.state.actionSelections,
      ...(jpegQuality !== undefined ? { jpegQuality } : {})
    });
  }

  refresh(item: BatchItem, allocation: AggregateTargetAllocationSummary): void {
    if (!item.report || item.status === "done" || item.status === "failed" || item.status === "cancelled") return;
    const plan = this.createPlan(item, item.report, allocation);
    Object.assign(item, {
      expectedSizeBytes: plan.expectedSizeBytes,
      originalSizeLabel: plan.originalSizeLabel,
      expectedSizeLabel: plan.expectedSizeLabel.replace(/^약 /, ""),
      targetLabel: this.targetLabel(item, allocation),
      targetStatusLabel: plan.verdictLabel,
      qualityLabel: this.qualityLabel(item, plan),
      jpegQualityDisplay: this.qualityDisplay(item, plan),
      qualityEditable: this.state.preservationPreference !== "size" && this.state.preservationPreference !== "preserve" &&
        (this.state.qualityMode === "manual" || item.jpegQualityOverride !== undefined),
      allocatedTargetLabel: this.allocatedTargetLabel(item, allocation)
    });
  }

  submissionLimit(
    item: BatchItem,
    targetAllocation?: AggregateTargetAllocationSummary
  ): SubmissionLimit {
    if (this.state.batchTargetMode === "per-file") return this.state.submissionLimit;
    const targetBytes = this.targetBytes(item, targetAllocation);
    return targetBytes ? { id: "custom", customBytes: targetBytes } : { id: "none" };
  }

  targetBytes(
    item: BatchItem,
    targetAllocation = summarizeAggregateTargetAllocation(this.state.batchItems)
  ): number | undefined {
    const batchTargetBytes = resolveSubmissionLimitBytes(this.state.submissionLimit);
    if (!batchTargetBytes || !item.originalSizeBytes) return undefined;
    if (this.state.batchTargetMode === "per-file") return batchTargetBytes;
    if (!item.selected) return undefined;
    return allocateRemainingAggregateTargetBytes({
      batchTargetBytes,
      completedOutputBytes: targetAllocation.completedOutputBytes,
      itemOriginalBytes: item.originalSizeBytes,
      pendingOriginalTotal: targetAllocation.pendingOriginalTotal
    });
  }

  targetLabel(
    item: BatchItem,
    targetAllocation?: AggregateTargetAllocationSummary
  ): string {
    if (this.state.batchTargetMode === "aggregate" && !item.selected) return "선택 제외";
    const targetBytes = this.targetBytes(item, targetAllocation);
    return targetBytes ? `${formatBytes(targetBytes)} 미만` : "제한 없음";
  }

  allocatedTargetLabel(
    item: BatchItem,
    targetAllocation?: AggregateTargetAllocationSummary
  ): string | undefined {
    if (this.state.batchTargetMode !== "aggregate") return undefined;
    const targetBytes = this.targetBytes(item, targetAllocation);
    return targetBytes ? `배분 목표 ${formatBytes(targetBytes)}` : undefined;
  }

  qualityDisplay(item: BatchItem, plan: SubmissionPlan): number | undefined {
    if (this.state.preservationPreference === "preserve") return undefined;
    if (this.state.preservationPreference === "size") return JPEG_QUALITY_FLOOR;
    if (item.jpegQualityOverride !== undefined) return item.jpegQualityOverride;
    if (this.state.qualityMode === "manual") return this.state.jpegQuality;
    return plan.plannedJpegQuality;
  }

  qualityLabel(item: BatchItem, plan: SubmissionPlan): string {
    const display = this.qualityDisplay(item, plan);
    if (display === undefined) return "-";
    if (this.state.preservationPreference === "size") return `${display}% · 하한`;
    if (item.jpegQualityOverride !== undefined || this.state.qualityMode === "manual") return `${display}%`;
    if (this.state.qualityMode === "auto" && this.state.preservationPreference === "recommended" && plan.verdict === "need-more") {
      return `~${display}%↓`;
    }
    return `${display}%`;
  }
}
