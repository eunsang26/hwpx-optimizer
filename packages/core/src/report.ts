import type {
  AppliedAction,
  OptimizationAction,
  OptimizationOpportunity,
  OptimizationOpportunityGroup,
  OptimizationReport,
  PackageAnalysis
} from "./types.js";
import { estimateNonOverlappingSavingBytes } from "./estimateSavings.js";

export function createAnalysisReport(
  analysis: PackageAnalysis,
  originalSize = analysis.totalSize,
  opportunities: OptimizationOpportunity[] = [],
  options: { targetBytes?: number } = {}
): OptimizationReport {
  const projectedOptimizedSize = Math.max(0, originalSize - estimateNonOverlappingSavingBytes(groupOpportunities(opportunities)));
  return {
    originalSize,
    ...createTargetFields({
      originalSize,
      optimizedSize: projectedOptimizedSize,
      targetBytes: options.targetBytes,
      missReason: "No quality-preserving optimization candidate is projected to reach the target."
    }),
    categorySizes: analysis.categorySizes,
    images: analysis.images,
    duplicateImages: analysis.duplicateImages,
    sameVisualDuplicateImages: analysis.sameVisualDuplicateImages,
    nearDuplicateImages: analysis.nearDuplicateImages ?? [],
    unusedBinData: analysis.unusedBinData,
    riskyResources: analysis.riskyResources,
    resourceDiagnostics: analysis.resourceDiagnostics ?? [],
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
  targetBytes?: number;
  targetMissReason?: string;
}): OptimizationReport {
  const savedBytes = input.originalSize - input.optimizedSize;
  return {
    originalSize: input.originalSize,
    optimizedSize: input.optimizedSize,
    savedBytes,
    savedPercent: input.originalSize === 0 ? 0 : (savedBytes / input.originalSize) * 100,
    ...createTargetFields({
      originalSize: input.originalSize,
      optimizedSize: input.optimizedSize,
      targetBytes: input.targetBytes,
      missReason: input.targetMissReason ?? "No quality-preserving optimization candidate reached the target."
    }),
    categorySizes: input.analysis.categorySizes,
    images: input.analysis.images,
    duplicateImages: input.analysis.duplicateImages,
    sameVisualDuplicateImages: input.analysis.sameVisualDuplicateImages,
    nearDuplicateImages: input.analysis.nearDuplicateImages ?? [],
    unusedBinData: input.analysis.unusedBinData,
    riskyResources: input.analysis.riskyResources,
    resourceDiagnostics: input.analysis.resourceDiagnostics ?? [],
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

function createTargetFields(input: {
  originalSize: number;
  optimizedSize: number;
  targetBytes?: number;
  missReason: string;
}): Pick<OptimizationReport, "targetBytes" | "targetStatus" | "targetMissReason"> {
  if (!input.targetBytes) return {};
  if (input.originalSize <= input.targetBytes) {
    return { targetBytes: input.targetBytes, targetStatus: "already-under-target" };
  }
  if (input.optimizedSize <= input.targetBytes) {
    return { targetBytes: input.targetBytes, targetStatus: "met" };
  }
  return {
    targetBytes: input.targetBytes,
    targetStatus: "missed",
    targetMissReason: input.missReason
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
