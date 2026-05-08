import { analyzeHwpxPackage } from "./analyzer.js";
import { applySafeOptimizationPlan } from "./optimizer.js";
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
  return createAnalysisReport(analysis, input.byteLength);
}

export async function optimizeHwpxBufferSafe(input: Buffer): Promise<{
  output: Buffer;
  report: OptimizationReport;
}> {
  const pkg = await readHwpxPackage(input);
  const analysis = await analyzeHwpxPackage(pkg);
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
    skipped: optimized.skipped
  });
  return { output, report };
}
