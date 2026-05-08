#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  analyzeHwpxBuffer,
  optimizeHwpxBufferAggressive,
  optimizeHwpxBufferBalanced,
  optimizeHwpxBufferSafe,
  verifyHwpxOutput
} from "@hwpx-optimizer/core";
import type { AppliedAction, OptimizationReport } from "@hwpx-optimizer/core";

export async function runCli(argv: string[]): Promise<number> {
  const [command, inputPath, ...rest] = argv;
  if (!command || !inputPath) {
    printUsage();
    return 1;
  }

  const options = parseOptions(rest);
  try {
    if (command === "analyze") {
      const report = await analyzeHwpxBuffer(await readFile(inputPath));
      const reportPath = options.report ?? `${inputPath}.report.json`;
      await writeFile(reportPath, JSON.stringify(report, null, 2));
      console.log(`Analyzed ${inputPath}`);
      printAnalysisSummary(inputPath, report);
      console.log(`Report: ${reportPath}`);
      return 0;
    }

    if (command === "report") {
      const report = await analyzeHwpxBuffer(await readFile(inputPath));
      const text = renderHumanReport(inputPath, report);
      const reportPath = options.out ?? `${inputPath}.report.txt`;
      await writeFile(reportPath, text);
      console.log(text);
      console.log(`Report: ${reportPath}`);
      return 0;
    }

    if (command === "verify") {
      await verifyHwpxOutput(await readFile(inputPath));
      console.log(`Verified: ${inputPath}`);
      return 0;
    }

    if (command === "batch") {
      const summary = await runBatch(inputPath, options);
      console.log(`Batch complete: ${summary.optimized} optimized, ${summary.failed} failed`);
      console.log(`Report: ${summary.reportPath}`);
      return 0;
    }

    if (command === "optimize") {
      const mode = options.mode ?? "safe";
      if (!isOptimizationMode(mode)) {
        console.error("Only --mode safe, --mode balanced, and --mode aggressive are supported");
        return 1;
      }
      const input = await readFile(inputPath);
      const result = await optimizeByMode(input, mode, options);
      const outputPath = options.out ?? defaultOutputPath(inputPath);
      const reportPath = options.report ?? `${outputPath}.report.json`;
      await writeFile(outputPath, result.output);
      await writeFile(reportPath, JSON.stringify(result.report, null, 2));
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

function parseOptions(args: string[]): Record<string, string> {
  const options: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = args[index + 1];
    if (value && !value.startsWith("--")) {
      options[key] = value;
      index += 1;
    } else {
      options[key] = "true";
    }
  }
  return options;
}

function defaultOutputPath(inputPath: string): string {
  const name = basename(inputPath, ".hwpx");
  return join(dirname(inputPath), `${name}.optimized.hwpx`);
}

function printUsage(): void {
  console.error("Usage:");
  console.error("  hwpx-opt analyze <file.hwpx> [--report report.json]");
  console.error("  hwpx-opt report <file.hwpx> [--out report.txt]");
  console.error("  hwpx-opt verify <file.hwpx>");
  console.error("  hwpx-opt optimize <file.hwpx> --mode safe|balanced|aggressive [--actions action1,action2] [--allow-larger] [--out output.hwpx] [--report report.json]");
  console.error("  hwpx-opt batch <directory> --mode safe|balanced|aggressive --out output-directory");
}

function printAnalysisSummary(inputPath: string, report: OptimizationReport): void {
  console.log(`Original: ${formatBytes(report.originalSize)}`);
  if (report.opportunityGroups.length === 0) {
    console.log("Opportunities: none");
    return;
  }

  console.log("Opportunities:");
  for (const group of report.opportunityGroups) {
    console.log(
      `- ${group.action}: ${formatTargetCount(group.count)}, ~${formatBytes(group.estimatedSavingBytes)} potential saving`
    );
  }
  console.log(`Suggested: hwpx-opt optimize ${inputPath} --mode balanced`);
}

function printOptimizationSummary(report: OptimizationReport): void {
  const savedBytes = report.savedBytes ?? 0;
  const savedPercent = report.savedPercent ?? 0;
  console.log(`Saved: ${formatBytes(savedBytes)} (${savedPercent.toFixed(2)}%)`);

  const counts = countAppliedActions(report.actions.applied);
  if (counts.length === 0) {
    console.log("Applied: none");
    return;
  }

  console.log(`Applied: ${counts.map(([type, count]) => `${type} ${count}`).join(", ")}`);
}

async function optimizeByMode(
  input: Buffer,
  mode: OptimizationMode,
  options: Record<string, string>
): Promise<{ output: Buffer; report: OptimizationReport }> {
  if (mode === "safe") return optimizeHwpxBufferSafe(input);
  const advancedOptions = {
    actions: parseActionList(options.actions),
    allowLarger: options["allow-larger"] === "true"
  };
  if (mode === "aggressive") return optimizeHwpxBufferAggressive(input, advancedOptions);
  return optimizeHwpxBufferBalanced(input, advancedOptions);
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
  await mkdir(outputDir, { recursive: true });

  const files = (await readdir(inputDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.hwpx$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const results: BatchFileResult[] = [];

  for (const file of files) {
    const sourcePath = join(inputDir, file);
    try {
      const result = await optimizeByMode(await readFile(sourcePath), mode, options);
      const outputPath = join(outputDir, `${basename(file, ".hwpx")}.optimized.hwpx`);
      const reportPath = `${outputPath}.report.json`;
      await writeFile(outputPath, result.output);
      await writeFile(reportPath, JSON.stringify(result.report, null, 2));
      results.push({ input: file, status: "optimized", output: outputPath, report: reportPath });
    } catch (error) {
      results.push({
        input: file,
        status: "failed",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const reportPath = join(outputDir, "batch-report.json");
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        mode,
        inputDir,
        outputDir,
        results
      },
      null,
      2
    )
  );
  return {
    optimized: results.filter((result) => result.status === "optimized").length,
    failed: results.filter((result) => result.status === "failed").length,
    reportPath
  };
}

function renderHumanReport(inputPath: string, report: OptimizationReport): string {
  const lines = [
    "HWPX Optimization Report",
    `File: ${inputPath}`,
    `Original: ${formatBytes(report.originalSize)}`,
    `Images: ${report.images.length}`,
    `BMP candidates: ${report.images.filter((image) => image.isBmpCandidate).length}`,
    `Images with metadata: ${report.images.filter((image) => image.hasMetadata).length}`,
    `Duplicate image groups: ${report.duplicateImages.length}`,
    `Unused BinData candidates: ${report.unusedBinData.length}`,
    `Risky resources: ${report.riskyResources.length}`
  ];
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
  return `${lines.join("\n")}\n`;
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

function formatBytes(bytes: number): string {
  const sign = bytes < 0 ? "-" : "";
  const absolute = Math.abs(bytes);
  if (absolute < 1024) return `${sign}${absolute} B`;
  if (absolute < 1024 * 1024) return `${sign}${(absolute / 1024).toFixed(1)} KiB`;
  return `${sign}${(absolute / 1024 / 1024).toFixed(2)} MiB`;
}

function parseActionList(value?: string): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

type OptimizationMode = "safe" | "balanced" | "aggressive";

type BatchFileResult =
  | { input: string; status: "optimized"; output: string; report: string }
  | { input: string; status: "failed"; error: string };

function isOptimizationMode(value: string): value is OptimizationMode {
  return value === "safe" || value === "balanced" || value === "aggressive";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await runCli(process.argv.slice(2));
}
