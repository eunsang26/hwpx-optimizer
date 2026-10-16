import { JPEG_QUALITY_FLOOR, JPEG_QUALITY_CEILING } from "../shared/qualityPolicy.js";
import { dirname, join } from "node:path";
import { DocumentWorkerClient } from "./documentWorkerClient.js";
import { DocumentOperations } from "./documentOperations.js";
import { DesktopPathPermissions } from "./pathPermissions.js";
import { previewImageDiffs, saveDesktopOptimization, verifyDesktopFile, writeDesktopBatchReport } from "./desktopService.js";
import type { DesktopBatchReportItem, DesktopProgress, DesktopSettings, OptimizationMode } from "./desktopService.js";
import type { DesktopImagePreviewInput } from "../shared/imagePreview.js";

export type DesktopOptimizeRequest = {
  filePath: string;
  mode: OptimizationMode;
  outputDirectory?: string;
  outputMode?: "single" | "batch";
  actions?: string[];
  targetBytes?: number;
  jpegQuality?: number;
};
export type DesktopBatchReportRequest = {
  firstInputPath: string;
  outputDirectory?: string;
  mode: OptimizationMode;
  batchTargetBytes?: number;
  items: DesktopBatchReportItem[];
};

/** Authorizes and serializes document work; owns worker shutdown, never Electron. */
export class DesktopDocumentController {
  constructor(
    private readonly loadSettings: () => Promise<DesktopSettings>,
    readonly permissions = new DesktopPathPermissions(),
    readonly worker = new DocumentWorkerClient(),
    readonly operations = new DocumentOperations()
  ) {}

  get busy(): boolean { return this.operations.busy; }

  analyze(filePath: string, options?: { analysisMode?: "quick" | "deep" }) {
    return this.operations.run("analyze", async ({ signal, progress }) => {
      if (options !== undefined && (!options || typeof options !== "object" ||
        (options.analysisMode !== undefined && !["quick", "deep"].includes(options.analysisMode)))) {
        throw new Error("Unsupported analysis mode.");
      }
      const allowedPath = await this.permissions.requireInput(filePath);
      progress({ percent: 10, item: "Analyzing document structure" });
      return this.worker.analyze(allowedPath, signal, options?.analysisMode);
    });
  }

  optimize(input: DesktopOptimizeRequest, onProgress?: (progress: DesktopProgress) => void) {
    validateOptimizeInput(input);
    return this.operations.run("optimize", async context => {
      const filePath = await this.permissions.requireInput(input.filePath);
      const outputDirectory = input.outputDirectory
        ? await this.permissions.requireOutputDirectory(input.outputDirectory) : undefined;
      const settings = await this.loadSettings();
      const effectiveSettings = outputDirectory ? { ...settings, saveNextToOriginal: false } : settings;
      const trustedInput = { ...input, filePath, outputDirectory, settings: effectiveSettings,
        protectedInputs: this.permissions.protectedInputs };
      const prepared = await this.worker.prepare(trustedInput, context.signal, context.progress);
      const result = await saveDesktopOptimization(trustedInput, prepared, context.progress, context);
      await this.permissions.registerGenerated(result.outputPath);
      if (result.reportPath) await this.permissions.registerGenerated(result.reportPath);
      context.progress({ percent: 100, item: "Optimization complete" });
      return result;
    }, onProgress);
  }

  cancel(kind: "analyze" | "optimize") { return this.operations.cancel(kind); }

  async verify(filePath: string) {
    return verifyDesktopFile(await this.permissions.requireKnownDocument(filePath));
  }

  async saveBatchReport(input: DesktopBatchReportRequest) {
    const firstInputPath = await this.permissions.requireInput(input.firstInputPath);
    const outputDirectory = input.outputDirectory
      ? await this.permissions.requireOutputDirectory(input.outputDirectory) : dirname(firstInputPath);
    const settings = await this.loadSettings();
    const items = [];
    for (const item of input.items) {
      const output = item.output ? await this.permissions.requireGenerated(item.output) : undefined;
      const report = item.report ? await this.permissions.requireGenerated(item.report) : undefined;
      items.push({ ...item, output, report });
    }
    const result = await writeDesktopBatchReport({
      reportDirectory: join(outputDirectory, "output"), mode: input.mode,
      settings, batchTargetBytes: input.batchTargetBytes, items
    });
    await this.permissions.registerGenerated(result.reportPath);
    return result;
  }

  async preview(input: DesktopImagePreviewInput) {
    return previewImageDiffs(await this.permissions.requireInput(input.originalPath),
      await this.permissions.requireGenerated(input.optimizedPath), {
        maxItems: input.maxItems, maxInputBytes: input.maxInputBytes, resourceMappings: input.resourceMappings
      });
  }

  async warm(): Promise<void> {
    try { await this.worker.warm(); }
    catch { /* Opportunistic: the next request recreates a stopped worker. */ }
  }

  async close() {
    try { return await this.operations.close(); }
    finally { await this.worker.dispose(); }
  }
}
const OPTIMIZATION_MODES: readonly OptimizationMode[] = ["safe", "balanced", "aggressive"];

function validateOptimizeInput(input: {
  filePath: unknown;
  mode: unknown;
  outputDirectory?: unknown;
  outputMode?: unknown;
  actions?: unknown;
  targetBytes?: unknown;
  jpegQuality?: unknown;
}): void {
  if (typeof input.filePath !== "string" || input.filePath.length === 0) {
    throw new Error("Invalid optimize request: filePath must be a non-empty string.");
  }
  if (!OPTIMIZATION_MODES.includes(input.mode as OptimizationMode)) {
    throw new Error("Invalid optimize request: mode must be safe, balanced, or aggressive.");
  }
  if (input.actions !== undefined && (!Array.isArray(input.actions) || input.actions.some((action) => typeof action !== "string"))) {
    throw new Error("Invalid optimize request: actions must be an array of strings.");
  }
  if (input.targetBytes !== undefined && (typeof input.targetBytes !== "number" || !Number.isFinite(input.targetBytes) || input.targetBytes <= 0)) {
    throw new Error("Invalid optimize request: targetBytes must be a positive number.");
  }
  if (
    input.jpegQuality !== undefined &&
    (typeof input.jpegQuality !== "number" ||
      !Number.isInteger(input.jpegQuality) ||
      input.jpegQuality < JPEG_QUALITY_FLOOR ||
      input.jpegQuality > JPEG_QUALITY_CEILING)
  ) {
    throw new Error(`Invalid optimize request: jpegQuality must be an integer between ${JPEG_QUALITY_FLOOR} and ${JPEG_QUALITY_CEILING}.`);
  }
  if (input.outputMode !== undefined && input.outputMode !== "single" && input.outputMode !== "batch") {
    throw new Error("Invalid optimize request: outputMode must be 'single' or 'batch'.");
  }
}

