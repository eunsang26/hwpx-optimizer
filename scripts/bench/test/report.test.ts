import { describe, expect, it } from "vitest";
import {
  aggregateDocumentStats,
  buildBenchReport,
  buildSoftFlags,
  decideJpegliGo,
  median,
  stderrVerdict,
  type DocumentMeasurement
} from "../src/report.js";
import type { BenchCorpus } from "../src/corpus.js";
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

function measured(name: string, source: "real" | "fixture" = "real"): DocumentMeasurement {
  return {
    relativePath: name, source, status: "ok", issues: [],
    stats: { packageSavingsPercent: 20, jpegTotal: 10, jpegExcluded: 0, growCount: 0,
      encodeCpuRatios: [1.5], wallClockDeltaPercent: -5, axisBPasses: 10, axisBTotal: 10,
      pngControlBytes: 123 }
  };
}

function reportFor(documents: DocumentMeasurement[], options: Partial<BenchCorpus> = {}) {
  return buildBenchReport({ profile: "balanced", corpus: {
    manifestId: "test", goEligible: true,
    docs: documents.map((doc) => ({ absPath: "/unused", relativePath: doc.relativePath, source: doc.source })),
    ...options
  }, documents });
}

describe("complete corpus verdicts", () => {
  it("cannot approve only the profitable survivors of a failed corpus", () => {
    const bad: DocumentMeasurement = { relativePath: "broken.hwpx", source: "real", status: "error",
      reason: "document-processing-failed", stats: null,
      issues: [{ stage: "package", reason: "processing-error", message: "Invalid ZIP" }] };
    const report = reportFor([measured("good.hwpx"), bad]);
    expect(report.jpegli.medianPackageSavingsPercent).toBe(20);
    expect(report).toMatchObject({ go: false, goReason: "document-processing-failed",
      statistics: { documentCount: 2, failedDocumentCount: 1, medianDocumentCount: 1 } });
    expect(stderrVerdict(report)).toBe("NO-GO");
    expect(report.documents[1]).toMatchObject({ ...bad, inDecisionScope: true,
      includedInStatistics: false, medianExclusionReason: "document-processing-failed" });
  });

  it("uses real documents consistently for JPEG, PNG, CPU, growth and Axis B", () => {
    const fixture = measured("same.hwpx", "fixture");
    fixture.stats = { ...fixture.stats!, packageSavingsPercent: -100, jpegTotal: 100,
      jpegExcluded: 99, pngControlBytes: 999999, growCount: 50, encodeCpuRatios: [999],
      wallClockDeltaPercent: 999, axisBPasses: 0, axisBTotal: 100 };
    const failedFixture: DocumentMeasurement = { ...fixture, relativePath: "bad-fixture.hwpx",
      stats: null, status: "error", reason: "document-processing-failed" };
    const report = reportFor([measured("same.hwpx"), fixture, failedFixture]);
    expect(report).toMatchObject({ go: true, goReason: "median-meets-threshold",
      corpus: { documentCount: 1, realDocumentCount: 1, fixtureDocumentCount: 2 },
      statistics: { source: "real", failedDocumentCount: 0, medianDocumentCount: 1 },
      pngRows: { controlBytesTotal: 123 }, softFlags: [],
      jpegli: { perDocumentPackageSavingsPercent: [20], jpegTotal: 10, jpegExcluded: 0,
        jpegExclusionRatio: 0, growCount: 0, encodeCpuRatioMedian: 1.5,
        wallClockDeltaPercentMedian: -5, axisBPassRate: 1 } });
    expect(report.documents.slice(1).every((doc) => !doc.inDecisionScope &&
      !doc.includedInStatistics && doc.medianExclusionReason === "fixture-diagnostic")).toBe(true);
  });

  it("includes fixture statistics in a synthetic-only run without laundering GO", () => {
    const report = reportFor([measured("fixture.hwpx", "fixture")], { goEligible: false,
      invalidReason: "synthetic-only" });
    expect(report).toMatchObject({ go: false, goReason: "synthetic-only",
      corpus: { documentCount: 1, realDocumentCount: 0, fixtureDocumentCount: 1 },
      statistics: { source: "fixture", medianDocumentCount: 1 }, pngRows: { controlBytesTotal: 123 } });
    expect(stderrVerdict(report)).toBe("INVALID");
    expect(reportFor([measured("fixture.hwpx", "fixture")]).go).toBe(false);
  });

  it("allows disclosed partial iso-quality exclusions through the exact 20% boundary", () => {
    const partial = measured("partial.hwpx");
    partial.status = "partial";
    partial.stats!.jpegExcluded = 2;
    partial.issues = [{ stage: "iso-quality", imagePath: "BinData/x.jpg", reason: "curve-miss" }];
    expect(reportFor([partial])).toMatchObject({ go: true,
      statistics: { partialDocumentCount: 1 }, jpegli: { jpegExclusionRatio: 0.2 } });
    partial.stats!.jpegExcluded = 3;
    expect(reportFor([partial])).toMatchObject({ go: false, goReason: "jpeg-exclusion-too-high" });
  });

  it("blocks a JPEG document with no matched images even below the aggregate exclusion limit", () => {
    const empty = measured("no-match.hwpx");
    empty.status = "no-data";
    empty.reason = "no-valid-jpegs";
    empty.stats = { ...empty.stats!, packageSavingsPercent: null, jpegTotal: 1, jpegExcluded: 1,
      encodeCpuRatios: [], axisBTotal: 0, axisBPasses: 0 };
    const report = reportFor([measured("good.hwpx"), empty]);
    expect(report.jpegli.jpegExclusionRatio).toBeLessThan(0.2);
    expect(report).toMatchObject({ go: false, goReason: "document-no-valid-jpegs" });
    expect(report.documents[1]?.medianExclusionReason).toBe("no-valid-jpegs");
  });

  it("discloses JPEG-free documents without inventing a savings or wall-clock sample", () => {
    const noJpeg = measured("text-and-png.hwpx");
    noJpeg.status = "no-data";
    noJpeg.reason = "no-jpeg-images";
    noJpeg.stats = { ...noJpeg.stats!, packageSavingsPercent: null, jpegTotal: 0,
      encodeCpuRatios: [], wallClockDeltaPercent: 0, axisBPasses: 0, axisBTotal: 0 };
    const report = reportFor([measured("photo.hwpx"), noJpeg]);
    expect(report).toMatchObject({ go: true, pngRows: { controlBytesTotal: 246 },
      jpegli: { medianPackageSavingsPercent: 20, wallClockDeltaPercentMedian: -5 },
      statistics: { noDataDocumentCount: 1, medianDocumentCount: 1 } });
    expect(report.documents[1]?.medianExclusionReason).toBe("no-jpeg-images");
    expect(reportFor([noJpeg])).toMatchObject({ go: false, goReason: "no-valid-documents" });
  });

  it("fails closed for missing outcomes, skipped documents and non-finite savings", () => {
    const good = measured("good.hwpx");
    const corpus: BenchCorpus = { manifestId: "x", goEligible: true, docs: [good, measured("lost.hwpx")]
      .map((doc) => ({ ...doc, absPath: "/unused" })) };
    const report = buildBenchReport({ profile: "balanced", corpus, documents: [good] });
    expect(report).toMatchObject({ go: false, goReason: "document-processing-failed" });
    expect(report.documents[1]?.reason).toBe("missing-document-result");
    expect(reportFor([good, { ...measured("skipped.hwpx"), status: "skipped", stats: null }]).go).toBe(false);
    const invalid = measured("invalid.hwpx");
    invalid.stats!.packageSavingsPercent = Number.NaN;
    const invalidReport = reportFor([good, invalid]);
    expect(invalidReport.go).toBe(false);
    expect(invalidReport.documents[1]?.medianExclusionReason).toBe("non-finite-savings");
  });
});
