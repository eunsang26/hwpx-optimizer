import type {
  AppliedAction,
  OptimizationAction,
  OptimizationOpportunity,
  OptimizationOpportunityGroup,
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
    categorySizes: analysis.categorySizes,
    images: analysis.images,
    duplicateImages: analysis.duplicateImages,
    sameVisualDuplicateImages: analysis.sameVisualDuplicateImages,
    unusedBinData: analysis.unusedBinData,
    riskyResources: analysis.riskyResources,
    actions: { planned: [], applied: [], skipped: [] },
    opportunities,
    opportunityGroups: groupOpportunities(opportunities),
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
    categorySizes: input.analysis.categorySizes,
    images: input.analysis.images,
    duplicateImages: input.analysis.duplicateImages,
    sameVisualDuplicateImages: input.analysis.sameVisualDuplicateImages,
    unusedBinData: input.analysis.unusedBinData,
    riskyResources: input.analysis.riskyResources,
    actions: {
      planned: input.planned,
      applied: input.applied,
      skipped: input.skipped
    },
    opportunities: input.opportunities ?? [],
    opportunityGroups: groupOpportunities(input.opportunities ?? []),
    warnings: [...createWarnings(input.analysis), ...(input.warnings ?? [])]
  };
}

export function groupOpportunities(opportunities: OptimizationOpportunity[]): OptimizationOpportunityGroup[] {
  const groups = new Map<OptimizationOpportunity["action"], OptimizationOpportunityGroup>();

  for (const opportunity of opportunities) {
    const existing = groups.get(opportunity.action);
    if (!existing) {
      groups.set(opportunity.action, {
        action: opportunity.action,
        label: opportunity.label,
        count: 1,
        estimatedSavingBytes: opportunity.estimatedSavingBytes,
        beforeSize: opportunity.beforeSize,
        afterSize: opportunity.afterSize,
        confidence: opportunity.confidence,
        risk: opportunity.risk,
        visualImpact: opportunity.visualImpact,
        defaultEnabledIn: orderModes(opportunity.defaultEnabledIn),
        targets: [opportunity.target]
      });
      continue;
    }

    existing.count += 1;
    existing.estimatedSavingBytes += opportunity.estimatedSavingBytes;
    existing.beforeSize += opportunity.beforeSize;
    existing.afterSize += opportunity.afterSize;
    existing.confidence = existing.confidence === "estimated" || opportunity.confidence === "estimated" ? "estimated" : "exact";
    existing.risk = maxSeverity(existing.risk, opportunity.risk, riskOrder);
    existing.visualImpact = maxSeverity(existing.visualImpact, opportunity.visualImpact, visualImpactOrder);
    existing.defaultEnabledIn = orderModes([...existing.defaultEnabledIn, ...opportunity.defaultEnabledIn]);
    existing.targets.push(opportunity.target);
  }

  return [...groups.values()].sort((left, right) => right.estimatedSavingBytes - left.estimatedSavingBytes);
}

function createWarnings(analysis: PackageAnalysis): string[] {
  return analysis.images
    .filter((image) => image.isBmpCandidate)
    .map((image) => `BMP candidate detected; convert-bmp-to-png may reduce size: ${image.path}`);
}

const riskOrder = { safe: 0, medium: 1, high: 2 } as const;
const visualImpactOrder = { none: 0, low: 1, medium: 2, high: 3 } as const;
const modeOrder = ["safe", "balanced", "aggressive"] as const;

function maxSeverity<T extends string>(left: T, right: T, order: Record<T, number>): T {
  return order[right] > order[left] ? right : left;
}

function orderModes(modes: Array<"safe" | "balanced" | "aggressive">): Array<"safe" | "balanced" | "aggressive"> {
  const unique = new Set(modes);
  return modeOrder.filter((mode) => unique.has(mode));
}
