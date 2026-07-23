import { constants } from "node:fs";
import { access, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import {
  analyzeHwpxBuffer,
  extractImageDiffPreviews,
  optimizeHwpxBufferAggressive,
  optimizeHwpxBufferBalanced,
  optimizeHwpxBufferSafe,
  verifyHwpxOutput
} from "@hwpx-optimizer/core";

type OptimizationMode = "safe" | "balanced" | "aggressive";

type OptimizeParams = {
  filePath: string;
  mode: OptimizationMode;
  outputDirectory?: string;
  outputMode?: "single" | "batch";
  actions?: string[];
};

type ProgressCallback = (progress: { percent: number; item: string }) => void;

type BatchReportItem = {
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

type BatchReportParams = {
  reportDirectory: string;
  mode: OptimizationMode;
  settings: { preventOverwrite?: boolean };
  items: BatchReportItem[];
};

type ImagePreviewParams = {
  originalPath: string;
  optimizedPath: string;
  maxItems?: number;
  maxInputBytes?: number;
};

const DEFAULT_MAX_HWPX_INPUT_BYTES = 512 * 1024 * 1024;
const DEFAULT_MAX_IMAGE_PREVIEW_INPUT_BYTES = 200 * 1024 * 1024;
const MAX_BATCH_REPORT_ITEMS = 10_000;

export async function handleCoreRequest(
  method: string,
  params: unknown,
  emitProgress?: ProgressCallback
): Promise<unknown> {
  if (method === "health") {
    return { service: "hwpx-tauri-sidecar", status: "ok" };
  }
  if (method === "analyze") {
    const { filePath } = assertObjectWithFilePath(params);
    const report = await analyzeHwpxBuffer(await readSupportedInput(filePath), { analysisMode: "quick" });
    return { filePath, report };
  }
  if (method === "optimize") {
    const input = assertOptimizeParams(params);
    const source = await readSupportedInput(input.filePath);
    emitProgress?.({ percent: 10, item: "Reading HWPX package" });
    const result =
      input.mode === "safe"
        ? await optimizeHwpxBufferSafe(source, { onProgress: emitProgress })
        : input.mode === "aggressive"
          ? await optimizeHwpxBufferAggressive(source, { actions: input.actions, onProgress: emitProgress })
          : await optimizeHwpxBufferBalanced(source, { actions: input.actions, onProgress: emitProgress });
    emitProgress?.({ percent: 88, item: "Preparing output file" });
    const outputPath = await nextOutputPath(input.filePath, input.outputDirectory, input.outputMode);
    await assertDoesNotTargetInput(outputPath, input.filePath);
    await mkdir(dirname(outputPath), { recursive: true });
    emitProgress?.({ percent: 95, item: "Writing optimized document" });
    await writeArtifact(outputPath, result.output);
    emitProgress?.({ percent: 99, item: "Finalizing optimized document" });
    return { outputPath, report: result.report };
  }
  if (method === "verify") {
    const { filePath } = assertObjectWithFilePath(params);
    await verifyHwpxOutput(await readSupportedInput(filePath));
    return { ok: true };
  }
  if (method === "saveBatchReport") {
    return writeBatchReport(assertBatchReportParams(params));
  }
  if (method === "previewImageDiffs") {
    const input = assertImagePreviewParams(params);
    const [originalStat, optimizedStat] = await Promise.all([stat(input.originalPath), stat(input.optimizedPath)]);
    const maxInputBytes = input.maxInputBytes ?? DEFAULT_MAX_IMAGE_PREVIEW_INPUT_BYTES;
    if (originalStat.size + optimizedStat.size > maxInputBytes) {
      throw new Error(
        `Files are too large for image preview (${originalStat.size + optimizedStat.size} bytes; limit ${maxInputBytes} bytes).`
      );
    }
    const [original, optimized] = await Promise.all([readFile(input.originalPath), readFile(input.optimizedPath)]);
    return extractImageDiffPreviews(original, optimized, { maxItems: input.maxItems });
  }
  throw new Error(`Unsupported sidecar method: ${method}`);
}

function assertObjectWithFilePath(params: unknown): { filePath: string } {
  if (!params || typeof params !== "object" || typeof (params as { filePath?: unknown }).filePath !== "string") {
    throw new Error("Expected params.filePath.");
  }
  const filePath = (params as { filePath: string }).filePath;
  if (filePath.length === 0) {
    throw new Error("Expected params.filePath to be non-empty.");
  }
  return { filePath };
}

function assertOptimizeParams(params: unknown): OptimizeParams {
  const { filePath } = assertObjectWithFilePath(params);
  const mode = (params as { mode?: unknown }).mode;
  if (mode !== "safe" && mode !== "balanced" && mode !== "aggressive") {
    throw new Error("Expected params.mode to be safe, balanced, or aggressive.");
  }
  const outputDirectory = (params as { outputDirectory?: unknown }).outputDirectory;
  const outputMode = (params as { outputMode?: unknown }).outputMode;
  const actions = (params as { actions?: unknown }).actions;
  if (outputMode !== undefined && outputMode !== "single" && outputMode !== "batch") {
    throw new Error("Expected params.outputMode to be single or batch.");
  }
  return {
    filePath,
    mode,
    ...(typeof outputDirectory === "string" ? { outputDirectory } : {}),
    ...(outputMode ? { outputMode } : {}),
    ...(Array.isArray(actions) && actions.every((action) => typeof action === "string") ? { actions } : {})
  };
}

function assertBatchReportParams(params: unknown): BatchReportParams {
  if (!params || typeof params !== "object") {
    throw new Error("Expected batch report params.");
  }
  const candidate = params as {
    reportDirectory?: unknown;
    mode?: unknown;
    settings?: unknown;
    items?: unknown;
  };
  if (typeof candidate.reportDirectory !== "string" || candidate.reportDirectory.length === 0) {
    throw new Error("Expected params.reportDirectory.");
  }
  if (candidate.mode !== "safe" && candidate.mode !== "balanced" && candidate.mode !== "aggressive") {
    throw new Error("Expected params.mode to be safe, balanced, or aggressive.");
  }
  if (!candidate.settings || typeof candidate.settings !== "object") {
    throw new Error("Expected params.settings.");
  }
  if (!Array.isArray(candidate.items) || candidate.items.length > MAX_BATCH_REPORT_ITEMS) {
    throw new Error(`Expected params.items to contain at most ${MAX_BATCH_REPORT_ITEMS} items.`);
  }
  const items = candidate.items.map(assertBatchReportItem);
  return {
    reportDirectory: candidate.reportDirectory,
    mode: candidate.mode,
    settings: { preventOverwrite: (candidate.settings as { preventOverwrite?: unknown }).preventOverwrite === true },
    items
  };
}

function assertBatchReportItem(item: unknown): BatchReportItem {
  if (!item || typeof item !== "object") {
    throw new Error("Expected batch report item.");
  }
  const candidate = item as Record<string, unknown>;
  if (typeof candidate.input !== "string" || candidate.input.length === 0) {
    throw new Error("Expected batch report item input.");
  }
  if (candidate.status !== "done" && candidate.status !== "failed" && candidate.status !== "cancelled") {
    throw new Error(`Invalid batch report item status: ${String(candidate.status)}`);
  }
  for (const key of ["originalSize", "optimizedSize", "savedBytes", "savedPercent"]) {
    const value = candidate[key];
    if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
      throw new Error(`Invalid batch report number: ${key}`);
    }
  }
  return {
    input: candidate.input,
    status: candidate.status,
    ...(typeof candidate.output === "string" ? { output: candidate.output } : {}),
    ...(typeof candidate.report === "string" ? { report: candidate.report } : {}),
    ...(typeof candidate.error === "string" ? { error: candidate.error } : {}),
    ...(typeof candidate.originalSize === "number" ? { originalSize: candidate.originalSize } : {}),
    ...(typeof candidate.optimizedSize === "number" ? { optimizedSize: candidate.optimizedSize } : {}),
    ...(typeof candidate.savedBytes === "number" ? { savedBytes: candidate.savedBytes } : {}),
    ...(typeof candidate.savedPercent === "number" ? { savedPercent: candidate.savedPercent } : {})
  };
}

function assertImagePreviewParams(params: unknown): ImagePreviewParams {
  if (!params || typeof params !== "object") {
    throw new Error("Expected image preview params.");
  }
  const candidate = params as Record<string, unknown>;
  if (typeof candidate.originalPath !== "string" || candidate.originalPath.length === 0) {
    throw new Error("Expected params.originalPath.");
  }
  if (typeof candidate.optimizedPath !== "string" || candidate.optimizedPath.length === 0) {
    throw new Error("Expected params.optimizedPath.");
  }
  if (candidate.maxItems !== undefined && (typeof candidate.maxItems !== "number" || !Number.isInteger(candidate.maxItems))) {
    throw new Error("Expected params.maxItems to be an integer.");
  }
  if (
    candidate.maxInputBytes !== undefined &&
    (typeof candidate.maxInputBytes !== "number" || !Number.isFinite(candidate.maxInputBytes))
  ) {
    throw new Error("Expected params.maxInputBytes to be a finite number.");
  }
  return {
    originalPath: candidate.originalPath,
    optimizedPath: candidate.optimizedPath,
    ...(typeof candidate.maxItems === "number" ? { maxItems: candidate.maxItems } : {}),
    ...(typeof candidate.maxInputBytes === "number" ? { maxInputBytes: candidate.maxInputBytes } : {})
  };
}

async function readSupportedInput(filePath: string): Promise<Buffer> {
  const { size } = await stat(filePath);
  if (size > DEFAULT_MAX_HWPX_INPUT_BYTES) {
    throw new Error(
      `${filePath} exceeds the supported local processing limit (${size} bytes; limit ${DEFAULT_MAX_HWPX_INPUT_BYTES} bytes).`
    );
  }
  return readFile(filePath);
}

async function nextOutputPath(
  filePath: string,
  outputDirectory: string | undefined,
  outputMode: "single" | "batch" = "single"
): Promise<string> {
  const ext = extname(filePath);
  const base = basename(filePath, ext);
  const dir = outputMode === "batch" ? join(outputDirectory ?? dirname(filePath), "output") : outputDirectory ?? dirname(filePath);
  const first = join(dir, `${base}_tauri_optimized.hwpx`);
  if (!(await pathExists(first))) return first;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = join(dir, `${base}_tauri_optimized-${index}.hwpx`);
    if (!(await pathExists(candidate))) return candidate;
  }
  throw new Error("Could not create a non-overwriting Tauri output path.");
}

async function writeBatchReport(input: BatchReportParams): Promise<{ reportPath: string }> {
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
  await writeArtifact(reportPath, Buffer.from(JSON.stringify(report, null, 2)));
  return { reportPath };
}

async function nextAvailableReportPath(requestedReportPath: string): Promise<string> {
  if (!(await pathExists(requestedReportPath))) return requestedReportPath;
  const ext = extname(requestedReportPath);
  const base = requestedReportPath.slice(0, -ext.length);
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}-${index}${ext}`;
    if (!(await pathExists(candidate))) return candidate;
  }
  throw new Error("Could not create a non-overwriting batch report path.");
}

// Safety rule: never overwrite the original input. The `_tauri_optimized` suffix
// makes this structurally unlikely, but resolve both paths (following symlinks
// where they exist) so a crafted outputDirectory can never point back at the input.
async function assertDoesNotTargetInput(outputPath: string, inputPath: string): Promise<void> {
  const [resolvedOutput, resolvedInput] = await Promise.all([realPathOrResolved(outputPath), realPathOrResolved(inputPath)]);
  if (resolvedOutput === resolvedInput) {
    throw new Error("Refusing to overwrite the original input document.");
  }
}

async function realPathOrResolved(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

async function writeArtifact(path: string, content: Buffer): Promise<void> {
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    await assertArtifactTargetIsWritable(path);
    await writeFile(tmpPath, content);
    await rename(tmpPath, path);
  } catch (error) {
    await rm(tmpPath, { force: true });
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
