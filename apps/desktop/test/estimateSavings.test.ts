import { describe, expect, it } from "vitest";
import { estimateNonOverlappingSavingBytes } from "../src/shared/estimateSavings.js";

describe("estimateNonOverlappingSavingBytes", () => {
  it("adds savings for distinct targets", () => {
    expect(
      estimateNonOverlappingSavingBytes([
        { estimatedSavingBytes: 1_000, targets: ["BinData/a.jpg"] },
        { estimatedSavingBytes: 2_000, targets: ["BinData/b.jpg"] }
      ])
    ).toBe(3_000);
  });

  it("keeps only the largest saving for overlapping targets", () => {
    expect(
      estimateNonOverlappingSavingBytes([
        { estimatedSavingBytes: 1_000, targets: ["BinData/a.jpg"] },
        { estimatedSavingBytes: 2_000, targets: ["BinData/a.jpg"] }
      ])
    ).toBe(2_000);
  });
});
