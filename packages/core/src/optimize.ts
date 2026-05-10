import { analyzeHwpxPackage } from "./analyzer.js";
import { applyBalancedOptimizationPlan } from "./balancedOptimizer.js";
import { applySafeOptimizationPlan } from "./optimizer.js";
import {
  aggressiveImageProfile,
  balancedImageProfile,
  detectEstimatedOptimizationOpportunities,
} from "./opportunities.js";
import type { ImageOptimizationProfile } from "./opportunities.js";
import { createSafeOptimizationPlan } from "./planner.js";
import { createAnalysisReport, createOptimizationReport } from "./report.js";
import { buildReferenceGraph } from "./referenceGraph.js";
import { readHwpxPackage } from "./reader.js";
import { verifyHwpxOutput } from "./verifier.js";
import { writeHwpxPackage } from "./writer.js";
import type { AppliedAction, OptimizationOpportunity, OptimizationReport } from "./types.js";

export async function analyzeHwpxBuffer(input: Buffer): Promise<OptimizationReport> {
  const pkg = await readHwpxPackage(input);
  const analysis = await analyzeHwpxPackage(pkg);
  const opportunities = await detectEstimatedOptimizationOpportunities(pkg);
  return createAnalysisReport(analysis, input.byteLength, opportunities);
}

export async function optimizeHwpxBufferSafe(input: Buffer): Promise<{
  output: Buffer;
  report: OptimizationReport;
}> {
  const pkg = await readHwpxPackage(input);
  const analysis = await analyzeHwpxPackage(pkg);
  const graph = analysis.referenceGraph ?? buildReferenceGraph(pkg);
  const plan = createSafeOptimizationPlan({ pkg, analysis, graph });
  const optimized = await applySafeOptimizationPlan({ pkg, plan });
  const opportunities = createOptimizationOpportunitiesFromAppliedActions(optimized.applied);
  const output = await writeHwpxPackage(optimized.pkg);
  await verifyHwpxOutput(output, { original: input, mode: "safe" });

  if (output.byteLength >= input.byteLength) {
    const report = createOptimizationReport({
      analysis,
      originalSize: input.byteLength,
      optimizedSize: input.byteLength,
      planned: plan.actions,
      applied: [],
      skipped: [
        ...optimized.applied,
        ...optimized.skipped,
        { type: "repack-zip", target: "*", beforeSize: input.byteLength, afterSize: output.byteLength }
      ],
      opportunities,
      warnings: ["Safe mode did not produce a smaller file; original package bytes returned."]
    });
    return { output: input, report };
  }

  const applied: AppliedAction[] = [
    ...optimized.applied,
    { type: "repack-zip", target: "*", beforeSize: input.byteLength, afterSize: output.byteLength }
  ];
  const report = createOptimizationReport({
    analysis,
    originalSize: input.byteLength,
    optimizedSize: output.byteLength,
    planned: plan.actions,
    applied,
    skipped: optimized.skipped,
    opportunities
  });
  return { output, report };
}

export async function optimizeHwpxBufferBalanced(
  input: Buffer,
  options: { actions?: string[]; allowLarger?: boolean } = {}
): Promise<{
  output: Buffer;
  report: OptimizationReport;
}> {
  return optimizeHwpxBufferAdvanced(input, {
    options,
    mode: "balanced",
    profile: balancedImageProfile,
    rollbackWarning: "Balanced mode did not produce a smaller file; original package bytes returned."
  });
}

async function optimizeHwpxBufferAdvanced(
  input: Buffer,
  settings: {
    options: { actions?: string[]; allowLarger?: boolean };
    mode: "balanced" | "aggressive";
    profile: ImageOptimizationProfile;
    rollbackWarning: string;
    warnings?: string[];
  }
): Promise<{
  output: Buffer;
  report: OptimizationReport;
}> {
  const pkg = await readHwpxPackage(input);
  const analysis = await analyzeHwpxPackage(pkg);
  const opportunities = await detectEstimatedOptimizationOpportunities(pkg, settings.profile);
  const selectedOpportunities =
    settings.options.actions !== undefined
      ? opportunities.filter((opportunity) => settings.options.actions?.includes(opportunity.action))
      : opportunities;
  const actions = selectedOpportunities.map((opportunity) => {
    if (opportunity.action === "convert-bmp-to-png") {
      return {
        type: "convert-bmp-to-png" as const,
        target: opportunity.target,
        outputPath: opportunity.target.replace(/\.[^.\/]+$/, ".png"),
        risk: "medium" as const
      };
    }
    if (opportunity.action === "convert-tiff-to-png") {
      return {
        type: "convert-tiff-to-png" as const,
        target: opportunity.target,
        outputPath: opportunity.target.replace(/\.[^.\/]+$/, ".png"),
        risk: "medium" as const
      };
    }
    if (opportunity.action === "resize-jpeg") {
      return { type: "resize-jpeg" as const, target: opportunity.target, risk: "medium" as const };
    }
    if (opportunity.action === "resize-png") {
      return { type: "resize-png" as const, target: opportunity.target, risk: "medium" as const };
    }
    if (opportunity.action === "consolidate-duplicate-images") {
      return { type: "consolidate-duplicate-images" as const, target: opportunity.target, risk: "medium" as const };
    }
    return { type: opportunity.action, target: opportunity.target, risk: "safe" as const };
  });
  const plan = {
    mode: settings.mode,
    actions: [...actions, { type: "repack-zip" as const, target: "*" as const, risk: "safe" as const }]
  };
  const optimized = await applyBalancedOptimizationPlan({ pkg, plan, profile: settings.profile });
  const exactOpportunities = createOptimizationOpportunitiesFromAppliedActions(optimized.applied);
  const output = await writeHwpxPackage(optimized.pkg);
  await verifyHwpxOutput(output, { original: input, mode: settings.mode });

  if (!settings.options.allowLarger && output.byteLength >= input.byteLength) {
    const report = createOptimizationReport({
      analysis,
      originalSize: input.byteLength,
      optimizedSize: input.byteLength,
      planned: plan.actions,
      applied: [],
      skipped: [
        ...optimized.applied,
        ...optimized.skipped,
        { type: "repack-zip", target: "*", beforeSize: input.byteLength, afterSize: output.byteLength }
      ],
      opportunities: exactOpportunities.length > 0 ? exactOpportunities : opportunities,
      warnings: [settings.rollbackWarning, ...(settings.warnings ?? [])]
    });
    return { output: input, report };
  }

  const applied: AppliedAction[] = [
    ...optimized.applied,
    { type: "repack-zip", target: "*", beforeSize: input.byteLength, afterSize: output.byteLength }
  ];
  const report = createOptimizationReport({
    analysis,
    originalSize: input.byteLength,
    optimizedSize: output.byteLength,
    planned: plan.actions,
    applied,
    skipped: optimized.skipped,
    opportunities: exactOpportunities.length > 0 ? exactOpportunities : opportunities,
    warnings: settings.warnings
  });
  return { output, report };
}

function createOptimizationOpportunitiesFromAppliedActions(actions: AppliedAction[]): OptimizationOpportunity[] {
  const opportunities: OptimizationOpportunity[] = [];
  for (const action of actions) {
    const opportunity = createOptimizationOpportunityFromAppliedAction(action);
    if (opportunity) opportunities.push(opportunity);
  }
  return opportunities.sort((left, right) => right.estimatedSavingBytes - left.estimatedSavingBytes);
}

function createOptimizationOpportunityFromAppliedAction(action: AppliedAction): OptimizationOpportunity | null {
  if (action.beforeSize === undefined || action.afterSize === undefined) return null;
  const estimatedSavingBytes = action.beforeSize - action.afterSize;
  if (estimatedSavingBytes <= 0) return null;

  if (action.type === "strip-metadata" || action.type === "optimize-png") {
    return {
      id: `${action.type}:${action.target}`,
      label: action.type === "strip-metadata" ? "Strip JPEG metadata" : "Optimize PNG losslessly",
      action: action.type,
      target: action.target,
      estimatedSavingBytes,
      beforeSize: action.beforeSize,
      afterSize: action.afterSize,
      confidence: "exact",
      risk: "safe",
      visualImpact: "none",
      defaultEnabledIn: ["safe", "balanced", "aggressive"]
    };
  }

  if (action.type === "convert-bmp-to-png") {
    return {
      id: `${action.type}:${action.target}`,
      label: "Convert BMP to PNG",
      action: action.type,
      target: action.target,
      estimatedSavingBytes,
      beforeSize: action.beforeSize,
      afterSize: action.afterSize,
      confidence: "exact",
      risk: "medium",
      visualImpact: "low",
      defaultEnabledIn: ["balanced", "aggressive"]
    };
  }

  if (action.type === "convert-tiff-to-png") {
    return {
      id: `${action.type}:${action.target}`,
      label: "Convert TIFF to PNG",
      action: action.type,
      target: action.target,
      estimatedSavingBytes,
      beforeSize: action.beforeSize,
      afterSize: action.afterSize,
      confidence: "exact",
      risk: "medium",
      visualImpact: "low",
      defaultEnabledIn: ["balanced", "aggressive"]
    };
  }

  if (action.type === "resize-jpeg") {
    return {
      id: `${action.type}:${action.target}`,
      label: "Resize oversized JPEG and recompress with MozJPEG",
      action: action.type,
      target: action.target,
      estimatedSavingBytes,
      beforeSize: action.beforeSize,
      afterSize: action.afterSize,
      confidence: "exact",
      risk: "medium",
      visualImpact: "medium",
      defaultEnabledIn: ["balanced", "aggressive"]
    };
  }

  if (action.type === "resize-png") {
    return {
      id: `${action.type}:${action.target}`,
      label: "Resize PNG to document display budget",
      action: action.type,
      target: action.target,
      estimatedSavingBytes,
      beforeSize: action.beforeSize,
      afterSize: action.afterSize,
      confidence: "exact",
      risk: "medium",
      visualImpact: "low",
      defaultEnabledIn: ["balanced", "aggressive"]
    };
  }

  if (action.type === "clean-shape-comment") {
    return {
      id: `${action.type}:${action.target}`,
      label: "Clean image shape comments",
      action: action.type,
      target: action.target,
      estimatedSavingBytes,
      beforeSize: action.beforeSize,
      afterSize: action.afterSize,
      confidence: "exact",
      risk: "safe",
      visualImpact: "none",
      defaultEnabledIn: ["balanced", "aggressive"]
    };
  }

  if (action.type === "consolidate-duplicate-images") {
    return {
      id: `${action.type}:${action.target}`,
      label: "Consolidate duplicate image references",
      action: action.type,
      target: action.target,
      estimatedSavingBytes,
      beforeSize: action.beforeSize,
      afterSize: action.afterSize,
      confidence: "exact",
      risk: "medium",
      visualImpact: "none",
      defaultEnabledIn: ["balanced", "aggressive"]
    };
  }

  return null;
}

export async function optimizeHwpxBufferAggressive(
  input: Buffer,
  options: { actions?: string[]; allowLarger?: boolean } = {}
): Promise<{
  output: Buffer;
  report: OptimizationReport;
}> {
  return optimizeHwpxBufferAdvanced(input, {
    options,
    mode: "aggressive",
    profile: aggressiveImageProfile,
    rollbackWarning: "Aggressive mode did not produce a smaller file; original package bytes returned.",
    warnings: ["Aggressive mode prioritizes file size and may introduce visible image quality differences."]
  });
}
