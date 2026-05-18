import {
  analyzeHwpxBuffer,
  optimizeHwpxBufferAggressive,
  optimizeHwpxBufferBalanced,
  optimizeHwpxBufferSafe
} from "./optimize.js";
import { nowMs } from "./performance.js";
import type { AppliedAction, OptimizationReport, PerformanceSummary } from "./types.js";

export type RegressionCorpusCase = {
  name: string;
  input: Buffer;
  mode: "analyze" | "safe" | "balanced" | "aggressive" | "reject";
  targetBytes?: number;
  actions?: string[];
  allowLarger?: boolean;
  requiredActions?: AppliedAction["type"][];
  minSavedBytes?: number;
  minSavedPercent?: number;
  maxOutputBytes?: number;
  expectedTargetStatus?: OptimizationReport["targetStatus"];
  expectedErrorIncludes?: string;
  maxTotalMs?: number;
  maxStageMs?: Record<string, number>;
};

export type RegressionCorpusResult = {
  name: string;
  mode: RegressionCorpusCase["mode"];
  passed: boolean;
  rejected: boolean;
  failures: string[];
  durationMs: number;
  outputBytes?: number;
  report?: OptimizationReport;
  error?: string;
};

export type RegressionCorpusSummary = {
  passed: boolean;
  total: number;
  failed: number;
  results: RegressionCorpusResult[];
};

export async function evaluateRegressionCorpus(cases: RegressionCorpusCase[]): Promise<RegressionCorpusSummary> {
  const results: RegressionCorpusResult[] = [];
  for (const item of cases) {
    results.push(await evaluateRegressionCase(item));
  }
  const failed = results.filter((result) => !result.passed).length;
  return {
    passed: failed === 0,
    total: results.length,
    failed,
    results
  };
}

async function evaluateRegressionCase(item: RegressionCorpusCase): Promise<RegressionCorpusResult> {
  const startedAt = nowMs();
  const failures: string[] = [];
  try {
    const result = await runCase(item);
    if (item.mode === "reject") {
      failures.push("Expected rejection, but processing succeeded.");
    }
    if (result.report) {
      failures.push(...validateReportExpectations(item, result.report, result.outputBytes));
    }
    return buildResult(item, failures, startedAt, {
      rejected: false,
      outputBytes: result.outputBytes,
      report: result.report
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (item.mode !== "reject") {
      failures.push(message);
      return buildResult(item, failures, startedAt, { rejected: false, error: message });
    }
    if (item.expectedErrorIncludes && !message.includes(item.expectedErrorIncludes)) {
      failures.push(`Expected rejection to include "${item.expectedErrorIncludes}", but got "${message}".`);
    }
    return buildResult(item, failures, startedAt, { rejected: true, error: message });
  }
}

async function runCase(item: RegressionCorpusCase): Promise<{ outputBytes?: number; report: OptimizationReport }> {
  if (item.mode === "analyze" || item.mode === "reject") {
    const report = await analyzeHwpxBuffer(item.input, { targetBytes: item.targetBytes });
    return { report };
  }
  if (item.mode === "safe") {
    const result = await optimizeHwpxBufferSafe(item.input, { targetBytes: item.targetBytes });
    return { outputBytes: result.output.byteLength, report: result.report };
  }
  const options = {
    targetBytes: item.targetBytes,
    actions: item.actions,
    allowLarger: item.allowLarger
  };
  const result =
    item.mode === "aggressive"
      ? await optimizeHwpxBufferAggressive(item.input, options)
      : await optimizeHwpxBufferBalanced(item.input, options);
  return { outputBytes: result.output.byteLength, report: result.report };
}

function validateReportExpectations(
  item: RegressionCorpusCase,
  report: OptimizationReport,
  outputBytes: number | undefined
): string[] {
  const failures: string[] = [];
  const applied = new Set(report.actions.applied.map((action) => action.type));
  for (const requiredAction of item.requiredActions ?? []) {
    if (!applied.has(requiredAction)) failures.push(`Required action was not applied: ${requiredAction}`);
  }
  if (item.minSavedBytes !== undefined && (report.savedBytes ?? 0) < item.minSavedBytes) {
    failures.push(`Saved bytes ${report.savedBytes ?? 0} below minimum ${item.minSavedBytes}.`);
  }
  if (item.minSavedPercent !== undefined && (report.savedPercent ?? 0) < item.minSavedPercent) {
    failures.push(`Saved percent ${(report.savedPercent ?? 0).toFixed(2)} below minimum ${item.minSavedPercent}.`);
  }
  if (item.maxOutputBytes !== undefined && (outputBytes ?? report.optimizedSize ?? report.originalSize) > item.maxOutputBytes) {
    failures.push(`Output bytes ${outputBytes ?? report.optimizedSize ?? report.originalSize} exceed maximum ${item.maxOutputBytes}.`);
  }
  if (item.expectedTargetStatus !== undefined && report.targetStatus !== item.expectedTargetStatus) {
    failures.push(`Target status ${report.targetStatus ?? "none"} did not match ${item.expectedTargetStatus}.`);
  }
  failures.push(...validatePerformanceBudgets(item, report.performance));
  return failures;
}

function validatePerformanceBudgets(item: RegressionCorpusCase, performance: PerformanceSummary | undefined): string[] {
  const failures: string[] = [];
  if (!performance) {
    if (item.maxTotalMs !== undefined || item.maxStageMs !== undefined) {
      failures.push("Performance summary is missing.");
    }
    return failures;
  }
  if (item.maxTotalMs !== undefined && performance.totalMs > item.maxTotalMs) {
    failures.push(`Total time ${performance.totalMs.toFixed(1)}ms exceeds ${item.maxTotalMs}ms.`);
  }
  for (const [stageName, maxMs] of Object.entries(item.maxStageMs ?? {})) {
    const stageTotal = performance.stages
      .filter((stage) => stage.name === stageName)
      .reduce((sum, stage) => sum + stage.durationMs, 0);
    if (stageTotal > maxMs) {
      failures.push(`Stage ${stageName} took ${stageTotal.toFixed(1)}ms, above ${maxMs}ms.`);
    }
  }
  return failures;
}

function buildResult(
  item: RegressionCorpusCase,
  failures: string[],
  startedAt: number,
  details: {
    rejected: boolean;
    outputBytes?: number;
    report?: OptimizationReport;
    error?: string;
  }
): RegressionCorpusResult {
  return {
    name: item.name,
    mode: item.mode,
    passed: failures.length === 0,
    rejected: details.rejected,
    failures,
    durationMs: Math.max(0, Number((nowMs() - startedAt).toFixed(3))),
    ...(details.outputBytes !== undefined ? { outputBytes: details.outputBytes } : {}),
    ...(details.report ? { report: details.report } : {}),
    ...(details.error ? { error: details.error } : {})
  };
}
