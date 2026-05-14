import { constants } from "node:fs";
import { access, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import type { ImagePreviewPair, OptimizationReport } from "@hwpx-optimizer/core";
import { resolveSubmissionLimitBytes } from "../shared/submissionPlan.js";
import type { PreservationPreference, SubmissionLimit } from "../shared/submissionPlan.js";

export type OptimizationMode = "safe" | "balanced" | "aggressive";

export type DesktopSettings = {
  settingsVersion?: number;
  defaultMode: OptimizationMode;
  saveNextToOriginal: boolean;
  saveReport: boolean;
  preventOverwrite: boolean;
  showAggressiveWarning: boolean;
  submissionLimit: SubmissionLimit;
  preservationPreference: PreservationPreference;
};

export type DesktopSettingsPatch = Partial<DesktopSettings> & Record<string, unknown>;

export const defaultDesktopSettings: DesktopSettings = {
  settingsVersion: 2,
  defaultMode: "balanced",
  saveNextToOriginal: true,
  saveReport: false,
  preventOverwrite: true,
  showAggressiveWarning: true,
  submissionLimit: { id: "mb20" },
  preservationPreference: "recommended"
};

const DEFAULT_MAX_HWPX_INPUT_BYTES = 512 * 1024 * 1024;
const DEFAULT_MAX_IMAGE_PREVIEW_INPUT_BYTES = 200 * 1024 * 1024;
const MAX_BATCH_REPORT_ITEMS = 10_000;

export type DesktopAnalysisResult = {
  filePath: string;
  report: OptimizationReport;
};

export type DesktopOptimizeInput = {
  filePath: string;
  mode: OptimizationMode;
  settings: DesktopSettings;
  outputDirectory?: string;
  outputMode?: "single" | "batch";
  actions?: string[];
  maxInputBytes?: number;
};

export type DesktopOptimizeResult = {
  outputPath: string;
  reportPath?: string;
  report: OptimizationReport;
};

export type DesktopBatchReportItem = {
  input: string;
  status: "done" | "failed" | "cancelled";
  output?: string;
  report?: string;
  error?: string;
  originalSize?: number;
  optimizedSize?: number;
  savedBytes?: number;
  savedPercent?: number;
};

export type DesktopBatchReportInput = {
  reportDirectory: string;
  mode: OptimizationMode;
  settings: Pick<DesktopSettings, "preventOverwrite">;
  items: DesktopBatchReportItem[];
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

export async function analyzeDesktopFile(
  filePath: string,
  options: { maxInputBytes?: number } = {}
): Promise<DesktopAnalysisResult> {
  await assertSupportedLocalInput(filePath, options);
  const { analyzeHwpxBuffer } = await loadCoreModule();
  const report = await analyzeHwpxBuffer(await readFile(filePath));
  return { filePath, report };
}

export async function optimizeDesktopFile(
  input: DesktopOptimizeInput,
  onProgress?: (progress: DesktopProgress) => void
): Promise<DesktopOptimizeResult> {
  onProgress?.({ percent: 10, item: "Reading HWPX package" });
  await assertSupportedLocalInput(input.filePath, { maxInputBytes: input.maxInputBytes });
  let source: Buffer | undefined = await readFile(input.filePath);

  const result = await optimizeByMode(
    source,
    input.mode,
    input.actions,
    resolveSubmissionLimitBytes(input.settings.submissionLimit),
    onProgress
  );
  source = undefined;

  onProgress?.({ percent: 90, item: "Writing optimized document" });
  const outputPath = await nextOutputPath(
    input.filePath,
    input.outputDirectory,
    input.settings,
    input.outputMode
  );
  await mkdir(dirname(outputPath), { recursive: true });

  let reportPath: string | undefined;
  let reportContent: string | undefined;
  if (input.settings.saveReport) {
    onProgress?.({ percent: 94, item: "Writing JSON report" });
    reportPath = `${outputPath}.report.json`;
    reportContent = JSON.stringify(result.report, null, 2);
  }
  await writeOptimizationArtifacts(outputPath, result.output, reportPath, reportContent);

  onProgress?.({ percent: 98, item: "Finalizing optimized document" });
  return { outputPath, reportPath, report: result.report };
}

export async function writeDesktopBatchReport(input: DesktopBatchReportInput): Promise<{ reportPath: string }> {
  assertValidBatchReportInput(input);
  await mkdir(input.reportDirectory, { recursive: true });
  const requestedReportPath = join(input.reportDirectory, "batch-report.json");
  const reportPath = input.settings.preventOverwrite ? await nextAvailableReportPath(requestedReportPath) : requestedReportPath;
  const report = {
    mode: input.mode,
    generatedAt: new Date().toISOString(),
    totals: {
      done: input.items.filter((item) => item.status === "done").length,
      failed: input.items.filter((item) => item.status === "failed").length,
      cancelled: input.items.filter((item) => item.status === "cancelled").length,
      savedBytes: input.items.reduce((sum, item) => sum + (item.savedBytes ?? 0), 0)
    },
    items: input.items
  };
  await writeJsonArtifact(reportPath, JSON.stringify(report, null, 2));
  return { reportPath };
}

function assertValidBatchReportInput(input: DesktopBatchReportInput): void {
  if (!isOptimizationMode(input.mode)) {
    throw new Error(`Invalid batch report mode: ${String(input.mode)}`);
  }
  if (!Array.isArray(input.items) || input.items.length > MAX_BATCH_REPORT_ITEMS) {
    throw new Error(`Invalid batch report items: expected at most ${MAX_BATCH_REPORT_ITEMS} items.`);
  }
  for (const item of input.items) {
    if (item.status !== "done" && item.status !== "failed" && item.status !== "cancelled") {
      throw new Error(`Invalid batch report item status: ${String(item.status)}`);
    }
    for (const key of ["originalSize", "optimizedSize", "savedBytes", "savedPercent"] as const) {
      const value = item[key];
      if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
        throw new Error(`Invalid batch report number: ${key}`);
      }
    }
  }
}

export async function verifyDesktopFile(
  filePath: string,
  options: { maxInputBytes?: number } = {}
): Promise<{ ok: true }> {
  await assertSupportedLocalInput(filePath, options);
  const { verifyHwpxOutput } = await loadCoreModule();
  await verifyHwpxOutput(await readFile(filePath));
  return { ok: true };
}

export async function previewImageDiffs(
  originalPath: string,
  optimizedPath: string,
  options: { maxItems?: number; maxInputBytes?: number } = {}
): Promise<ImagePreviewPair[]> {
  const [originalStat, optimizedStat] = await Promise.all([stat(originalPath), stat(optimizedPath)]);
  const maxInputBytes = options.maxInputBytes ?? DEFAULT_MAX_IMAGE_PREVIEW_INPUT_BYTES;
  if (originalStat.size + optimizedStat.size > maxInputBytes) {
    throw new Error(
      `Files are too large for image preview (${originalStat.size + optimizedStat.size} bytes; limit ${maxInputBytes} bytes).`
    );
  }
  const { extractImageDiffPreviews } = await loadCoreModule();
  const [original, optimized] = await Promise.all([readFile(originalPath), readFile(optimizedPath)]);
  return extractImageDiffPreviews(original, optimized, options);
}

export async function optimizeByMode(
  input: Buffer,
  mode: OptimizationMode,
  actions?: string[],
  targetBytes?: number,
  onProgress?: (progress: DesktopProgress) => void
): Promise<{ output: Buffer; report: OptimizationReport }> {
  const { optimizeHwpxBufferAggressive, optimizeHwpxBufferBalanced, optimizeHwpxBufferSafe } = await loadCoreModule();
  if (mode === "safe") return optimizeHwpxBufferSafe(input, { targetBytes, onProgress });
  const advanced = { ...(actions ? { actions } : {}), targetBytes, onProgress };
  if (mode === "aggressive") return optimizeHwpxBufferAggressive(input, advanced);
  return optimizeHwpxBufferBalanced(input, advanced);
}

export async function nextOutputPath(
  filePath: string,
  outputDirectory: string | undefined,
  settings: DesktopSettings,
  outputMode: "single" | "batch" = "single"
): Promise<string> {
  const parsedExt = extname(filePath);
  const base = basename(filePath, parsedExt);
  const dir =
    outputMode === "batch"
      ? join(outputDirectory ?? dirname(filePath), "output")
      : settings.saveNextToOriginal || !outputDirectory
        ? dirname(filePath)
        : outputDirectory;
  const first = join(dir, `${base}_optimized.hwpx`);
  if (!settings.preventOverwrite || !(await pathExists(first))) return first;

  for (let index = 2; index < 1000; index += 1) {
    const candidate = join(dir, `${base}_optimized-${index}.hwpx`);
    if (!(await pathExists(candidate))) return candidate;
  }
  throw new Error("Could not create a non-overwriting output path.");
}

export function persistentDesktopSettingsPatch(patch: DesktopSettingsPatch): Partial<DesktopSettings> {
  const sanitized: Partial<DesktopSettings> = {};
  if (isOptimizationMode(patch.defaultMode)) sanitized.defaultMode = patch.defaultMode;
  if (patch.saveNextToOriginal === true) sanitized.saveNextToOriginal = true;
  if (typeof patch.saveReport === "boolean") sanitized.saveReport = patch.saveReport;
  if (typeof patch.preventOverwrite === "boolean") sanitized.preventOverwrite = patch.preventOverwrite;
  if (typeof patch.showAggressiveWarning === "boolean") sanitized.showAggressiveWarning = patch.showAggressiveWarning;
  if (isSubmissionLimit(patch.submissionLimit)) sanitized.submissionLimit = patch.submissionLimit;
  if (isPreservationPreference(patch.preservationPreference)) sanitized.preservationPreference = patch.preservationPreference;
  return sanitized;
}

export function normalizeDesktopSettings(raw: Partial<DesktopSettings> | undefined): DesktopSettings {
  const parsed = raw ?? {};
  const migratedMode =
    parsed.settingsVersion === undefined &&
    parsed.defaultMode === "safe" &&
    (parsed.preservationPreference ?? defaultDesktopSettings.preservationPreference) === "recommended"
      ? "balanced"
      : parsed.defaultMode;
  return {
    ...defaultDesktopSettings,
    ...parsed,
    defaultMode: migratedMode ?? defaultDesktopSettings.defaultMode,
    settingsVersion: defaultDesktopSettings.settingsVersion
  };
}

export async function assertSupportedLocalInput(
  filePath: string,
  options: { maxInputBytes?: number } = {}
): Promise<void> {
  const maxInputBytes = options.maxInputBytes ?? DEFAULT_MAX_HWPX_INPUT_BYTES;
  const { size } = await stat(filePath);
  if (size > maxInputBytes) {
    throw new Error(
      `${filePath} exceeds the supported local processing limit (${size} bytes; limit ${maxInputBytes} bytes).`
    );
  }
}

async function writeOptimizationArtifacts(
  outputPath: string,
  output: Buffer,
  reportPath: string | undefined,
  reportContent: string | undefined
): Promise<void> {
  const outputTmpPath = temporaryPath(outputPath);
  const reportTmpPath = reportPath && reportContent ? temporaryPath(reportPath) : undefined;
  let reportPromoted = false;
  try {
    await assertArtifactTargetIsWritable(outputPath);
    if (reportPath) await assertArtifactTargetIsWritable(reportPath);
    await writeFile(outputTmpPath, output);
    if (reportPath && reportContent && reportTmpPath) {
      await writeFile(reportTmpPath, reportContent);
      await rename(reportTmpPath, reportPath);
      reportPromoted = true;
    }
    await rename(outputTmpPath, outputPath);
  } catch (error) {
    await Promise.all([
      rm(outputTmpPath, { force: true }),
      reportTmpPath ? rm(reportTmpPath, { force: true }) : Promise.resolve(),
      reportPromoted && reportPath ? rm(reportPath, { force: true }) : Promise.resolve()
    ]);
    throw error;
  }
}

async function writeJsonArtifact(path: string, content: string): Promise<void> {
  const tmpPath = temporaryPath(path);
  try {
    await assertArtifactTargetIsWritable(path);
    await writeFile(tmpPath, content);
    await rename(tmpPath, path);
  } catch (error) {
    await rm(tmpPath, { force: true });
    throw error;
  }
}

async function nextAvailableReportPath(path: string): Promise<string> {
  if (!(await pathExists(path))) return path;
  const ext = extname(path);
  const base = path.slice(0, path.length - ext.length);
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}-${index}${ext}`;
    if (!(await pathExists(candidate))) return candidate;
  }
  throw new Error("Could not create a non-overwriting batch report path.");
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isOptimizationMode(value: unknown): value is OptimizationMode {
  return value === "safe" || value === "balanced" || value === "aggressive";
}

function isSubmissionLimit(value: unknown): value is SubmissionLimit {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { id?: unknown; customBytes?: unknown };
  if (
    candidate.id !== "none" &&
    candidate.id !== "mb10" &&
    candidate.id !== "mb20" &&
    candidate.id !== "mb50" &&
    candidate.id !== "custom"
  ) {
    return false;
  }
  return candidate.customBytes === undefined || typeof candidate.customBytes === "number";
}

function isPreservationPreference(value: unknown): value is PreservationPreference {
  return value === "preserve" || value === "recommended" || value === "size";
}
