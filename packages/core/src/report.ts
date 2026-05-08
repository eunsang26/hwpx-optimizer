import type { AppliedAction, OptimizationAction, OptimizationReport, PackageAnalysis } from "./types.js";

export function createAnalysisReport(analysis: PackageAnalysis): OptimizationReport {
  return {
    originalSize: analysis.totalSize,
    images: analysis.images,
    actions: { planned: [], applied: [], skipped: [] },
    warnings: createWarnings(analysis)
  };
}

export function createOptimizationReport(input: {
  analysis: PackageAnalysis;
  optimizedSize: number;
  planned: OptimizationAction[];
  applied: AppliedAction[];
  skipped: AppliedAction[];
}): OptimizationReport {
  const savedBytes = input.analysis.totalSize - input.optimizedSize;
  return {
    originalSize: input.analysis.totalSize,
    optimizedSize: input.optimizedSize,
    savedBytes,
    savedPercent: input.analysis.totalSize === 0 ? 0 : (savedBytes / input.analysis.totalSize) * 100,
    images: input.analysis.images,
    actions: {
      planned: input.planned,
      applied: input.applied,
      skipped: input.skipped
    },
    warnings: createWarnings(input.analysis)
  };
}

function createWarnings(analysis: PackageAnalysis): string[] {
  return analysis.images
    .filter((image) => image.isBmpCandidate)
    .map((image) => `BMP candidate detected but not converted in safe mode: ${image.path}`);
}
