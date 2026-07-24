import { describe, expect, it } from "vitest";
import {
  aggregateDocumentStats,
  buildSoftFlags,
  decideJpegliGo,
  median,
  stderrVerdict
} from "../src/report.js";
import { ENCODE_CPU_SOFT_FLAG_RATIO } from "../src/types.js";

describe("report aggregation", () => {
  it("computes median", () => {
    expect(median([10, 20, 30])).toBe(20);
    expect(median([])).toBeNull();
    expect(median([5, 15])).toBe(10);
  });

  it("decideJpegliGo passes eligible corpus above threshold", () => {
    expect(decideJpegliGo({ goEligible: true, exclusion: 0.1, median: 16 }).go).toBe(true);
  });

  it("decideJpegliGo fails ineligible corpus", () => {
    expect(decideJpegliGo({ goEligible: false, exclusion: 0, median: 50 }).go).toBe(false);
  });

  it("decideJpegliGo fails high exclusion ratio", () => {
    expect(decideJpegliGo({ goEligible: true, exclusion: 0.25, median: 20 }).go).toBe(false);
  });

  it("aggregateDocumentStats computes medians and exclusion ratio", () => {
    const stats = aggregateDocumentStats([
      {
        packageSavingsPercent: 10,
        jpegTotal: 2,
        jpegExcluded: 0,
        growCount: 0,
        encodeCpuRatios: [1.5, 2.5],
        wallClockDeltaPercent: -5,
        axisBPasses: 2,
        axisBTotal: 2
      },
      {
        packageSavingsPercent: 20,
        jpegTotal: 1,
        jpegExcluded: 1,
        growCount: 1,
        encodeCpuRatios: [3],
        wallClockDeltaPercent: -10,
        axisBPasses: 1,
        axisBTotal: 2
      }
    ]);
    expect(stats.medianPackageSavingsPercent).toBe(15);
    expect(stats.jpegExclusionRatio).toBeCloseTo(1 / 3);
    expect(stats.encodeCpuRatioMedian).toBe(2.5);
  });

  it("buildSoftFlags adds encode cpu and axis B flags", () => {
    const flags = buildSoftFlags({
      encodeCpuRatioMedian: ENCODE_CPU_SOFT_FLAG_RATIO + 0.1,
      axisBPassRate: 0.5,
      growCount: 2,
      okImageCount: 4
    });
    expect(flags).toContain(`encode-cpu>${ENCODE_CPU_SOFT_FLAG_RATIO}x`);
    expect(flags).toContain("axis-B-failures");
    expect(flags).toContain("recompress-grow-heavy");
  });

  it("stderrVerdict returns INVALID for ineligible corpus", () => {
    expect(
      stderrVerdict({
        corpus: { manifestId: "x", goEligible: false, documentCount: 1, invalidReason: "synthetic-only" },
        go: false,
        goReason: "synthetic-only"
      } as never)
    ).toBe("INVALID");
  });
});
