/** Proportional target share for one file under aggregate batch mode. */
export function allocateAggregateTargetBytes(input: {
  batchTargetBytes: number;
  itemOriginalBytes: number;
  selectedOriginalTotal: number;
}): number | undefined {
  if (input.batchTargetBytes <= 0 || input.itemOriginalBytes <= 0 || input.selectedOriginalTotal <= 0) {
    return undefined;
  }
  return Math.max(1, Math.floor((input.batchTargetBytes * input.itemOriginalBytes) / input.selectedOriginalTotal));
}

/** Proportional target share after outputs from an earlier batch pass have consumed part of the aggregate budget. */
export function allocateRemainingAggregateTargetBytes(input: {
  batchTargetBytes: number;
  completedOutputBytes: number;
  itemOriginalBytes: number;
  pendingOriginalTotal: number;
}): number | undefined {
  if (input.batchTargetBytes <= 0) return undefined;
  const remainingTargetBytes = Math.max(
    1,
    Math.floor(input.batchTargetBytes - Math.max(0, input.completedOutputBytes))
  );
  return allocateAggregateTargetBytes({
    batchTargetBytes: remainingTargetBytes,
    itemOriginalBytes: input.itemOriginalBytes,
    selectedOriginalTotal: input.pendingOriginalTotal
  });
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
      completedOutputBytes += item.report?.optimizedSize ?? item.expectedSizeBytes ?? 0;
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
