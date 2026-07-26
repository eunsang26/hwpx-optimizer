import { describe, expect, it } from "vitest";
import {
  allocateAggregateTargetBytes,
  allocateRemainingAggregateTargetBytes
} from "../src/shared/batchTargetAlloc.js";

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

  it("allocates only the aggregate budget left after completed outputs", () => {
    const allocated = allocateRemainingAggregateTargetBytes({
      batchTargetBytes: 40 * 1024 * 1024,
      completedOutputBytes: 39 * 1024 * 1024,
      itemOriginalBytes: 10 * 1024 * 1024,
      pendingOriginalTotal: 10 * 1024 * 1024
    });

    expect(allocated).toBe(1 * 1024 * 1024);
  });

  it("keeps a minimum target when completed outputs already exceed the aggregate budget", () => {
    expect(
      allocateRemainingAggregateTargetBytes({
        batchTargetBytes: 40 * 1024 * 1024,
        completedOutputBytes: 41 * 1024 * 1024,
        itemOriginalBytes: 10 * 1024 * 1024,
        pendingOriginalTotal: 10 * 1024 * 1024
      })
    ).toBe(1);
  });
});
