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

export type OptimizeProgress = { percent: number; item: string };

type OptimizeProgressCallback = (progress: OptimizeProgress) => void;
type OptimizeOptions = {
  actions?: string[];
  allowLarger?: boolean;
  targetBytes?: number;
  onProgress?: OptimizeProgressCallback;
};
type SafeOptimizeOptions = { targetBytes?: number; onProgress?: OptimizeProgressCallback };

export async function analyzeHwpxBuffer(input: Buffer, options: { targetBytes?: number } = {}): Promise<OptimizationReport> {
  const targetBytes = normalizeTargetBytes(options.targetBytes);
  const pkg = await readHwpxPackage(input);
  const analysis = await analyzeHwpxPackage(pkg);
  const opportunities = await detectEstimatedOptimizationOpportunities(pkg);
  return createAnalysisReport(analysis, input.byteLength, opportunities, { targetBytes });
}

export async function optimizeHwpxBufferSafe(input: Buffer, options: SafeOptimizeOptions = {}): Promise<{
  output: Buffer;
  report: OptimizationReport;
}> {
  const targetBytes = normalizeTargetBytes(options.targetBytes);
  emitProgress(options, 25, "Analyzing document structure");
  const pkg = await readHwpxPackage(input);
  const analysis = await analyzeHwpxPackage(pkg);
  const graph = analysis.referenceGraph ?? buildReferenceGraph(pkg);
  emitProgress(options, 40, "Planning safe changes");
  const plan = createSafeOptimizationPlan({ pkg, analysis, graph });
  const optimized = await applySafeOptimizationPlan({ pkg, plan });
  const opportunities = createOptimizationOpportunitiesFromAppliedActions(optimized.applied);
  const output = await writeHwpxPackage(optimized.pkg);
  emitProgress(options, 82, "Verifying optimized document");
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
      targetBytes,
      warnings: [
        "Safe mode did not produce a smaller file; original package bytes returned.",
        ...optimized.warnings
      ]
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
    opportunities,
    targetBytes,
    warnings: optimized.warnings.length > 0 ? optimized.warnings : undefined
  });
  return { output, report };
}

export async function optimizeHwpxBufferBalanced(
  input: Buffer,
  options: OptimizeOptions = {}
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
    options: OptimizeOptions;
    mode: "balanced" | "aggressive";
    profile: ImageOptimizationProfile;
    rollbackWarning: string;
    warnings?: string[];
  }
): Promise<{
  output: Buffer;
  report: OptimizationReport;
}> {
  const options = {
    ...settings.options,
    targetBytes: normalizeTargetBytes(settings.options.targetBytes),
    onProgress: createMonotonicProgressCallback(settings.options.onProgress)
  };
  const profiles = createTargetProfileLadder(settings.mode, settings.profile, options.targetBytes);
  let best: { output: Buffer; report: OptimizationReport; targetMet: boolean } | undefined;
  const verificationWarnings: string[] = [];
  for (const profile of profiles) {
    try {
      const candidate = await optimizeHwpxBufferWithProfile(input, {
        ...settings,
        options,
        profile,
        warnings: [...(settings.warnings ?? []), ...verificationWarnings]
      });
      best = chooseBestCandidate(best, candidate);
      if (!options.targetBytes || candidate.report.targetStatus === "met" || candidate.report.targetStatus === "already-under-target") {
        return candidate;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      verificationWarnings.push(`Candidate profile skipped after verification failure: ${message}`);
    }
  }
  if (best) return best;
  throw new Error("No verified optimization candidate could be produced.");
}

function normalizeTargetBytes(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("targetBytes must be a positive number.");
  }
  return Math.floor(value);
}

function emitProgress(options: { onProgress?: OptimizeProgressCallback }, percent: number, item: string): void {
  options.onProgress?.({ percent, item });
}

function createMonotonicProgressCallback(callback: OptimizeProgressCallback | undefined): OptimizeProgressCallback | undefined {
  if (!callback) return undefined;
  let lastPercent = 0;
  return (progress) => {
    const percent = Math.max(lastPercent, progress.percent);
    lastPercent = percent;
    callback({ ...progress, percent });
  };
}

async function optimizeHwpxBufferWithProfile(
  input: Buffer,
  settings: {
    options: OptimizeOptions;
    mode: "balanced" | "aggressive";
    profile: ImageOptimizationProfile;
    rollbackWarning: string;
    warnings?: string[];
  }
): Promise<{
  output: Buffer;
  report: OptimizationReport;
}> {
  emitProgress(settings.options, 25, "Analyzing document structure");
  const pkg = await readHwpxPackage(input);
  const analysis = await analyzeHwpxPackage(pkg);
  const opportunities = await detectEstimatedOptimizationOpportunities(pkg, settings.profile);
  const selectedOpportunities =
    settings.options.actions !== undefined
      ? opportunities.filter((opportunity) => settings.options.actions?.includes(opportunity.action))
      : opportunities;
  emitProgress(settings.options, 40, `Planning ${settings.mode} changes`);
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
  const optimized = await applyBalancedOptimizationPlan({
    pkg,
    plan,
    profile: settings.profile,
    onTransformProgress: (progress) => {
      const percent = 45 + Math.round((progress.completed / progress.total) * 30);
      emitProgress(settings.options, percent, `Transforming images ${progress.completed}/${progress.total}`);
    }
  });
  const exactOpportunities = createOptimizationOpportunitiesFromAppliedActions(optimized.applied, settings.profile);
  const output = await writeHwpxPackage(optimized.pkg);
  emitProgress(settings.options, 82, "Verifying optimized document");
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
      targetBytes: settings.options.targetBytes,
      warnings: [settings.rollbackWarning, ...(settings.warnings ?? []), ...optimized.warnings]
    });
    return { output: input, report };
  }

  const applied: AppliedAction[] = [
    ...optimized.applied,
    { type: "repack-zip", target: "*", beforeSize: input.byteLength, afterSize: output.byteLength }
  ];
  const combinedWarnings = [...(settings.warnings ?? []), ...optimized.warnings];
  const report = createOptimizationReport({
    analysis,
    originalSize: input.byteLength,
    optimizedSize: output.byteLength,
    planned: plan.actions,
    applied,
    skipped: optimized.skipped,
    opportunities: exactOpportunities.length > 0 ? exactOpportunities : opportunities,
    targetBytes: settings.options.targetBytes,
    warnings: combinedWarnings.length > 0 ? combinedWarnings : undefined
  });
  return { output, report };
}

function chooseBestCandidate(
  previous: { output: Buffer; report: OptimizationReport; targetMet: boolean } | undefined,
  candidate: { output: Buffer; report: OptimizationReport }
): { output: Buffer; report: OptimizationReport; targetMet: boolean } {
  const targetMet = candidate.report.targetStatus === "met" || candidate.report.targetStatus === "already-under-target";
  const current = { ...candidate, targetMet };
  if (!previous) return current;
  if (current.targetMet && !previous.targetMet) return current;
  if (current.targetMet === previous.targetMet && current.output.byteLength < previous.output.byteLength) return current;
  return previous;
}

function createTargetProfileLadder(
  mode: "balanced" | "aggressive",
  base: ImageOptimizationProfile,
  targetBytes?: number
): ImageOptimizationProfile[] {
  if (!targetBytes) return [base];
  if (mode === "balanced") {
    return [
      base,
      { ...base, maxEdge: 1600, jpegQuality: 84, forceJpegRecompress: true },
      { ...base, maxEdge: 1440, jpegQuality: 80, forceJpegRecompress: true },
      { ...base, maxEdge: 1280, jpegQuality: 76, forceJpegRecompress: true }
    ];
  }
  return [
    base,
    { ...base, maxEdge: 1120, jpegQuality: 74, forceJpegRecompress: true, pngPalette: true },
    { ...base, maxEdge: 960, jpegQuality: 68, forceJpegRecompress: true, pngPalette: true },
    { ...base, maxEdge: 800, jpegQuality: 62, forceJpegRecompress: true, pngPalette: true }
  ];
}

function createOptimizationOpportunitiesFromAppliedActions(
  actions: AppliedAction[],
  profile: ImageOptimizationProfile = balancedImageProfile
): OptimizationOpportunity[] {
  const opportunities: OptimizationOpportunity[] = [];
  for (const action of actions) {
    const opportunity = createOptimizationOpportunityFromAppliedAction(action, profile);
    if (opportunity) opportunities.push(opportunity);
  }
  return opportunities.sort((left, right) => right.estimatedSavingBytes - left.estimatedSavingBytes);
}

function createOptimizationOpportunityFromAppliedAction(
  action: AppliedAction,
  profile: ImageOptimizationProfile = balancedImageProfile
): OptimizationOpportunity | null {
  if (action.beforeSize === undefined || action.afterSize === undefined) return null;
  const estimatedSavingBytes = action.beforeSize - action.afterSize;
  if (estimatedSavingBytes <= 0) return null;

  if (action.type === "strip-metadata" || action.type === "optimize-png") {
    return {
      id: `${action.type}:${action.target}`,
      label:
        action.type === "strip-metadata"
          ? "Strip JPEG XMP/IPTC/comment metadata"
          : profile.pngPalette
            ? "Optimize PNG with aggressive palette reduction"
            : "Optimize PNG losslessly",
      action: action.type,
      target: action.target,
      estimatedSavingBytes,
      beforeSize: action.beforeSize,
      afterSize: action.afterSize,
      confidence: "exact",
      risk: action.type === "optimize-png" && profile.pngPalette ? "medium" : "safe",
      visualImpact: action.type === "optimize-png" && profile.pngPalette ? "low" : "none",
      defaultEnabledIn: action.type === "optimize-png" && profile.pngPalette ? ["aggressive"] : ["safe", "balanced", "aggressive"]
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
  options: OptimizeOptions = {}
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
