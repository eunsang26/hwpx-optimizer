import type {
  AnalysisCoverage,
  AnalysisReport,
  CompletedOptimizationReport,
  PackageSizeEstimate,
  AppliedAction,
  OptimizationAction,
  OptimizationOpportunity,
  OptimizationOpportunityGroup,
  OptimizationReport,
  PackageAnalysis,
  PerformanceSummary,
  ResourceMapping
} from "./types.js";
import { targetStatusForBytes } from "./planning.js";

export function createAnalysisReport(
  analysis: PackageAnalysis,
  originalSize = analysis.totalSize,
  opportunities: OptimizationOpportunity[] = [],
  options: {
    analysis?: AnalysisCoverage;
    estimates?: Record<"safe" | "balanced" | "aggressive", PackageSizeEstimate>;
    targetBytes?: number;
    performance?: PerformanceSummary;
    /** Prefer ZIP-aware projection from `projectPackageSizeFromOpportunities`. */
    projectedOptimizedSize?: number;
    aggressiveProjectedOptimizedSize?: number;
  } = {}
): AnalysisReport {
  const fallbackProjected = originalSize;
  const projectedOptimizedSize =
    options.projectedOptimizedSize !== undefined
      ? Math.max(0, Math.min(originalSize, Math.round(options.projectedOptimizedSize)))
      : fallbackProjected;
  return {
    kind: "analysis",
    ...(options.estimates ? { estimates: options.estimates } : {}),
    ...(options.analysis ? { analysis: options.analysis } : {}),
    originalSize,
    estimatedSize: projectedOptimizedSize,
    estimatedSavingBytes: Math.max(0, originalSize - projectedOptimizedSize),
    estimatedSavingPercent: originalSize === 0 ? 0 : ((originalSize - projectedOptimizedSize) / originalSize) * 100,
    ...(options.targetBytes ? {
      targetBytes: options.targetBytes,
      estimatedTargetStatus: targetStatusForBytes(originalSize, projectedOptimizedSize, options.targetBytes)
    } : {}),
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
    ...(options.aggressiveProjectedOptimizedSize !== undefined
      ? {
          aggressiveProjectedOptimizedSize: Math.max(
            0,
            Math.min(originalSize, Math.round(options.aggressiveProjectedOptimizedSize))
          )
        }
      : {}),
    warnings: createWarnings(analysis),
    ...(options.performance ? { performance: options.performance } : {})
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
  plannedJpegQuality?: number;
  performance?: PerformanceSummary;
  resourceMappings?: ResourceMapping[];
}): CompletedOptimizationReport {
  const savedBytes = input.originalSize - input.optimizedSize;
  return {
    kind: "optimization",
    originalSize: input.originalSize,
    ...(input.resourceMappings ? { resourceMappings: input.resourceMappings } : {}),
    optimizedSize: input.optimizedSize,
    savedBytes,
    savedPercent: input.originalSize === 0 ? 0 : (savedBytes / input.originalSize) * 100,
    ...createTargetFields({
      originalSize: input.originalSize,
      optimizedSize: input.optimizedSize,
      targetBytes: input.targetBytes,
      missReason: input.targetMissReason ?? "No quality-preserving optimization candidate reached the target."
    }),
    ...(input.plannedJpegQuality !== undefined ? { plannedJpegQuality: input.plannedJpegQuality } : {}),
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
    warnings: [...createWarnings(input.analysis), ...(input.warnings ?? [])],
    ...(input.performance ? { performance: input.performance } : {})
  };
}

function createTargetFields(input: {
  originalSize: number;
  optimizedSize: number;
  targetBytes?: number;
  missReason: string;
}): Pick<OptimizationReport, "targetBytes" | "targetStatus" | "targetMissReason"> {
  if (!input.targetBytes) return {};
  // Submission "미만" is always judged on the candidate output size.
  // already-under-target only when the original was already under AND the output stayed under —
  // never label a grown/over-target output as already-under.
  if (targetStatusForBytes(input.originalSize, input.optimizedSize, input.targetBytes) !== "missed") {
    return {
      targetBytes: input.targetBytes,
      targetStatus: input.originalSize < input.targetBytes ? "already-under-target" : "met"
    };
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
  return [...(analysis.referenceGraph?.missingReferences ?? []).map((reference) =>
    `Unresolved package reference: ${reference}`), ...analysis.images.flatMap((image) => image.preservationReason
    ? [`Image bytes preserved for ${image.path}: ${image.preservationReason}`]
    : image.isBmpCandidate ? [`BMP candidate detected; convert-bmp-to-png may reduce size: ${image.path}`] : [])];
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
