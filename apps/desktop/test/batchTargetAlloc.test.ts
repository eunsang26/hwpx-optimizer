import { describe, expect, it } from "vitest";
import { allocateAggregateTargetBytes } from "../src/shared/batchTargetAlloc.js";

describe("allocateAggregateTargetBytes", () => {
  it("allocates proportional budgets from selected totals only", () => {
    const a = allocateAggregateTargetBytes({
      batchTargetBytes: 40 * 1024 * 1024,
      itemOriginalBytes: 30 * 1024 * 1024,
      selectedOriginalTotal: 50 * 1024 * 1024
    });
    const b = allocateAggregateTargetBytes({
      batchTargetBytes: 40 * 1024 * 1024,
      itemOriginalBytes: 20 * 1024 * 1024,
      selectedOriginalTotal: 50 * 1024 * 1024
    });
    expect(a).toBe(Math.floor((40 * 1024 * 1024 * 30) / 50));
    expect(b).toBe(Math.floor((40 * 1024 * 1024 * 20) / 50));
    expect((a ?? 0) + (b ?? 0)).toBeLessThanOrEqual(40 * 1024 * 1024);
  });

  it("returns undefined when selected total is empty", () => {
    expect(
      allocateAggregateTargetBytes({
        batchTargetBytes: 40 * 1024 * 1024,
        itemOriginalBytes: 10 * 1024 * 1024,
        selectedOriginalTotal: 0
      })
    ).toBeUndefined();
  });
});
