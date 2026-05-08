import type {
  AppliedAction,
  OptimizationAction,
  OptimizationOpportunity,
  OptimizationReport,
  PackageAnalysis
} from "./types.js";

export function createAnalysisReport(
  analysis: PackageAnalysis,
  originalSize = analysis.totalSize,
  opportunities: OptimizationOpportunity[] = []
): OptimizationReport {
  return {
    originalSize,
    images: analysis.images,
    actions: { planned: [], applied: [], skipped: [] },
    opportunities,
    warnings: createWarnings(analysis)
  };
}

export function createOptimizationReport(input: {
  analysis: PackageAnalysis;
  originalSize: number;
  optimizedSize: number;
  planned: OptimizationAction[];
  applied: AppliedAction[];
  skipped: AppliedAction[];
  opportunities?: OptimizationOpportunity[];
  warnings?: string[];
}): OptimizationReport {
  const savedBytes = input.originalSize - input.optimizedSize;
  return {
    originalSize: input.originalSize,
    optimizedSize: input.optimizedSize,
    savedBytes,
    savedPercent: input.originalSize === 0 ? 0 : (savedBytes / input.originalSize) * 100,
    images: input.analysis.images,
    actions: {
      planned: input.planned,
      applied: input.applied,
      skipped: input.skipped
    },
    opportunities: input.opportunities ?? [],
    warnings: [...createWarnings(input.analysis), ...(input.warnings ?? [])]
  };
}

function createWarnings(analysis: PackageAnalysis): string[] {
  return analysis.images
    .filter((image) => image.isBmpCandidate)
    .map((image) => `BMP candidate detected; convert-bmp-to-png may reduce size: ${image.path}`);
}
