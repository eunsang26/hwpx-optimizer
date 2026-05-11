#!/usr/bin/env node

import { constants, realpathSync } from "node:fs";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
  if (command === "list-actions") {
    printActionList();
    return 0;
  }
  if (!command || !inputPath) {
    printUsage();
    return 1;
  }

  const options = parseOptions(rest);
  try {
    if (command === "analyze") {
      const report = await analyzeHwpxBuffer(await readFile(inputPath));
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
      const report = await analyzeHwpxBuffer(await readFile(inputPath));
      const text = renderHumanReport(inputPath, report);
      const requestedReportPath = options.out ?? `${inputPath}.report.txt`;
      const reportPath =
        options.overwrite === "true" ? requestedReportPath : await nextAvailablePath(requestedReportPath);
      assertDoesNotTargetInput(reportPath, inputPath, "report");
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
      return summary.failed > 0 ? 1 : 0;
    }

    if (command === "optimize") {
      const mode = options.mode ?? "safe";
      if (!isOptimizationMode(mode)) {
        console.error("Only --mode safe, --mode balanced, and --mode aggressive are supported");
        return 1;
      }
      const input = await readFile(inputPath);
      const result = await optimizeByMode(input, mode, options);
      const overwrite = options.overwrite === "true";
      const requestedOutputPath = options.out ?? defaultOutputPath(inputPath);
      const outputPath = overwrite ? requestedOutputPath : await nextAvailablePath(requestedOutputPath);
      assertDoesNotTargetInput(outputPath, inputPath, "output");
      const requestedReportPath = options.report ?? `${outputPath}.report.json`;
      const reportPath = overwrite ? requestedReportPath : await nextAvailablePath(requestedReportPath);
      assertDoesNotTargetInput(reportPath, inputPath, "report");
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
  console.error("  hwpx-opt analyze <file.hwpx> [--report report.json]");
  console.error("  hwpx-opt report <file.hwpx> [--out report.txt]");
  console.error("  hwpx-opt verify <file.hwpx>");
  console.error("  hwpx-opt optimize <file.hwpx> --mode safe|balanced|aggressive [--actions action1,action2] [--allow-larger] [--overwrite] [--out output.hwpx] [--report report.json]");
  console.error("  hwpx-opt batch <directory> --mode safe|balanced|aggressive [--actions action1,action2] [--allow-larger] [--overwrite] [--out output-directory]");
  console.error("  hwpx-opt list-actions");
}

const ACTION_CATALOG: Array<{
  action: string;
  description: string;
  modes: string;
  risk: string;
  visualImpact: string;
}> = [
  {
    action: "strip-metadata",
    description: "Remove JPEG EXIF/IPTC/comment segments without recompressing the image",
    modes: "safe, balanced, aggressive",
    risk: "safe",
    visualImpact: "none"
  },
  {
    action: "optimize-png",
    description: "Re-encode PNG losslessly with maximum DEFLATE",
    modes: "safe, balanced, aggressive",
    risk: "safe",
    visualImpact: "none"
  },
  {
    action: "minify-xml",
    description: "Re-serialize XML entries without insignificant whitespace",
    modes: "safe",
    risk: "safe",
    visualImpact: "none"
  },
  {
    action: "remove-unused",
    description: "Drop BinData entries not referenced by any XML",
    modes: "safe",
    risk: "safe",
    visualImpact: "none"
  },
  {
    action: "convert-bmp-to-png",
    description: "Decode BMP and re-encode as PNG (with optional resize)",
    modes: "balanced, aggressive",
    risk: "medium",
    visualImpact: "low~medium"
  },
  {
    action: "resize-jpeg",
    description: "Resize and re-encode oversized JPEGs to display-size budget with MozJPEG",
    modes: "balanced, aggressive",
    risk: "medium",
    visualImpact: "medium"
  },
  {
    action: "resize-png",
    description: "Resize oversized PNGs to display-size budget while keeping PNG output",
    modes: "balanced, aggressive",
    risk: "medium",
    visualImpact: "low"
  },
  {
    action: "convert-tiff-to-png",
    description: "Decode TIFF and re-encode as PNG (with optional resize)",
    modes: "balanced, aggressive",
    risk: "medium",
    visualImpact: "low~medium"
  },
  {
    action: "clean-shape-comment",
    description: "Strip private filename / dimension lines inside <hp:shapeComment> blocks",
    modes: "balanced, aggressive",
    risk: "safe",
    visualImpact: "none"
  },
  {
    action: "consolidate-duplicate-images",
    description: "Redirect duplicate image references to a canonical resource and drop the duplicate file",
    modes: "balanced, aggressive",
    risk: "medium",
    visualImpact: "none"
  },
  {
    action: "repack-zip",
    description: "Always-on final ZIP repack with DEFLATE level 9",
    modes: "safe, balanced, aggressive",
    risk: "safe",
    visualImpact: "none"
  }
];

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
  const overwrite = options.overwrite === "true";
  await mkdir(outputDir, { recursive: true });

  const files = (await readdir(inputDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.hwpx$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const results: BatchFileResult[] = [];

  for (const [index, file] of files.entries()) {
    const sourcePath = join(inputDir, file);
    const progressPrefix = `[${index + 1}/${files.length}] ${file}`;
    let stage: BatchFailureStage = "read-input";
    try {
      const buffer = await readFile(sourcePath);
      stage = "optimize";
      const result = await optimizeByMode(buffer, mode, options);
      stage = "resolve-output-path";
      const requestedOutputPath = join(outputDir, `${basename(file, ".hwpx")}.optimized.hwpx`);
      const outputPath = overwrite ? requestedOutputPath : await nextAvailablePath(requestedOutputPath);
      const requestedReportPath = `${outputPath}.report.json`;
      const reportPath = overwrite ? requestedReportPath : await nextAvailablePath(requestedReportPath);
      stage = "write-output";
      await writeFile(outputPath, result.output);
      stage = "write-report";
      await writeFile(reportPath, JSON.stringify(result.report, null, 2));
      results.push({ input: file, status: "optimized", output: outputPath, report: reportPath });
      const savedBytes = result.report.savedBytes ?? 0;
      const savedPercent = result.report.savedPercent ?? 0;
      console.log(`${progressPrefix} optimized -${formatBytes(savedBytes)} (${savedPercent.toFixed(2)}%)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ input: file, status: "failed", stage, error: message });
      console.error(`${progressPrefix} failed at ${stage}: ${message}`);
    }
  }

  const requestedBatchReportPath = join(outputDir, "batch-report.json");
  const reportPath = overwrite ? requestedBatchReportPath : await nextAvailablePath(requestedBatchReportPath);
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
    `Same-visual duplicate image groups: ${report.sameVisualDuplicateImages.length}`,
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
  const actions = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const allowed = new Set(ACTION_CATALOG.map((item) => item.action));
  const unknown = actions.filter((action) => !allowed.has(action));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown --actions: ${unknown.join(", ")}. Run "hwpx-opt list-actions" to see valid actions.`
    );
  }
  return actions;
}

type OptimizationMode = "safe" | "balanced" | "aggressive";

type BatchFailureStage = "read-input" | "optimize" | "resolve-output-path" | "write-output" | "write-report";

type BatchFileResult =
  | { input: string; status: "optimized"; output: string; report: string }
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
