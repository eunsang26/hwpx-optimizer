import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  actions?: string[];
};

export async function handleCoreRequest(method: string, params: unknown): Promise<unknown> {
  if (method === "health") {
    return { service: "hwpx-tauri-sidecar", status: "ok" };
  }
  if (method === "analyze") {
    const { filePath } = assertObjectWithFilePath(params);
    const report = await analyzeHwpxBuffer(await readFile(filePath), { analysisMode: "quick" });
    return { filePath, report };
  }
  if (method === "optimize") {
    const input = assertOptimizeParams(params);
    const source = await readFile(input.filePath);
    const result =
      input.mode === "safe"
        ? await optimizeHwpxBufferSafe(source)
        : input.mode === "aggressive"
          ? await optimizeHwpxBufferAggressive(source, { actions: input.actions })
          : await optimizeHwpxBufferBalanced(source, { actions: input.actions });
    const outputPath = outputPathFor(input.filePath, input.outputDirectory);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, result.output);
    return { outputPath, report: result.report };
  }
  if (method === "verify") {
    const { filePath } = assertObjectWithFilePath(params);
    await verifyHwpxOutput(await readFile(filePath));
    return { ok: true };
  }
  throw new Error(`Unsupported sidecar method: ${method}`);
}

function assertObjectWithFilePath(params: unknown): { filePath: string } {
  if (!params || typeof params !== "object" || typeof (params as { filePath?: unknown }).filePath !== "string") {
    throw new Error("Expected params.filePath.");
  }
  return { filePath: (params as { filePath: string }).filePath };
}

function assertOptimizeParams(params: unknown): OptimizeParams {
  const { filePath } = assertObjectWithFilePath(params);
  const mode = (params as { mode?: unknown }).mode;
  if (mode !== "safe" && mode !== "balanced" && mode !== "aggressive") {
    throw new Error("Expected params.mode to be safe, balanced, or aggressive.");
  }
  const outputDirectory = (params as { outputDirectory?: unknown }).outputDirectory;
  const actions = (params as { actions?: unknown }).actions;
  return {
    filePath,
    mode,
    ...(typeof outputDirectory === "string" ? { outputDirectory } : {}),
    ...(Array.isArray(actions) && actions.every((action) => typeof action === "string") ? { actions } : {})
  };
}

function outputPathFor(filePath: string, outputDirectory: string | undefined): string {
  const ext = extname(filePath);
  const base = basename(filePath, ext);
  return join(outputDirectory ?? dirname(filePath), `${base}_tauri_optimized.hwpx`);
}
