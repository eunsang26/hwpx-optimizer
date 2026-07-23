#!/usr/bin/env node

import { constants, realpathSync } from "node:fs";
import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  analyzeHwpxBuffer,
  estimateNonOverlappingSavingBytes,
  mapLimit,
  verifyHwpxOutput
} from "@hwpx-optimizer/core";
import type { AppliedAction, OptimizationReport } from "@hwpx-optimizer/core";
import { ACTION_CATALOG, optimizeByMode, parsePositiveNumber, parseTargetBytes } from "./optimizeByMode.js";
import type { OptimizationMode } from "./optimizeByMode.js";

export { ACTION_CATALOG, optimizeByMode, parsePositiveNumber, parseTargetBytes } from "./optimizeByMode.js";
export type { OptimizationMode, OptimizeByModeOptions } from "./optimizeByMode.js";

const DEFAULT_MAX_HWPX_INPUT_BYTES = 512 * 1024 * 1024;

export async function runCli(argv: string[]): Promise<number> {
  const [command, inputPath, ...rest] = argv;
  if (command === "list-actions") {
    printActionList();
    return 0;
  }
  if (!command || !inputPath) {
    printUsage();
    return 1;
  }

  try {
    const options = parseOptions(command, rest);
    if (command === "analyze") {
      const report = await analyzeHwpxBuffer(await readSupportedInput(inputPath, options), {
        targetBytes: parseTargetBytes(options),
        analysisMode: parseAnalysisMode(options["analysis-mode"])
      });
      const requestedReportPath = options.report ?? `${inputPath}.report.json`;
      const reportPath =
        options.overwrite === "true" ? requestedReportPath : await nextAvailablePath(requestedReportPath);
      assertDoesNotTargetInput(reportPath, inputPath, "report");
      await writeFile(reportPath, JSON.stringify(report, null, 2));
      console.log(`Analyzed ${inputPath}`);
      printAnalysisSummary(inputPath, report);
      console.log(`Report: ${reportPath}`);
      return 0;
    }

    if (command === "report") {
      const report = await analyzeHwpxBuffer(await readSupportedInput(inputPath, options), {
        targetBytes: parseTargetBytes(options),
        analysisMode: parseAnalysisMode(options["analysis-mode"])
      });
      const text = renderHumanReport(inputPath, report);
      const requestedReportPath = options.report ?? options.out ?? `${inputPath}.report.txt`;
      const reportPath =
        options.overwrite === "true" ? requestedReportPath : await nextAvailablePath(requestedReportPath);
      assertDoesNotTargetInput(reportPath, inputPath, "report");
      await writeFile(reportPath, text);
      console.log(text);
      console.log(`Report: ${reportPath}`);
      return 0;
    }

    if (command === "verify") {
      await verifyHwpxOutput(await readSupportedInput(inputPath, options));
      console.log(`Verified: ${inputPath}`);
      return 0;
    }

    if (command === "batch") {
      const summary = await runBatch(inputPath, options);
      console.log(`Batch complete: ${summary.optimized} optimized, ${summary.failed} failed`);
      console.log(`Report: ${summary.reportPath}`);
      return summary.failed > 0 ? 1 : 0;
    }

    if (command === "optimize") {
      const mode = options.mode ?? "safe";
      if (!isOptimizationMode(mode)) {
        console.error("Only --mode safe, --mode balanced, and --mode aggressive are supported");
        return 1;
      }
      const input = await readSupportedInput(inputPath, options);
      const result = await optimizeByMode(input, mode, options);
      const overwrite = options.overwrite === "true";
      const requestedOutputPath = options.out ?? defaultOutputPath(inputPath);
      const outputPath = overwrite ? requestedOutputPath : await nextAvailablePath(requestedOutputPath);
      assertDoesNotTargetInput(outputPath, inputPath, "output");
      const requestedReportPath = options.report ?? `${outputPath}.report.json`;
      const reportPath = overwrite ? requestedReportPath : await nextAvailablePath(requestedReportPath);
      assertDoesNotTargetInput(reportPath, inputPath, "report");
      await writeOptimizationArtifacts(outputPath, result.output, reportPath, JSON.stringify(result.report, null, 2));
      console.log(`Optimized ${inputPath}`);
      printOptimizationSummary(result.report);
      console.log(`Output: ${outputPath}`);
      console.log(`Report: ${reportPath}`);
      return 0;
    }

    printUsage();
    return 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function parseOptions(command: string, args: string[]): Record<string, string> {
  const options: Record<string, string> = {};
  const valueFlags = valueOptionFlags(command);
  const booleanFlags = new Set(["allow-larger", "overwrite"]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    if (valueFlags.has(key)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for --${key}.`);
      }
      options[key] = value;
      index += 1;
    } else if (booleanFlags.has(key)) {
      options[key] = "true";
    } else {
      throw new Error(`Unknown option --${key}.`);
    }
  }
  return options;
}

function valueOptionFlags(command: string): Set<string> {
  const common = ["target-bytes", "target-mb", "max-input-bytes"];
  if (command === "analyze") return new Set([...common, "report", "analysis-mode"]);
  if (command === "report") return new Set([...common, "report", "out", "analysis-mode"]);
  if (command === "verify") return new Set(["max-input-bytes"]);
  if (command === "optimize") return new Set([...common, "mode", "actions", "out", "report"]);
  if (command === "batch") {
    return new Set([...common, "batch-target-bytes", "batch-target-mb", "mode", "actions", "out", "jobs"]);
  }
  return new Set();
}

function defaultOutputPath(inputPath: string): string {
  const name = basename(inputPath, ".hwpx");
  return join(dirname(inputPath), `${name}.optimized.hwpx`);
}

async function nextAvailablePath(path: string): Promise<string> {
  if (!(await pathExists(path))) return path;
  const ext = extname(path);
  const base = path.slice(0, path.length - ext.length);
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}-${index}${ext}`;
    if (!(await pathExists(candidate))) return candidate;
  }
  throw new Error(`Could not create a non-overwriting output path for ${path}`);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readSupportedInput(path: string, options: Record<string, string>): Promise<Buffer> {
  await assertSupportedLocalInput(path, options);
  return readFile(path);
}

async function assertSupportedLocalInput(path: string, options: Record<string, string>): Promise<void> {
  const maxInputBytes = parseMaxInputBytes(options["max-input-bytes"]);
  const { size } = await stat(path);
  if (size > maxInputBytes) {
    throw new Error(
      `${path} exceeds the supported local processing limit (${size} bytes; limit ${maxInputBytes} bytes).`
    );
  }
}

function parseMaxInputBytes(value: string | undefined): number {
  if (!value) return DEFAULT_MAX_HWPX_INPUT_BYTES;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("--max-input-bytes must be a positive number.");
  }
  return Math.floor(parsed);
}

function parseBatchTargetBytes(options: Record<string, string>): number | undefined {
  const hasBatchBytes = options["batch-target-bytes"] !== undefined;
  const hasBatchMb = options["batch-target-mb"] !== undefined;
  if (hasBatchBytes && hasBatchMb) {
    throw new Error("Use only one of --batch-target-bytes or --batch-target-mb.");
  }
  if ((hasBatchBytes || hasBatchMb) && (options["target-bytes"] !== undefined || options["target-mb"] !== undefined)) {
    throw new Error("Use per-file target options or aggregate batch target options, not both.");
  }
  if (hasBatchBytes) {
    const bytes = Math.floor(parsePositiveNumber(options["batch-target-bytes"], "--batch-target-bytes"));
    if (bytes <= 0) throw new Error("--batch-target-bytes must be a positive number.");
    return bytes;
  }
  if (hasBatchMb) {
    const bytes = Math.floor(parsePositiveNumber(options["batch-target-mb"], "--batch-target-mb") * 1024 * 1024);
    if (bytes <= 0) throw new Error("--batch-target-mb must be at least one byte.");
    return bytes;
  }
  return undefined;
}

function parseAnalysisMode(value: string | undefined): "quick" | "deep" | undefined {
  if (value === undefined) return undefined;
  if (value === "quick" || value === "deep") return value;
  throw new Error("--analysis-mode must be quick or deep.");
}

function assertDoesNotTargetInput(targetPath: string, inputPath: string, kind: "output" | "report"): void {
  if (pathsReferToSameFile(targetPath, inputPath)) {
    throw new Error(`Refusing to overwrite the original input file with ${kind}.`);
  }
}

function pathsReferToSameFile(left: string, right: string): boolean {
  if (resolve(left) === resolve(right)) return true;
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return false;
  }
}

function printUsage(): void {
  console.error("Usage:");
  console.error("  hwpx-opt analyze <file.hwpx> [--report report.json] [--analysis-mode quick|deep] [--target-bytes bytes|--target-mb mb] [--max-input-bytes bytes]");
  console.error("  hwpx-opt report <file.hwpx> [--report report.txt|--out report.txt] [--analysis-mode quick|deep] [--target-bytes bytes|--target-mb mb] [--max-input-bytes bytes]");
  console.error("  hwpx-opt verify <file.hwpx> [--max-input-bytes bytes]");
  console.error("  hwpx-opt optimize <file.hwpx> --mode safe|balanced|aggressive [--target-bytes bytes|--target-mb mb] [--actions action1,action2] [--allow-larger] [--overwrite] [--out output.hwpx] [--report report.json] [--max-input-bytes bytes]");
  console.error("  hwpx-opt batch <directory> --mode safe|balanced|aggressive [--target-bytes bytes|--target-mb mb] [--batch-target-bytes bytes|--batch-target-mb mb] [--actions action1,action2] [--allow-larger] [--overwrite] [--out output-directory] [--jobs count] [--max-input-bytes bytes]");
  console.error("  hwpx-opt list-actions");
}

function printActionList(): void {
  console.log("Available --actions keys:");
  for (const item of ACTION_CATALOG) {
    console.log(`- ${item.action}`);
    console.log(`    ${item.description}`);
    console.log(`    modes: ${item.modes} | risk: ${item.risk} | visual impact: ${item.visualImpact}`);
  }
}

function printAnalysisSummary(inputPath: string, report: OptimizationReport): void {
  console.log(`Original: ${formatBytes(report.originalSize)}`);
  printTargetSummary(report);
  if (report.opportunityGroups.length === 0) {
    console.log("Opportunities: none");
    return;
  }

  console.log(`Potential saving (non-overlap): ${formatBytes(estimateNonOverlappingSavingBytes(report.opportunityGroups))}`);
  console.log("Opportunities:");
  for (const group of report.opportunityGroups) {
    console.log(
      `- ${group.action}: ${formatTargetCount(group.count)}, ~${formatBytes(group.estimatedSavingBytes)} potential saving`
    );
  }
  console.log(`Suggested: hwpx-opt optimize ${inputPath} --mode balanced`);
}

export const printAnalysisSummaryForTest = printAnalysisSummary;

function printOptimizationSummary(report: OptimizationReport): void {
  const savedBytes = report.savedBytes ?? 0;
  const savedPercent = report.savedPercent ?? 0;
  console.log(`Saved: ${formatBytes(savedBytes)} (${savedPercent.toFixed(2)}%)`);
  printTargetSummary(report);

  const counts = countAppliedActions(report.actions.applied);
  if (counts.length === 0) {
    console.log("Applied: none");
    return;
  }

  console.log(`Applied: ${counts.map(([type, count]) => `${type} ${count}`).join(", ")}`);
}

async function runBatch(
  inputDir: string,
  options: Record<string, string>
): Promise<{ optimized: number; failed: number; reportPath: string }> {
  const mode = options.mode ?? "safe";
  if (!isOptimizationMode(mode)) {
    throw new Error("Only --mode safe, --mode balanced, and --mode aggressive are supported");
  }
  const outputDir = options.out ?? join(inputDir, "optimized");
  const overwrite = options.overwrite === "true";
  await mkdir(outputDir, { recursive: true });
  const batchTargetBytes = parseBatchTargetBytes(options);

  const files = (await readdir(inputDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.hwpx$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const inputPaths = files.map((file) => join(inputDir, file));
  if (batchTargetBytes !== undefined && files.length > batchTargetBytes) {
    throw new Error("--batch-target-bytes must allow at least one byte per HWPX file.");
  }
  const originalSizeByFile = await readBatchOriginalSizes(inputDir, files);
  const targetByFile = batchTargetBytes
    ? allocateBatchTargetBytes(files, originalSizeByFile, batchTargetBytes)
    : new Map<string, number>();
  const jobs = parseBatchJobs(options.jobs);
  const results = new Array<BatchFileResult>(files.length);
  const startedAt = Date.now();

  await mapLimit([...files.entries()], jobs, async ([index, file]) => {
    const sourcePath = join(inputDir, file);
    const progressPrefix = `[${index + 1}/${files.length}] ${file}`;
    let stage: BatchFailureStage = "read-input";
    try {
      const buffer = await readSupportedInput(sourcePath, options);
      stage = "optimize";
      const result = await optimizeByMode(buffer, mode, options, targetByFile.get(file));
      stage = "resolve-output-path";
      const requestedOutputPath = join(outputDir, `${basename(file, ".hwpx")}.optimized.hwpx`);
      const outputPath = overwrite ? requestedOutputPath : await nextAvailablePath(requestedOutputPath);
      const requestedReportPath = `${outputPath}.report.json`;
      const reportPath = overwrite ? requestedReportPath : await nextAvailablePath(requestedReportPath);
      assertDoesNotTargetAnyInput(outputPath, inputPaths, "output");
      assertDoesNotTargetAnyInput(reportPath, inputPaths, "report");
      stage = "write-output";
      await writeOptimizationArtifacts(outputPath, result.output, reportPath, JSON.stringify(result.report, null, 2));
      const savedBytes = result.report.savedBytes ?? 0;
      const savedPercent = result.report.savedPercent ?? 0;
      results[index] = {
        input: file,
        status: "optimized",
        output: outputPath,
        report: reportPath,
        originalSize: result.report.originalSize,
        optimizedSize: result.report.optimizedSize ?? result.output.byteLength,
        savedBytes,
        savedPercent
      };
      console.log(`${progressPrefix} optimized -${formatBytes(savedBytes)} (${savedPercent.toFixed(2)}%)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results[index] = { input: file, status: "failed", stage, error: message };
      console.error(`${progressPrefix} failed at ${stage}: ${message}`);
    }
  });
  const completedResults = results.filter((result): result is BatchFileResult => Boolean(result));

  const requestedBatchReportPath = join(outputDir, "batch-report.json");
  const reportPath = overwrite ? requestedBatchReportPath : await nextAvailablePath(requestedBatchReportPath);
  const optimizedCount = completedResults.filter((result) => result.status === "optimized").length;
  const failedCount = completedResults.filter((result) => result.status === "failed").length;
  const totalSavedBytes = completedResults.reduce(
    (sum, result) => sum + (result.status === "optimized" ? result.savedBytes : 0),
    0
  );
  const totalOriginalSize = files.reduce((sum, file) => sum + (originalSizeByFile.get(file) ?? 0), 0);
  const totalOptimizedSize = completedResults.reduce(
    (sum, result) =>
      sum +
      (result.status === "optimized" ? result.optimizedSize : originalSizeByFile.get(result.input) ?? 0),
    0
  );
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        mode,
        inputDir,
        outputDir,
        jobs,
        elapsedMs: Date.now() - startedAt,
        totals: {
          optimized: optimizedCount,
          failed: failedCount,
          totalSavedBytes,
          totalOriginalSize,
          totalOptimizedSize,
          ...createBatchTargetFields(totalOriginalSize, totalOptimizedSize, batchTargetBytes, failedCount)
        },
        results: completedResults
      },
      null,
      2
    )
  );
  return {
    optimized: optimizedCount,
    failed: failedCount,
    reportPath
  };
}

function assertDoesNotTargetAnyInput(targetPath: string, inputPaths: string[], kind: "output" | "report"): void {
  if (inputPaths.some((inputPath) => pathsReferToSameFile(targetPath, inputPath))) {
    throw new Error(`Refusing to overwrite a batch input file with ${kind}.`);
  }
}

async function readBatchOriginalSizes(inputDir: string, files: string[]): Promise<Map<string, number>> {
  const sizes = new Map<string, number>();
  await Promise.all(
    files.map(async (file) => {
      const { size } = await stat(join(inputDir, file));
      sizes.set(file, size);
    })
  );
  return sizes;
}

function allocateBatchTargetBytes(
  files: string[],
  originalSizeByFile: Map<string, number>,
  batchTargetBytes: number
): Map<string, number> {
  const totalOriginalSize = files.reduce((sum, file) => sum + (originalSizeByFile.get(file) ?? 0), 0);
  if (totalOriginalSize <= 0) return new Map(files.map((file) => [file, 1]));
  const raw = files.map((file) => {
    const size = originalSizeByFile.get(file) ?? 0;
    const exact = (batchTargetBytes * size) / totalOriginalSize;
    return { file, bytes: Math.floor(exact), fraction: exact - Math.floor(exact) };
  });
  let allocated = raw.reduce((sum, item) => sum + item.bytes, 0);
  for (const item of [...raw].sort((left, right) => right.fraction - left.fraction)) {
    if (allocated >= batchTargetBytes) break;
    item.bytes += 1;
    allocated += 1;
  }
  return new Map(raw.map((item) => [item.file, Math.max(1, item.bytes)]));
}

function createBatchTargetFields(
  totalOriginalSize: number,
  totalOptimizedSize: number,
  batchTargetBytes: number | undefined,
  incompleteCount = 0
): {
  batchTargetBytes?: number;
  batchTargetStatus?: "met" | "missed" | "already-under-target";
  batchTargetMissReason?: string;
} {
  if (!batchTargetBytes) return {};
  if (incompleteCount > 0) {
    return {
      batchTargetBytes,
      batchTargetStatus: "missed",
      batchTargetMissReason: `Batch target status is incomplete because ${incompleteCount} file(s) failed.`
    };
  }
  if (totalOriginalSize <= batchTargetBytes) {
    return { batchTargetBytes, batchTargetStatus: "already-under-target" };
  }
  if (totalOptimizedSize <= batchTargetBytes) {
    return { batchTargetBytes, batchTargetStatus: "met" };
  }
  return {
    batchTargetBytes,
    batchTargetStatus: "missed",
    batchTargetMissReason: "No verified aggregate batch optimization result reached the target."
  };
}

export function parseBatchJobs(value: string | undefined): number {
  if (value === undefined) return Math.max(1, Math.min(availableParallelism() - 1, 4));
  if (value === "max") return Math.max(1, availableParallelism());
  const jobs = Number(value);
  if (!Number.isInteger(jobs) || jobs <= 0) {
    throw new Error('--jobs must be a positive integer or "max".');
  }
  return jobs;
}

export function renderHumanReport(inputPath: string, report: OptimizationReport): string {
  const lines = [
    "HWPX Optimization Report",
    `File: ${inputPath}`,
    `Original: ${formatBytes(report.originalSize)}`,
    ...(report.targetBytes ? [`Target: ${formatBytes(report.targetBytes)} (${report.targetStatus ?? "unknown"})`] : []),
    `Images: ${report.images.length}`,
    `BMP candidates: ${report.images.filter((image) => image.isBmpCandidate).length}`,
    `Images with metadata: ${report.images.filter((image) => image.hasMetadata).length}`,
    `Duplicate image groups: ${report.duplicateImages.length}`,
    `Same-visual duplicate image groups: ${report.sameVisualDuplicateImages.length}`,
    `Unused BinData candidates: ${report.unusedBinData.length}`,
    `Risky resources: ${report.riskyResources.length}`,
    `Near-duplicate image candidates: ${report.nearDuplicateImages?.length ?? 0}`,
    `Resource diagnostics: ${report.resourceDiagnostics?.length ?? 0}`,
    `Potential saving (non-overlap): ${formatBytes(estimateNonOverlappingSavingBytes(report.opportunityGroups))}`
  ];
  const insights = createHumanReportInsights(report);
  if (insights.length > 0) {
    lines.push("결과 해석:");
    lines.push(...insights.map((insight) => `- ${insight}`));
  }
  if (report.opportunityGroups.length > 0) {
    lines.push("Opportunities:");
    for (const group of report.opportunityGroups) {
      lines.push(`- ${group.action}: ${formatTargetCount(group.count)}, ~${formatBytes(group.estimatedSavingBytes)}`);
    }
  } else {
    lines.push("Opportunities: none");
  }
  if (report.warnings.length > 0) {
    lines.push("Warnings:");
    for (const warning of report.warnings) {
      lines.push(`- ${warning}`);
    }
  }
  if (report.targetMissReason) lines.push(`Target note: ${report.targetMissReason}`);
  if ((report.nearDuplicateImages?.length ?? 0) > 0) {
    lines.push("Near-duplicate candidates:");
    for (const group of report.nearDuplicateImages ?? []) {
      lines.push(`- ${group.paths.join(", ")} (max distance ${group.maxDistance})`);
    }
  }
  if ((report.resourceDiagnostics?.length ?? 0) > 0) {
    lines.push("Resource diagnostics:");
    for (const item of report.resourceDiagnostics ?? []) {
      lines.push(`- ${item.type}: ${formatBytes(item.sizeBytes)}; ${item.paths.join(", ")}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function createHumanReportInsights(report: OptimizationReport): string[] {
  const insights: string[] = [];
  if (report.targetStatus === "missed" && report.targetMissReason) {
    insights.push(`목표 미달: ${report.targetMissReason}`);
  }
  const largestOpportunity = [...report.opportunityGroups].sort(
    (left, right) => right.estimatedSavingBytes - left.estimatedSavingBytes
  )[0];
  if (largestOpportunity) {
    insights.push(
      `가장 큰 절감 후보: ${largestOpportunity.action} ${formatKoreanCount(largestOpportunity.count)}, 약 ${formatBytes(largestOpportunity.estimatedSavingBytes)}`
    );
  }
  const skippedCounts = countAppliedActions(report.actions.skipped);
  if (skippedCounts.length > 0) {
    insights.push(`보류된 작업: ${skippedCounts.map(([type, count]) => `${type} ${formatKoreanCount(count)}`).join(", ")}`);
  }
  if (report.performance) {
    const longestStage = [...report.performance.stages].sort((left, right) => right.durationMs - left.durationMs)[0];
    if (longestStage) {
      insights.push(
        `처리 시간: 총 ${(report.performance.totalMs / 1000).toFixed(2)}s, 최장 단계 ${longestStage.name} ${longestStage.durationMs.toFixed(1)}ms`
      );
    }
  }
  return insights;
}

function printTargetSummary(report: OptimizationReport): void {
  if (!report.targetBytes) return;
  console.log(`Target: ${formatBytes(report.targetBytes)} (${report.targetStatus ?? "unknown"})`);
  if (report.targetMissReason) console.log(`Target note: ${report.targetMissReason}`);
}

function countAppliedActions(actions: AppliedAction[]): Array<[AppliedAction["type"], number]> {
  const counts = new Map<AppliedAction["type"], number>();
  for (const action of actions) {
    counts.set(action.type, (counts.get(action.type) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1]);
}

function formatTargetCount(count: number): string {
  return count === 1 ? "1 target" : `${count} targets`;
}

function formatKoreanCount(count: number): string {
  return `${count}개`;
}

function formatBytes(bytes: number): string {
  const sign = bytes < 0 ? "-" : "";
  const absolute = Math.abs(bytes);
  if (absolute < 1024) return `${sign}${absolute} B`;
  if (absolute < 1024 * 1024) return `${sign}${(absolute / 1024).toFixed(1)} KiB`;
  return `${sign}${(absolute / 1024 / 1024).toFixed(2)} MiB`;
}

async function writeOptimizationArtifacts(
  outputPath: string,
  output: Buffer,
  reportPath: string,
  reportContent: string
): Promise<void> {
  const outputTmpPath = temporaryPath(outputPath);
  const reportTmpPath = temporaryPath(reportPath);
  let reportPromoted = false;
  try {
    await assertArtifactTargetIsWritable(outputPath);
    await assertArtifactTargetIsWritable(reportPath);
    await writeFile(outputTmpPath, output);
    await writeFile(reportTmpPath, reportContent);
    await rename(reportTmpPath, reportPath);
    reportPromoted = true;
    await rename(outputTmpPath, outputPath);
  } catch (error) {
    await Promise.all([
      rm(outputTmpPath, { force: true }),
      rm(reportTmpPath, { force: true }),
      reportPromoted ? rm(reportPath, { force: true }) : Promise.resolve()
    ]);
    throw error;
  }
}

async function assertArtifactTargetIsWritable(path: string): Promise<void> {
  try {
    const target = await stat(path);
    if (target.isDirectory()) {
      throw new Error(`Refusing to write artifact over directory: ${path}`);
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
}

function temporaryPath(path: string): string {
  const nonce = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${path}.tmp-${nonce}`;
}

type BatchFailureStage = "read-input" | "optimize" | "resolve-output-path" | "write-output" | "write-report";

type BatchFileResult =
  | {
      input: string;
      status: "optimized";
      output: string;
      report: string;
      originalSize: number;
      optimizedSize: number;
      savedBytes: number;
      savedPercent: number;
    }
  | { input: string; status: "failed"; stage: BatchFailureStage; error: string };

function isOptimizationMode(value: string): value is OptimizationMode {
  return value === "safe" || value === "balanced" || value === "aggressive";
}

export function isCliEntrypoint(metaUrl: string, argvPath = process.argv[1]): boolean {
  if (!argvPath) return false;
  const modulePath = fileURLToPath(metaUrl);
  try {
    return realpathSync(modulePath) === realpathSync(argvPath);
  } catch {
    return modulePath === argvPath;
  }
}

if (isCliEntrypoint(import.meta.url)) {
  process.exitCode = await runCli(process.argv.slice(2));
}
