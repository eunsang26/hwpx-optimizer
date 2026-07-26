import {
  ENCODE_CPU_SOFT_FLAG_RATIO,
  GO_METRIC_ID,
  MAX_JPEG_EXCLUSION_RATIO,
  PACKAGE_SAVINGS_GO_PERCENT,
  SSIMULACRA2_MATCH_TOLERANCE
} from "./types.js";
import type { BenchProfileName } from "./types.js";

export type BenchReport = {
  metricId: typeof GO_METRIC_ID;
  metricTolerance: number;
  axes: {
    primary: "A-resized-raw-ssimulacra2";
    secondary: "B-original-bindata-verifier-metrics";
    diagnostic: "C-mozjpeg-similarity";
  };
  corpus: {
    manifestId: string;
    goEligible: boolean;
    invalidReason?: string;
    documentCount: number;
  };
  profile: BenchProfileName;
  jpegli: {
    perDocumentPackageSavingsPercent: number[];
    medianPackageSavingsPercent: number | null;
    jpegExclusionRatio: number;
    growCount: number;
    encodeCpuRatioMedian: number | null;
    wallClockDeltaPercentMedian: number | null;
    axisBPassRate: number | null;
  };
  pngRows: {
    controlBytesTotal: number;
    webpEnabled: boolean;
    webpBytesTotal: number | null;
  };
  softFlags: string[];
  go: boolean;
  goReason: string;
};

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

export function decideJpegliGo(input: {
  goEligible: boolean;
  exclusion: number;
  median: number | null;
}): { go: boolean; goReason: string } {
  if (!input.goEligible) {
    return { go: false, goReason: "corpus-ineligible" };
  }
  if (input.exclusion > MAX_JPEG_EXCLUSION_RATIO) {
    return { go: false, goReason: "jpeg-exclusion-too-high" };
  }
  if (input.median === null) {
    return { go: false, goReason: "no-valid-documents" };
  }
  if (input.median < PACKAGE_SAVINGS_GO_PERCENT) {
    return { go: false, goReason: "median-below-threshold" };
  }
  return { go: true, goReason: "median-meets-threshold" };
}

export type DocumentJpegStats = {
  packageSavingsPercent: number | null;
  jpegTotal: number;
  jpegExcluded: number;
  growCount: number;
  encodeCpuRatios: number[];
  wallClockDeltaPercent: number;
  axisBPasses: number;
  axisBTotal: number;
};

export function aggregateDocumentStats(docs: DocumentJpegStats[]): {
  perDocumentPackageSavingsPercent: number[];
  medianPackageSavingsPercent: number | null;
  jpegExclusionRatio: number;
  growCount: number;
  encodeCpuRatioMedian: number | null;
  wallClockDeltaPercentMedian: number | null;
  axisBPassRate: number | null;
} {
  const savings = docs
    .map((doc) => doc.packageSavingsPercent)
    .filter((value): value is number => value !== null);

  const jpegTotal = docs.reduce((sum, doc) => sum + doc.jpegTotal, 0);
  const jpegExcluded = docs.reduce((sum, doc) => sum + doc.jpegExcluded, 0);
  const growCount = docs.reduce((sum, doc) => sum + doc.growCount, 0);

  const encodeCpuRatios = docs.flatMap((doc) => doc.encodeCpuRatios);
  const wallClockDeltas = docs.map((doc) => doc.wallClockDeltaPercent);
  const axisBPasses = docs.reduce((sum, doc) => sum + doc.axisBPasses, 0);
  const axisBTotal = docs.reduce((sum, doc) => sum + doc.axisBTotal, 0);

  return {
    perDocumentPackageSavingsPercent: savings,
    medianPackageSavingsPercent: median(savings),
    jpegExclusionRatio: jpegTotal === 0 ? 1 : jpegExcluded / jpegTotal,
    growCount,
    encodeCpuRatioMedian: median(encodeCpuRatios),
    wallClockDeltaPercentMedian: median(wallClockDeltas),
    axisBPassRate: axisBTotal === 0 ? null : axisBPasses / axisBTotal
  };
}

export function buildSoftFlags(input: {
  encodeCpuRatioMedian: number | null;
  axisBPassRate: number | null;
  growCount: number;
  okImageCount: number;
}): string[] {
  const flags: string[] = [];
  if (
    input.encodeCpuRatioMedian !== null &&
    input.encodeCpuRatioMedian > ENCODE_CPU_SOFT_FLAG_RATIO
  ) {
    flags.push(`encode-cpu>${ENCODE_CPU_SOFT_FLAG_RATIO}x`);
  }
  if (input.axisBPassRate !== null && input.axisBPassRate < 1) {
    flags.push("axis-B-failures");
  }
  if (input.okImageCount > 0 && input.growCount / input.okImageCount > 0.25) {
    flags.push("recompress-grow-heavy");
  }
  return flags;
}

export function buildBenchReport(input: {
  profile: BenchProfileName;
  corpus: {
    manifestId: string;
    goEligible: boolean;
    invalidReason?: string;
    documentCount: number;
  };
  jpegStats: ReturnType<typeof aggregateDocumentStats>;
  pngRows: BenchReport["pngRows"];
  softFlags: string[];
  goEligible: boolean;
  invalidReason?: string;
}): BenchReport {
  const decision = decideJpegliGo({
    goEligible: input.goEligible,
    exclusion: input.jpegStats.jpegExclusionRatio,
    median: input.jpegStats.medianPackageSavingsPercent
  });

  let goReason = decision.goReason;
  if (!input.goEligible && input.invalidReason) {
    goReason = input.invalidReason;
  }

  return {
    metricId: GO_METRIC_ID,
    metricTolerance: SSIMULACRA2_MATCH_TOLERANCE,
    axes: {
      primary: "A-resized-raw-ssimulacra2",
      secondary: "B-original-bindata-verifier-metrics",
      diagnostic: "C-mozjpeg-similarity"
    },
    corpus: input.corpus,
    profile: input.profile,
    jpegli: input.jpegStats,
    pngRows: input.pngRows,
    softFlags: input.softFlags,
    go: decision.go,
    goReason
  };
}

export function stderrVerdict(report: BenchReport): "GO" | "NO-GO" | "INVALID" {
  if (!report.corpus.goEligible || report.goReason === "metric-tool-missing" || report.goReason === "jpegli-unavailable") {
    return "INVALID";
  }
  return report.go ? "GO" : "NO-GO";
}
