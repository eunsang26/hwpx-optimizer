import type { OptimizationOpportunityGroup, OptimizationReport } from "@hwpx-optimizer/core";

export type AnalysisViewModel = {
  originalSizeLabel: string;
  imageCount: number;
  bmpCount: number;
  metadataImageCount: number;
  unusedResourceCount: number;
  duplicateGroupCount: number;
  riskyResourceCount: number;
  estimatedSavingLabel: string;
  topOpportunities: Array<{
    action: OptimizationOpportunityGroup["action"];
    count: number;
    savingLabel: string;
    risk: OptimizationOpportunityGroup["risk"];
  }>;
  warnings: string[];
};

export function createAnalysisViewModel(report: OptimizationReport): AnalysisViewModel {
  const estimatedSaving = report.opportunityGroups.reduce((sum, group) => sum + group.estimatedSavingBytes, 0);
  return {
    originalSizeLabel: formatBytes(report.originalSize),
    imageCount: report.images.length,
    bmpCount: report.images.filter((image) => image.isBmpCandidate).length,
    metadataImageCount: report.images.filter((image) => image.hasMetadata).length,
    unusedResourceCount: report.unusedBinData.length,
    duplicateGroupCount: report.duplicateImages.length,
    riskyResourceCount: report.riskyResources.length,
    estimatedSavingLabel: formatBytes(estimatedSaving),
    topOpportunities: report.opportunityGroups.slice(0, 5).map((group) => ({
      action: group.action,
      count: group.count,
      savingLabel: formatBytes(group.estimatedSavingBytes),
      risk: group.risk
    })),
    warnings: [...report.warnings, ...report.riskyResources.map((resource) => resource.reason)]
  };
}

export function formatBytes(bytes: number): string {
  const sign = bytes < 0 ? "-" : "";
  const absolute = Math.abs(bytes);
  if (absolute < 1024) return `${sign}${absolute} B`;
  if (absolute < 1024 * 1024) return `${sign}${(absolute / 1024).toFixed(1)} KiB`;
  return `${sign}${(absolute / 1024 / 1024).toFixed(2)} MiB`;
}
