#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { analyzeHwpxBuffer, optimizeHwpxBufferBalanced, optimizeHwpxBufferSafe } from "@hwpx-optimizer/core";
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

    if (command === "optimize") {
      const mode = options.mode ?? "safe";
      if (mode !== "safe" && mode !== "balanced") {
        console.error("Only --mode safe and --mode balanced are supported");
        return 1;
      }
      const input = await readFile(inputPath);
      const result =
        mode === "balanced"
          ? await optimizeHwpxBufferBalanced(input, {
              actions: parseActionList(options.actions),
              allowLarger: options["allow-larger"] === "true"
            })
          : await optimizeHwpxBufferSafe(input);
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
  console.error("  hwpx-opt optimize <file.hwpx> --mode safe|balanced [--actions action1,action2] [--allow-larger] [--out output.hwpx] [--report report.json]");
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

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await runCli(process.argv.slice(2));
}
