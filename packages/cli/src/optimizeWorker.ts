import { parentPort } from "node:worker_threads";
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { optimizeByMode } from "./optimizeByMode.js";
import type { OptimizationMode, OptimizeByModeOptions } from "./optimizeByMode.js";

sharp.concurrency(1);

export type OptimizeJob = {
  sourcePath: string;
  tempOutputPath: string;
  tempReportPath: string;
  mode: OptimizationMode;
  options: OptimizeByModeOptions;
  targetBytes?: number;
};

export type OptimizeJobResult =
  | { status: "optimized"; originalSize: number; optimizedSize: number; savedBytes: number; savedPercent: number }
  | { status: "failed"; stage: "read-input" | "optimize" | "write-output"; error: string };

export async function runOptimizeJob(job: OptimizeJob): Promise<OptimizeJobResult> {
  let stage: "read-input" | "optimize" | "write-output" = "read-input";
  try {
    const buffer = await readFile(job.sourcePath);
    stage = "optimize";
    const { output, report } = await optimizeByMode(
      buffer,
      job.mode,
      { ...job.options, imageConcurrency: 1 },
      job.targetBytes
    );
    stage = "write-output";
    await writeFile(job.tempOutputPath, output);
    await writeFile(job.tempReportPath, JSON.stringify(report, null, 2));
    return {
      status: "optimized",
      originalSize: report.originalSize,
      optimizedSize: report.optimizedSize ?? output.byteLength,
      savedBytes: report.savedBytes ?? 0,
      savedPercent: report.savedPercent ?? 0
    };
  } catch (error) {
    return { status: "failed", stage, error: error instanceof Error ? error.message : String(error) };
  }
}

if (parentPort) {
  parentPort.on("message", async ({ index, job }: { index: number; job: OptimizeJob }) => {
    parentPort!.postMessage({ index, result: await runOptimizeJob(job) });
  });
}
