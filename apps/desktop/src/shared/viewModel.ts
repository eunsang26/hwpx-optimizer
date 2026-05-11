import type { HwpxEntryKind, OptimizationOpportunityGroup, OptimizationReport } from "@hwpx-optimizer/core";
import { OPPORTUNITY_ACTION_LABELS } from "./actionLabels.js";
import { estimateNonOverlappingSavingBytes } from "./estimateSavings.js";

export type OptimizationMode = "safe" | "balanced" | "aggressive";

export type ActionToggleViewModel = {
  action: OptimizationOpportunityGroup["action"];
  label: string;
  count: number;
  savingLabel: string;
  risk: OptimizationOpportunityGroup["risk"];
  visualImpact: OptimizationOpportunityGroup["visualImpact"];
  defaultEnabledIn: OptimizationOpportunityGroup["defaultEnabledIn"];
  defaultEnabledForMode: boolean;
};

export type CategorySlice = {
  kind: HwpxEntryKind;
  bytes: number;
  ratio: number;
  label: string;
};

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
  categoryBreakdown: CategorySlice[];
  warnings: string[];
};

const CATEGORY_LABELS: Record<HwpxEntryKind, string> = {
  xml: "문서 XML",
  image: "이미지",
  font: "폰트",
  ole: "OLE 객체",
  bindata: "바이너리",
  other: "기타"
};

const CATEGORY_ORDER: HwpxEntryKind[] = ["image", "xml", "font", "ole", "bindata", "other"];

const ESTIMATED_SAVING_DISPLAY_RATIO = 0.95;

export function createAnalysisViewModel(report: OptimizationReport): AnalysisViewModel {
  const estimatedSavingRaw = estimateNonOverlappingSavingBytes(report.opportunityGroups);
  const cap = Math.max(0, Math.floor(report.originalSize * ESTIMATED_SAVING_DISPLAY_RATIO));
  const cappedSaving = report.originalSize > 0 ? Math.min(estimatedSavingRaw, cap) : estimatedSavingRaw;
  const wasCapped = estimatedSavingRaw > cappedSaving;
  return {
    originalSizeLabel: formatBytes(report.originalSize),
    imageCount: report.images.length,
    bmpCount: report.images.filter((image) => image.isBmpCandidate).length,
    metadataImageCount: report.images.filter((image) => image.hasMetadata).length,
    unusedResourceCount: report.unusedBinData.length,
    duplicateGroupCount: report.duplicateImages.length + report.sameVisualDuplicateImages.length,
    riskyResourceCount: report.riskyResources.length,
    estimatedSavingLabel: wasCapped ? `최대 ${formatBytes(cappedSaving)}` : formatBytes(cappedSaving),
    topOpportunities: report.opportunityGroups.slice(0, 5).map((group) => ({
      action: group.action,
      count: group.count,
      savingLabel: formatBytes(group.estimatedSavingBytes),
      risk: group.risk
    })),
    categoryBreakdown: createCategoryBreakdown(report),
    warnings: [...report.warnings, ...report.riskyResources.map((resource) => resource.reason)]
  };
}

export function createActionToggles(
  report: OptimizationReport,
  mode: OptimizationMode
): ActionToggleViewModel[] {
  return report.opportunityGroups.map((group) => ({
    action: group.action,
    label: OPPORTUNITY_ACTION_LABELS[group.action] ?? group.label ?? group.action,
    count: group.count,
    savingLabel: formatBytes(group.estimatedSavingBytes),
    risk: group.risk,
    visualImpact: group.visualImpact,
    defaultEnabledIn: group.defaultEnabledIn,
    defaultEnabledForMode: group.defaultEnabledIn.includes(mode)
  }));
}

function createCategoryBreakdown(report: OptimizationReport): CategorySlice[] {
  const total = Object.values(report.categorySizes).reduce((sum, value) => sum + value, 0);
  if (total === 0) return [];
  return CATEGORY_ORDER.flatMap((kind) => {
    const bytes = report.categorySizes[kind];
    if (!bytes) return [];
    return [{ kind, bytes, ratio: bytes / total, label: CATEGORY_LABELS[kind] }];
  });
}

export function formatBytes(bytes: number): string {
  const sign = bytes < 0 ? "-" : "";
  const absolute = Math.abs(bytes);
  if (absolute < 1024) return `${sign}${absolute} B`;
  if (absolute < 1024 * 1024) return `${sign}${(absolute / 1024).toFixed(1)} KiB`;
  return `${sign}${(absolute / 1024 / 1024).toFixed(2)} MiB`;
}
