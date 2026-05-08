import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import type { OptimizationReport } from "@hwpx-optimizer/core";

export type OptimizationMode = "safe" | "balanced" | "aggressive";

export type DesktopSettings = {
  defaultMode: OptimizationMode;
  saveNextToOriginal: boolean;
  saveReport: boolean;
  preventOverwrite: boolean;
  showAggressiveWarning: boolean;
  outputDirectory?: string;
};

export const defaultDesktopSettings: DesktopSettings = {
  defaultMode: "safe",
  saveNextToOriginal: true,
  saveReport: true,
  preventOverwrite: true,
  showAggressiveWarning: true
};

export type DesktopAnalysisResult = {
  filePath: string;
  report: OptimizationReport;
};

export type DesktopOptimizeInput = {
  filePath: string;
  mode: OptimizationMode;
  settings: DesktopSettings;
  outputDirectory?: string;
};

export type DesktopOptimizeResult = {
  outputPath: string;
  reportPath?: string;
  report: OptimizationReport;
};

export type DesktopProgress = {
  percent: number;
  item: string;
};

type CoreModule = typeof import("@hwpx-optimizer/core");

let coreModulePromise: Promise<CoreModule> | undefined;

async function loadCoreModule(): Promise<CoreModule> {
  coreModulePromise ??= import("@hwpx-optimizer/core").catch((error: unknown) => {
    coreModulePromise = undefined;
    throw error;
  });
  return coreModulePromise;
}

export async function analyzeDesktopFile(filePath: string): Promise<DesktopAnalysisResult> {
  const { analyzeHwpxBuffer } = await loadCoreModule();
  const report = await analyzeHwpxBuffer(await readFile(filePath));
  return { filePath, report };
}

export async function optimizeDesktopFile(
  input: DesktopOptimizeInput,
  onProgress?: (progress: DesktopProgress) => void
): Promise<DesktopOptimizeResult> {
  onProgress?.({ percent: 10, item: "Reading HWPX package" });
  const source = await readFile(input.filePath);

  onProgress?.({ percent: 35, item: `Optimizing document in ${input.mode} mode` });
  const result = await optimizeByMode(source, input.mode);

  onProgress?.({ percent: 70, item: "Writing optimized document" });
  const outputPath = nextOutputPath(input.filePath, input.outputDirectory ?? input.settings.outputDirectory, input.settings);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, result.output);

  let reportPath: string | undefined;
  if (input.settings.saveReport) {
    onProgress?.({ percent: 82, item: "Writing JSON report" });
    reportPath = `${outputPath}.report.json`;
    await writeFile(reportPath, JSON.stringify(result.report, null, 2));
  }

  onProgress?.({ percent: 92, item: "Finalizing optimized document" });
  return { outputPath, reportPath, report: result.report };
}

export async function verifyDesktopFile(filePath: string): Promise<{ ok: true }> {
  const { verifyHwpxOutput } = await loadCoreModule();
  await verifyHwpxOutput(await readFile(filePath));
  return { ok: true };
}

export async function optimizeByMode(
  input: Buffer,
  mode: OptimizationMode
): Promise<{ output: Buffer; report: OptimizationReport }> {
  const { optimizeHwpxBufferAggressive, optimizeHwpxBufferBalanced, optimizeHwpxBufferSafe } = await loadCoreModule();
  if (mode === "safe") return optimizeHwpxBufferSafe(input);
  if (mode === "aggressive") return optimizeHwpxBufferAggressive(input);
  return optimizeHwpxBufferBalanced(input);
}

export function nextOutputPath(filePath: string, outputDirectory: string | undefined, settings: DesktopSettings): string {
  const parsedExt = extname(filePath);
  const base = basename(filePath, parsedExt);
  const dir = settings.saveNextToOriginal || !outputDirectory ? dirname(filePath) : outputDirectory;
  const first = join(dir, `${base}.optimized.hwpx`);
  if (!settings.preventOverwrite || !existsSync(first)) return first;

  for (let index = 2; index < 1000; index += 1) {
    const candidate = join(dir, `${base}.optimized-${index}.hwpx`);
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error("Could not create a non-overwriting output path.");
}
