import { allocateTargetShareBytes } from "./corePlanning.js";

export function allocateAggregateTargetBytes(input: {
  batchTargetBytes: number; itemOriginalBytes: number; selectedOriginalTotal: number;
}): number | undefined {
  return allocateTargetShareBytes({ targetBytes: input.batchTargetBytes,
    itemBytes: input.itemOriginalBytes, totalBytes: input.selectedOriginalTotal });
}

export function allocateRemainingAggregateTargetBytes(input: {
  batchTargetBytes: number; completedOutputBytes: number; itemOriginalBytes: number; pendingOriginalTotal: number;
}): number | undefined {
  return allocateTargetShareBytes({ targetBytes: input.batchTargetBytes,
    itemBytes: input.itemOriginalBytes, totalBytes: input.pendingOriginalTotal, consumedBytes: input.completedOutputBytes });
}

export type AggregateTargetAllocationItem = {
  selected: boolean;
  status: "pending" | "running" | "done" | "failed" | "cancelled";
  originalSizeBytes?: number;
  expectedSizeBytes?: number;
  report?: { optimizedSize?: number };
};

export type AggregateTargetAllocationSummary = {
  completedOutputBytes: number;
  pendingOriginalTotal: number;
};

/** Collect aggregate allocation inputs once so a full row refresh stays O(n). */
export function summarizeAggregateTargetAllocation(
  items: Iterable<AggregateTargetAllocationItem>
): AggregateTargetAllocationSummary {
  let completedOutputBytes = 0;
  let pendingOriginalTotal = 0;
  for (const item of items) {
    if (!item.selected) continue;
    if (item.status === "done") {
      completedOutputBytes += item.report?.optimizedSize ?? item.originalSizeBytes ?? 0;
      continue;
    }
    if (item.status === "failed" || item.status === "cancelled") {
      completedOutputBytes += item.originalSizeBytes ?? 0;
      continue;
    }
    if (
      (item.status === "pending" || item.status === "running") &&
      item.originalSizeBytes
    ) {
      pendingOriginalTotal += item.originalSizeBytes;
    }
  }
  return { completedOutputBytes, pendingOriginalTotal };
}
