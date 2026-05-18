import { constants } from "node:fs";
import { access, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import {
  analyzeHwpxBuffer,
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

const DEFAULT_MAX_HWPX_INPUT_BYTES = 512 * 1024 * 1024;

export async function handleCoreRequest(method: string, params: unknown): Promise<unknown> {
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
    const result =
      input.mode === "safe"
        ? await optimizeHwpxBufferSafe(source)
        : input.mode === "aggressive"
          ? await optimizeHwpxBufferAggressive(source, { actions: input.actions })
          : await optimizeHwpxBufferBalanced(source, { actions: input.actions });
    const outputPath = await nextOutputPath(input.filePath, input.outputDirectory, input.outputMode);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeArtifact(outputPath, result.output);
    return { outputPath, report: result.report };
  }
  if (method === "verify") {
    const { filePath } = assertObjectWithFilePath(params);
    await verifyHwpxOutput(await readSupportedInput(filePath));
    return { ok: true };
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
