import { analyzeHwpxPackage } from "./analyzer.js";
import { applyBalancedOptimizationPlan } from "./balancedOptimizer.js";
import { applySafeOptimizationPlan } from "./optimizer.js";
import {
  aggressiveImageProfile,
  balancedImageProfile,
  detectEstimatedOptimizationOpportunities,
  detectOptimizationOpportunities,
  JPEG_QUALITY_CEILING,
  JPEG_QUALITY_FLOOR
} from "./opportunities.js";
import type { ImageOptimizationProfile } from "./opportunities.js";
import { nowMs, PerformanceTimer } from "./performance.js";
import { createSafeOptimizationPlan } from "./planner.js";
import { projectPackageSizeFromOpportunities } from "./projectPackageSize.js";
import { createAnalysisReport, createOptimizationReport } from "./report.js";
import { buildReferenceGraph } from "./referenceGraph.js";
import { readHwpxPackage } from "./reader.js";
import { detectStructuralOptimizationOpportunities } from "./structuralOpportunities.js";
import { verifyHwpxOutput } from "./verifier.js";
import { writeHwpxPackage } from "./writer.js";
import type { AppliedAction, HwpxPackage, OptimizationOpportunity, OptimizationReport, PackageAnalysis } from "./types.js";

export type OptimizeProgress = { percent: number; item: string };

type OptimizeProgressCallback = (progress: OptimizeProgress) => void;
type OptimizeOptions = {
  actions?: string[];
  allowLarger?: boolean;
  targetBytes?: number;
  /** Manual JPEG quality override (clamped). Skips automatic target search. */
  jpegQuality?: number;
  onProgress?: OptimizeProgressCallback;
  analysisMode?: AnalysisMode;
  imageConcurrency?: number;
};

export type { OptimizeOptions };
type SafeOptimizeOptions = {
  targetBytes?: number;
  onProgress?: OptimizeProgressCallback;
  analysisMode?: AnalysisMode;
  imageConcurrency?: number;
};
type AnalysisMode = "quick" | "deep";

/** Aggressive auto runs at the JPEG quality floor — project sizes with that encode. */
const aggressiveProjectionProfile: ImageOptimizationProfile = {
  ...aggressiveImageProfile,
  jpegQuality: JPEG_QUALITY_FLOOR,
  // Keep in sync with maxEdgeForJpegQuality(JPEG_QUALITY_FLOOR, "aggressive").
  maxEdge: 800,
  forceJpegRecompress: true
};

export async function analyzeHwpxBuffer(
  input: Buffer,
  options: { targetBytes?: number; analysisMode?: AnalysisMode; imageConcurrency?: number } = {}
): Promise<OptimizationReport> {
  const timer = new PerformanceTimer();
  const targetBytes = normalizeTargetBytes(options.targetBytes);
  const pkg = await timer.measure("read", () => readHwpxPackage(input));
  const analysis = await timer.measure("analyze", () =>
    analyzeHwpxPackage(pkg, { ...analysisOptions(options.analysisMode ?? "quick"), imageConcurrency: options.imageConcurrency })
  );
  const duplicateMode = options.analysisMode === "quick" ? "byte" : "visual";
  const opportunityOptions = {
    duplicateMode: duplicateMode as "byte" | "visual",
    imageConcurrency: options.imageConcurrency
  };
  // Measure real encode sizes (exact) so UI projections match optimize output.
  const structuralOpportunities = await timer.measure("opportunities-structure", () =>
    detectStructuralOptimizationOpportunities(pkg, analysis, {
      imageConcurrency: options.imageConcurrency
    })
  );
  const opportunities = [
    ...structuralOpportunities,
    ...await timer.measure("opportunities", () =>
      detectOptimizationOpportunities(pkg, balancedImageProfile, opportunityOptions)
    )
  ];
  const aggressiveOpportunities = [
    ...structuralOpportunities,
    ...await timer.measure("opportunities-aggressive", () =>
      detectOptimizationOpportunities(pkg, aggressiveProjectionProfile, opportunityOptions)
    )
  ];
  const projectedOptimizedSize = projectPackageSizeFromOpportunities(pkg, opportunities);
  const aggressiveProjectedOptimizedSize = projectPackageSizeFromOpportunities(pkg, aggressiveOpportunities, {
    palettePng: true
  });
  return createReportWithPerformance(timer, () =>
    createAnalysisReport(analysis, input.byteLength, opportunities, {
      targetBytes,
      projectedOptimizedSize,
      aggressiveProjectedOptimizedSize
    })
  );
}

export async function optimizeHwpxBufferSafe(input: Buffer, options: SafeOptimizeOptions = {}): Promise<{
  output: Buffer;
  report: OptimizationReport;
}> {
  const targetBytes = normalizeTargetBytes(options.targetBytes);
  const timer = new PerformanceTimer();
  emitProgress(options, 25, "Analyzing document structure");
  const pkg = await timer.measure("read", () => readHwpxPackage(input));
  const analysis = await timer.measure("analyze", () =>
    analyzeHwpxPackage(pkg, { ...analysisOptions(options.analysisMode ?? "quick"), imageConcurrency: options.imageConcurrency })
  );
  const graph = analysis.referenceGraph ?? buildReferenceGraph(pkg);
  emitProgress(options, 40, "Planning safe changes");
  const plan = measureSync(timer, "plan", () => createSafeOptimizationPlan({ pkg, analysis, graph }));
  emitProgress(options, 52, "Applying safe document cleanup");
  const optimized = await timer.measure("apply", () =>
    applySafeOptimizationPlan({ pkg, plan, imageConcurrency: options.imageConcurrency })
  );
  const opportunities = createOptimizationOpportunitiesFromAppliedActions(optimized.applied);
  emitProgress(options, 72, "Packing optimized document");
  const output = await timer.measure("write", () =>
    writeHwpxPackage(optimized.pkg, { compressionLevel: writeCompressionLevel(targetBytes) })
  );
  emitProgress(options, 82, "Verifying optimized document");
  await timer.measure("verify", () =>
    verifyHwpxOutput(output, {
      original: input,
      mode: "safe",
      originalPackage: pkg,
      originalAnalysis: analysis,
      imageConcurrency: options.imageConcurrency
    })
  );

  if (output.byteLength >= input.byteLength) {
    const report = createReportWithPerformance(timer, () => createOptimizationReport({
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
    }));
    return { output: input, report };
  }

  const applied: AppliedAction[] = [
    ...optimized.applied,
    { type: "repack-zip", target: "*", beforeSize: input.byteLength, afterSize: output.byteLength }
  ];
  const report = createReportWithPerformance(timer, () => createOptimizationReport({
    analysis,
    originalSize: input.byteLength,
    optimizedSize: output.byteLength,
    planned: plan.actions,
    applied,
    skipped: optimized.skipped,
    opportunities,
    targetBytes,
    warnings: optimized.warnings.length > 0 ? optimized.warnings : undefined
  }));
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
  const timer = new PerformanceTimer();
  emitProgress(options, 25, "Analyzing document structure");
  const pkg = await timer.measure("read", () => readHwpxPackage(input));
  const analysis = await timer.measure("analyze", () =>
    analyzeHwpxPackage(pkg, { ...analysisOptions(options.analysisMode ?? "quick"), imageConcurrency: options.imageConcurrency })
  );
  const verificationWarnings: string[] = [];
  const runProfile = async (profile: ImageOptimizationProfile) => {
    try {
      return await optimizeHwpxBufferWithProfile(input, {
        ...settings,
        options,
        pkg,
        analysis,
        timer,
        profile,
        warnings: [...(settings.warnings ?? []), ...verificationWarnings]
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      verificationWarnings.push(`Candidate profile skipped after verification failure: ${message}`);
      return undefined;
    }
  };

  // Aggressive ("size first"): always the quality floor — ignore manual jpegQuality.
  if (settings.mode === "aggressive") {
    const candidate = await runProfile(
      profileForJpegQuality(settings.profile, JPEG_QUALITY_FLOOR, "aggressive")
    );
    if (candidate) return candidate;
    throw new Error(
      `No verified optimization candidate could be produced.${
        verificationWarnings.length > 0 ? ` ${verificationWarnings.join(" ")}` : ""
      }`
    );
  }

  // Manual quality: single shot.
  if (options.jpegQuality !== undefined) {
    const candidate = await runProfile(profileForJpegQuality(settings.profile, options.jpegQuality, "balanced"));
    if (candidate) return candidate;
    throw new Error(
      `No verified optimization candidate could be produced.${
        verificationWarnings.length > 0 ? ` ${verificationWarnings.join(" ")}` : ""
      }`
    );
  }

  // No target: base balanced profile only.
  if (!options.targetBytes) {
    const candidate = await runProfile(settings.profile);
    if (candidate) return candidate;
    throw new Error(
      `No verified optimization candidate could be produced.${
        verificationWarnings.length > 0 ? ` ${verificationWarnings.join(" ")}` : ""
      }`
    );
  }

  // Balanced + target: binary-search the highest JPEG quality that meets the target.
  // Range is the full [floor, ceiling] so a loose target can keep quality above the
  // balanced default (88). Try the balanced default first to short-circuit common cases.
  const baseQuality = clampJpegQuality(settings.profile.jpegQuality);
  const baseCandidate = await runProfile(profileForJpegQuality(settings.profile, baseQuality, "balanced"));
  let best: { output: Buffer; report: OptimizationReport; targetMet: boolean } | undefined;
  if (baseCandidate) {
    best = chooseBestCandidate(undefined, baseCandidate, options.targetBytes);
  }

  let lo: number;
  let hi: number;
  if (best?.targetMet) {
    // Already meets at baseline — only search upward for higher quality that still fits.
    lo = baseQuality + 1;
    hi = JPEG_QUALITY_CEILING;
  } else {
    // Misses at baseline — search downward for the highest quality that can meet.
    lo = JPEG_QUALITY_FLOOR;
    hi = baseQuality - 1;
  }

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate = await runProfile(profileForJpegQuality(settings.profile, mid, "balanced"));
    if (!candidate) {
      hi = mid - 1;
      continue;
    }
    best = chooseBestCandidate(best, candidate, options.targetBytes);
    if (candidateMeetsTarget(candidate.output.byteLength, options.targetBytes)) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  // Binary search only samples log(n) qualities; when still unmet, force the floor
  // so the reported plan settles on the strongest remaining candidate.
  if (!best?.targetMet) {
    const floorCandidate = await runProfile(profileForJpegQuality(settings.profile, JPEG_QUALITY_FLOOR, "balanced"));
    if (floorCandidate) best = chooseBestCandidate(best, floorCandidate, options.targetBytes);
  }

  if (best) return best;
  const suffix = verificationWarnings.length > 0 ? ` ${verificationWarnings.join(" ")}` : "";
  throw new Error(`No verified optimization candidate could be produced.${suffix}`);
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
    pkg: HwpxPackage;
    analysis: PackageAnalysis;
    timer: PerformanceTimer;
    profile: ImageOptimizationProfile;
    rollbackWarning: string;
    warnings?: string[];
  }
): Promise<{
  output: Buffer;
  report: OptimizationReport;
}> {
  const pkg = settings.pkg;
  const analysis = settings.analysis;
  const opportunities = [
    ...await detectStructuralOptimizationOpportunities(pkg, analysis, {
      imageConcurrency: settings.options.imageConcurrency
    }),
    ...await settings.timer.measure("opportunities", () =>
      detectEstimatedOptimizationOpportunities(pkg, settings.profile, {
        imageConcurrency: settings.options.imageConcurrency
      })
    )
  ];
  const selectedOpportunities =
    settings.options.actions !== undefined
      ? opportunities.filter((opportunity) => settings.options.actions?.includes(opportunity.action))
      : opportunities;
  emitProgress(settings.options, 40, `Planning ${settings.mode} changes`);
  const actions = measureSync(settings.timer, "plan", () => selectedOpportunities.map((opportunity) => {
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
  }));
  const plan = {
    mode: settings.mode,
    actions: [...actions, { type: "repack-zip" as const, target: "*" as const, risk: "safe" as const }]
  };
  emitProgress(settings.options, 45, `Applying ${settings.mode} changes`);
  const optimized = await settings.timer.measure("apply", () => applyBalancedOptimizationPlan({
    pkg,
    plan,
    profile: settings.profile,
    imageConcurrency: settings.options.imageConcurrency,
    onTransformProgress: (progress) => {
      const percent = 45 + Math.round((progress.completed / progress.total) * 30);
      emitProgress(settings.options, percent, `Transforming images ${progress.completed}/${progress.total}`);
    }
  }));
  const exactOpportunities = createOptimizationOpportunitiesFromAppliedActions(optimized.applied, settings.profile);
  emitProgress(settings.options, 76, "Packing optimized document");
  const output = await settings.timer.measure("write", () =>
    writeHwpxPackage(optimized.pkg, { compressionLevel: writeCompressionLevel(settings.options.targetBytes) })
  );
  emitProgress(settings.options, 82, "Verifying optimized document");
  await settings.timer.measure("verify", () =>
    verifyHwpxOutput(output, {
      original: input,
      mode: settings.mode,
      originalPackage: pkg,
      originalAnalysis: analysis,
      imageConcurrency: settings.options.imageConcurrency
    })
  );

  if (!settings.options.allowLarger && output.byteLength >= input.byteLength) {
    const report = createReportWithPerformance(settings.timer, () => createOptimizationReport({
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
      plannedJpegQuality: settings.profile.jpegQuality,
      warnings: [settings.rollbackWarning, ...(settings.warnings ?? []), ...optimized.warnings]
    }));
    return { output: input, report };
  }

  const applied: AppliedAction[] = [
    ...optimized.applied,
    { type: "repack-zip", target: "*", beforeSize: input.byteLength, afterSize: output.byteLength }
  ];
  const combinedWarnings = [...(settings.warnings ?? []), ...optimized.warnings];
  const report = createReportWithPerformance(settings.timer, () => createOptimizationReport({
    analysis,
    originalSize: input.byteLength,
    optimizedSize: output.byteLength,
    planned: plan.actions,
    applied,
    skipped: optimized.skipped,
    opportunities: exactOpportunities.length > 0 ? exactOpportunities : opportunities,
    targetBytes: settings.options.targetBytes,
    plannedJpegQuality: settings.profile.jpegQuality,
    warnings: combinedWarnings.length > 0 ? combinedWarnings : undefined
  }));
  return { output, report };
}

function analysisOptions(mode: AnalysisMode): Parameters<typeof analyzeHwpxPackage>[1] {
  if (mode === "deep") return {};
  return {
    includeSameVisualDuplicateImages: false,
    includeNearDuplicateImages: false
  };
}

function measureSync<T>(timer: PerformanceTimer, name: string, operation: () => T): T {
  const startedAt = nowMs();
  try {
    return operation();
  } finally {
    timer.mark(name, startedAt);
  }
}

function createReportWithPerformance<T extends OptimizationReport>(
  timer: PerformanceTimer,
  createReport: () => T
): T {
  const report = measureSync(timer, "report", createReport);
  return { ...report, performance: timer.summary() };
}

function writeCompressionLevel(targetBytes: number | undefined): number {
  return targetBytes ? 9 : 6;
}

function chooseBestCandidate(
  previous: { output: Buffer; report: OptimizationReport; targetMet: boolean } | undefined,
  candidate: { output: Buffer; report: OptimizationReport },
  targetBytes: number | undefined
): { output: Buffer; report: OptimizationReport; targetMet: boolean } {
  const targetMet = candidateMeetsTarget(candidate.output.byteLength, targetBytes);
  const current = { ...candidate, targetMet };
  if (!previous) return current;
  if (current.targetMet && !previous.targetMet) return current;
  if (!current.targetMet && previous.targetMet) return previous;
  if (current.targetMet && previous.targetMet && targetBytes) {
    const currentDistance = targetBytes - current.output.byteLength;
    const previousDistance = targetBytes - previous.output.byteLength;
    if (currentDistance >= 0 && currentDistance < previousDistance) return current;
    return previous;
  }
  if (current.targetMet === previous.targetMet && current.output.byteLength < previous.output.byteLength) return current;
  return previous;
}

function candidateMeetsTarget(outputBytes: number, targetBytes: number | undefined): boolean {
  return targetBytes !== undefined && outputBytes < targetBytes;
}

function clampJpegQuality(value: number): number {
  if (!Number.isFinite(value)) return JPEG_QUALITY_FLOOR;
  return Math.max(JPEG_QUALITY_FLOOR, Math.min(JPEG_QUALITY_CEILING, Math.round(value)));
}

function maxEdgeForJpegQuality(quality: number, mode: "balanced" | "aggressive"): number {
  const q = clampJpegQuality(quality);
  if (mode === "aggressive") {
    // 95 → 1280, 60 → 800
    const t = (JPEG_QUALITY_CEILING - q) / (JPEG_QUALITY_CEILING - JPEG_QUALITY_FLOOR);
    return Math.round(1280 - t * (1280 - 800));
  }
  // 95 → 1920, 60 → 1280
  const t = (JPEG_QUALITY_CEILING - q) / (JPEG_QUALITY_CEILING - JPEG_QUALITY_FLOOR);
  return Math.round(1920 - t * (1920 - 1280));
}

function profileForJpegQuality(
  base: ImageOptimizationProfile,
  quality: number,
  mode: "balanced" | "aggressive"
): ImageOptimizationProfile {
  const jpegQuality = clampJpegQuality(quality);
  return {
    ...base,
    jpegQuality,
    maxEdge: maxEdgeForJpegQuality(jpegQuality, mode),
    pngCompressionLevel: 9,
    forceJpegRecompress: jpegQuality < base.jpegQuality || mode === "aggressive",
    pngPalette: mode === "aggressive" ? true : base.pngPalette
  };
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

  if (action.type === "minify-xml" || action.type === "remove-unused") {
    return {
      id: `${action.type}:${action.target}`,
      label: action.type === "minify-xml" ? "Minify document XML" : "Remove unused BinData",
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
