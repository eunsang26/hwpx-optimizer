import { analyzeHwpxPackage } from "./analyzer.js";
import { applyBalancedOptimizationPlan } from "./balancedOptimizer.js";
import { applySafeOptimizationPlan } from "./optimizer.js";
import { detectOptimizationOpportunities } from "./opportunities.js";
import { createSafeOptimizationPlan } from "./planner.js";
import { createAnalysisReport, createOptimizationReport } from "./report.js";
import { buildReferenceGraph } from "./referenceGraph.js";
import { readHwpxPackage } from "./reader.js";
import { verifyHwpxOutput } from "./verifier.js";
import { writeHwpxPackage } from "./writer.js";
import type { OptimizationReport } from "./types.js";

export async function analyzeHwpxBuffer(input: Buffer): Promise<OptimizationReport> {
  const pkg = await readHwpxPackage(input);
  const analysis = await analyzeHwpxPackage(pkg);
  const opportunities = await detectOptimizationOpportunities(pkg);
  return createAnalysisReport(analysis, input.byteLength, opportunities);
}

export async function optimizeHwpxBufferSafe(input: Buffer): Promise<{
  output: Buffer;
  report: OptimizationReport;
}> {
  const pkg = await readHwpxPackage(input);
  const analysis = await analyzeHwpxPackage(pkg);
  const opportunities = await detectOptimizationOpportunities(pkg);
  const graph = buildReferenceGraph(pkg);
  const plan = createSafeOptimizationPlan({ pkg, analysis, graph });
  const optimized = await applySafeOptimizationPlan({ pkg, plan });
  const output = await writeHwpxPackage(optimized.pkg);
  await verifyHwpxOutput(output);

  if (output.byteLength >= input.byteLength) {
    const report = createOptimizationReport({
      analysis,
      originalSize: input.byteLength,
      optimizedSize: input.byteLength,
      planned: plan.actions,
      applied: [],
      skipped: [...optimized.applied, ...optimized.skipped],
      opportunities,
      warnings: ["Safe mode did not produce a smaller file; original package bytes returned."]
    });
    return { output: Buffer.from(input), report };
  }

  const report = createOptimizationReport({
    analysis,
    originalSize: input.byteLength,
    optimizedSize: output.byteLength,
    planned: plan.actions,
    applied: optimized.applied,
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
  const pkg = await readHwpxPackage(input);
  const analysis = await analyzeHwpxPackage(pkg);
  const opportunities = await detectOptimizationOpportunities(pkg);
  const selectedOpportunities =
    options.actions && options.actions.length > 0
      ? opportunities.filter((opportunity) => options.actions?.includes(opportunity.action))
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
    if (opportunity.action === "resize-jpeg") {
      return { type: "resize-jpeg" as const, target: opportunity.target, risk: "medium" as const };
    }
    return { type: opportunity.action, target: opportunity.target, risk: "safe" as const };
  });
  const plan = {
    mode: "balanced" as const,
    actions: [...actions, { type: "repack-zip" as const, target: "*" as const, risk: "safe" as const }]
  };
  const optimized = await applyBalancedOptimizationPlan({ pkg, plan });
  const output = await writeHwpxPackage(optimized.pkg);
  await verifyHwpxOutput(output);

  if (!options.allowLarger && output.byteLength >= input.byteLength) {
    const report = createOptimizationReport({
      analysis,
      originalSize: input.byteLength,
      optimizedSize: input.byteLength,
      planned: plan.actions,
      applied: [],
      skipped: [...optimized.applied, ...optimized.skipped],
      opportunities,
      warnings: ["Balanced mode did not produce a smaller file; original package bytes returned."]
    });
    return { output: Buffer.from(input), report };
  }

  const report = createOptimizationReport({
    analysis,
    originalSize: input.byteLength,
    optimizedSize: output.byteLength,
    planned: plan.actions,
    applied: optimized.applied,
    skipped: optimized.skipped,
    opportunities
  });
  return { output, report };
}
