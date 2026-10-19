import {
  ENCODE_CPU_SOFT_FLAG_RATIO,
  GO_METRIC_ID,
  MAX_JPEG_EXCLUSION_RATIO,
  PACKAGE_SAVINGS_GO_PERCENT,
  SSIMULACRA2_MATCH_TOLERANCE
} from "./types.js";
import type { BenchProfileName } from "./types.js";
import type { BenchCorpus, CorpusDocument } from "./corpus.js";

export type ToolInvalidReason = "metric-tool-missing" | "jpegli-unavailable";
export type DocumentMeasurement = Pick<CorpusDocument, "relativePath" | "source"> & {
  status: "ok" | "partial" | "no-data" | "error" | "skipped";
  reason?: string;
  toolInvalidReason?: ToolInvalidReason;
  issues: Array<{ stage: string; imagePath?: string; reason: string; message?: string }>;
  stats: (DocumentJpegStats & { pngControlBytes: number }) | null;
};

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
    realDocumentCount: number;
    fixtureDocumentCount: number;
  };
  statistics: {
    source: "real" | "fixture";
    documentCount: number;
    failedDocumentCount: number;
    partialDocumentCount: number;
    noDataDocumentCount: number;
    skippedDocumentCount: number;
    medianDocumentCount: number;
  };
  documents: Array<DocumentMeasurement & {
    inDecisionScope: boolean;
    includedInStatistics: boolean;
    medianExclusionReason?: string;
  }>;
  invalidReasons: string[];
  profile: BenchProfileName;
  jpegli: {
    perDocumentPackageSavingsPercent: number[];
    medianPackageSavingsPercent: number | null;
    jpegExclusionRatio: number;
    jpegTotal: number;
    jpegExcluded: number;
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
  failedDocumentCount?: number;
  unmeasuredJpegDocumentCount?: number;
}): { go: boolean; goReason: string } {
  if (!input.goEligible) {
    return { go: false, goReason: "corpus-ineligible" };
  }
  if (input.failedDocumentCount) {
    return { go: false, goReason: "document-processing-failed" };
  }
  if (input.unmeasuredJpegDocumentCount) {
    return { go: false, goReason: "document-no-valid-jpegs" };
  }
  if (input.median === null) {
    return { go: false, goReason: "no-valid-documents" };
  }
  if (!Number.isFinite(input.median) || !Number.isFinite(input.exclusion)) {
    return { go: false, goReason: "invalid-statistics" };
  }
  if (input.exclusion > MAX_JPEG_EXCLUSION_RATIO) {
    return { go: false, goReason: "jpeg-exclusion-too-high" };
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
  jpegTotal: number;
  jpegExcluded: number;
  growCount: number;
  encodeCpuRatioMedian: number | null;
  wallClockDeltaPercentMedian: number | null;
  axisBPassRate: number | null;
} {
  const savings = docs
    .map((doc) => doc.packageSavingsPercent)
    .filter((value): value is number => value !== null && Number.isFinite(value));

  const jpegTotal = docs.reduce((sum, doc) => sum + doc.jpegTotal, 0);
  const jpegExcluded = docs.reduce((sum, doc) => sum + doc.jpegExcluded, 0);
  const growCount = docs.reduce((sum, doc) => sum + doc.growCount, 0);

  const encodeCpuRatios = docs.flatMap((doc) => doc.encodeCpuRatios);
  const wallClockDeltas = docs.filter((doc) => doc.packageSavingsPercent !== null)
    .map((doc) => doc.wallClockDeltaPercent);
  const axisBPasses = docs.reduce((sum, doc) => sum + doc.axisBPasses, 0);
  const axisBTotal = docs.reduce((sum, doc) => sum + doc.axisBTotal, 0);

  return {
    perDocumentPackageSavingsPercent: savings,
    medianPackageSavingsPercent: median(savings),
    jpegExclusionRatio: jpegTotal === 0 ? 1 : jpegExcluded / jpegTotal,
    jpegTotal,
    jpegExcluded,
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
  corpus: BenchCorpus;
  documents: DocumentMeasurement[];
  toolInvalidReason?: ToolInvalidReason;
}): BenchReport {
  const realDocumentCount = input.corpus.docs.filter((doc) => doc.source === "real").length;
  const fixtureDocumentCount = input.corpus.docs.length - realDocumentCount;
  const source = realDocumentCount > 0 ? "real" : "fixture";
  const corpusEligible = input.corpus.goEligible && realDocumentCount > 0;
  // Traverse the expected corpus, not only returned successes. Missing outcomes
  // are explicit failures and can never turn a partial measurement into GO.
  const documents = input.corpus.docs.map((doc) => {
    const measurement = input.documents.find((row) => row.source === doc.source &&
      row.relativePath === doc.relativePath) ?? {
      relativePath: doc.relativePath, source: doc.source, status: "error" as const,
      reason: "missing-document-result", stats: null, issues: []
    };
    const inDecisionScope = doc.source === source;
    const includedInStatistics = inDecisionScope && measurement.stats !== null;
    const saving = measurement.stats?.packageSavingsPercent;
    const medianExclusionReason = !inDecisionScope ? "fixture-diagnostic" :
      saving == null ? measurement.reason ?? measurement.status :
      !Number.isFinite(saving) ? "non-finite-savings" : undefined;
    return { ...measurement, inDecisionScope, includedInStatistics,
      ...(medianExclusionReason ? { medianExclusionReason } : {}) };
  });
  const scoped = documents.filter((doc) => doc.inDecisionScope);
  const stats = scoped.flatMap((doc) => doc.stats ? [doc.stats] : []);
  const jpegStats = aggregateDocumentStats(stats);
  const failedDocumentCount = scoped.filter((doc) => doc.status === "error").length;
  const toolReason = input.toolInvalidReason ?? documents.find((doc) => doc.toolInvalidReason)?.toolInvalidReason;
  const invalidReasons = [...new Set([
    ...(!corpusEligible ? [input.corpus.invalidReason ?? "corpus-ineligible"] : []),
    ...(toolReason ? [toolReason] : [])
  ])];
  const decision = decideJpegliGo({
    goEligible: corpusEligible && !toolReason,
    exclusion: jpegStats.jpegExclusionRatio,
    median: jpegStats.medianPackageSavingsPercent,
    failedDocumentCount: failedDocumentCount + scoped.filter((doc) => doc.status === "skipped").length,
    unmeasuredJpegDocumentCount: stats.filter((doc) => doc.jpegTotal > 0 &&
      (doc.packageSavingsPercent === null || !Number.isFinite(doc.packageSavingsPercent))).length
  });

  return {
    metricId: GO_METRIC_ID,
    metricTolerance: SSIMULACRA2_MATCH_TOLERANCE,
    axes: {
      primary: "A-resized-raw-ssimulacra2",
      secondary: "B-original-bindata-verifier-metrics",
      diagnostic: "C-mozjpeg-similarity"
    },
    corpus: {
      manifestId: input.corpus.manifestId, goEligible: corpusEligible,
      ...(!corpusEligible ? { invalidReason: invalidReasons[0] } : {}),
      documentCount: scoped.length, realDocumentCount, fixtureDocumentCount
    },
    statistics: {
      source, documentCount: scoped.length, failedDocumentCount,
      partialDocumentCount: scoped.filter((doc) => doc.status === "partial").length,
      noDataDocumentCount: scoped.filter((doc) => doc.status === "no-data").length,
      skippedDocumentCount: scoped.filter((doc) => doc.status === "skipped").length,
      medianDocumentCount: jpegStats.perDocumentPackageSavingsPercent.length
    },
    documents,
    invalidReasons,
    profile: input.profile,
    jpegli: jpegStats,
    pngRows: {
      controlBytesTotal: stats.reduce((sum, doc) => sum + doc.pngControlBytes, 0),
      webpEnabled: false, webpBytesTotal: null
    },
    softFlags: buildSoftFlags({
      encodeCpuRatioMedian: jpegStats.encodeCpuRatioMedian,
      axisBPassRate: jpegStats.axisBPassRate,
      growCount: jpegStats.growCount,
      okImageCount: jpegStats.jpegTotal - jpegStats.jpegExcluded
    }),
    go: decision.go,
    goReason: invalidReasons[0] ?? decision.goReason
  };
}

export function stderrVerdict(report: BenchReport): "GO" | "NO-GO" | "INVALID" {
  if (!report.corpus.goEligible || report.invalidReasons?.length > 0 ||
      report.goReason === "metric-tool-missing" || report.goReason === "jpegli-unavailable") {
    return "INVALID";
  }
  return report.go ? "GO" : "NO-GO";
}
