import type { DesktopSettingsSnapshot as DesktopSettings } from "../shared/desktopSettings.js";
export type { DesktopSettingsSnapshot as DesktopSettings } from "../shared/desktopSettings.js";
import type { OptimizationReport } from "@hwpx-optimizer/core";
import type { PreservationPreference, SubmissionActionId, SubmissionLimit, SubmissionPlan } from "../shared/submissionPlan.js";
import { DEFAULT_JPEG_QUALITY } from "../shared/qualityPolicy.js";
import { fileNameFromPath } from "../shared/format.js";
import { applyOptimizationResultToBatchItem } from "../shared/batchView.js";

export type BatchItem = {
  path: string;
  fileName: string;
  selected: boolean;
  status: "pending" | "running" | "done" | "failed" | "cancelled";
  report?: OptimizationReport;
  analysisReport?: OptimizationReport;
  actualSizeBytes?: number;
  actualSizeLabel?: string;
  outputPath?: string;
  reportPath?: string;
  originalSizeBytes?: number;
  expectedSizeBytes?: number;
  originalSizeLabel?: string;
  expectedSizeLabel?: string;
  targetLabel?: string;
  targetStatusLabel?: string;
  qualityLabel?: string;
  jpegQualityDisplay?: number;
  qualityEditable?: boolean;
  jpegQualityOverride?: number;
  allocatedTargetLabel?: string;
  savedBytes?: number;
  savedPercent?: number;
  error?: string;
};

export type BatchTargetMode = "aggregate" | "per-file";

export type AppState = {
  view: "empty" | "single" | "batch";
  filePath?: string;
  report?: OptimizationReport;
  result?: { outputPath: string; reportPath?: string; report: OptimizationReport };
  batchReportPath?: string;
  mode: "safe" | "balanced" | "aggressive";
  outputDirectory?: string;
  settings?: DesktopSettings;
  actionSelections: Map<SubmissionActionId, boolean>;
  submissionLimit: SubmissionLimit;
  preservationPreference: PreservationPreference;
  batchTargetMode: BatchTargetMode;
  qualityMode: "auto" | "manual";
  jpegQuality: number;
  currentPlan?: SubmissionPlan;
  batchItems: BatchItem[];
  batchAnalyzing: boolean;
  batchRunning: boolean;
  batchCancelled: boolean;
  batchRunCompleted: boolean;
  analysisRunning: boolean;
  optimizeRunning: boolean;
};

export function createRendererState(): AppState {
  return {
    view: "empty",
    mode: "safe",
    actionSelections: new Map(),
    submissionLimit: { id: "mb40" },
    preservationPreference: "recommended",
    batchTargetMode: "per-file",
    qualityMode: "auto",
    jpegQuality: DEFAULT_JPEG_QUALITY,
    batchItems: [],
    batchAnalyzing: false,
    batchRunning: false,
    batchCancelled: false,
    batchRunCompleted: false,
    analysisRunning: false,
    optimizeRunning: false
  };
}

type AnalysisToken = { sequence: number; path: string };

/** Document transitions only: no DOM, IPC, timers or filesystem dependencies. */
export class RendererWorkflow {
  private analysisSequence = 0;
  constructor(readonly state = createRendererState()) {}

  get busy(): boolean {
    return this.state.analysisRunning || this.state.optimizeRunning || this.state.batchAnalyzing || this.state.batchRunning;
  }

  selectSingle(path: string): boolean {
    if (this.busy) return false;
    this.analysisSequence += 1;
    Object.assign(this.state, { view: "single", filePath: path, report: undefined, result: undefined,
      batchItems: [], batchRunCompleted: false, batchReportPath: undefined, currentPlan: undefined, analysisRunning: true });
    this.state.actionSelections.clear();
    return true;
  }

  appendBatch(paths: string[], preservePolicy = false): boolean {
    if (this.busy) return false;
    Object.assign(this.state, { view: "batch", filePath: undefined, report: undefined, result: undefined,
      batchReportPath: undefined, batchRunCompleted: false, currentPlan: undefined });
    if (!preservePolicy) this.state.actionSelections.clear();
    const seen = new Set(this.state.batchItems.map(item => item.path));
    for (const path of paths) {
      if (seen.has(path)) continue;
      seen.add(path);
      this.state.batchItems.push({ path, fileName: fileNameFromPath(path), selected: true, status: "pending" });
    }
    return true;
  }

  clearSelection(): void {
    this.analysisSequence += 1;
    Object.assign(this.state, { view: "empty", filePath: undefined, report: undefined, result: undefined,
      currentPlan: undefined, batchItems: [], batchReportPath: undefined, batchRunCompleted: false, batchCancelled: false });
    this.state.actionSelections.clear();
  }

  promote(item: BatchItem): void {
    this.analysisSequence += 1;
    Object.assign(this.state, { view: "single", filePath: item.path, report: item.report, result: undefined,
      currentPlan: undefined, batchItems: [], batchReportPath: undefined, batchRunCompleted: false, batchCancelled: false });
    this.state.actionSelections.clear();
  }

  removeBatchItem(index: number): boolean {
    if (this.busy || !this.state.batchItems[index]) return false;
    this.state.batchItems.splice(index, 1);
    return true;
  }

  selectBatchItem(index: number, selected: boolean): void {
    if (!this.busy && this.state.batchItems[index]) this.state.batchItems[index].selected = selected;
  }

  selectAllPending(selected: boolean): void {
    if (this.busy) return;
    for (const item of this.state.batchItems) if (item.status === "pending") item.selected = selected;
  }

  beginAnalysis(path: string): AnalysisToken {
    this.state.analysisRunning = true;
    return { sequence: ++this.analysisSequence, path };
  }

  isCurrentAnalysis(token: AnalysisToken): boolean {
    return token.sequence === this.analysisSequence && token.path === this.state.filePath;
  }

  acceptAnalysis(token: AnalysisToken, report: OptimizationReport, mode: "quick" | "deep"): boolean {
    if (!this.isCurrentAnalysis(token)) return false;
    this.state.report = report;
    if (mode === "quick") this.state.actionSelections.clear();
    return true;
  }

  finishAnalysis(token: AnalysisToken): boolean {
    if (!this.isCurrentAnalysis(token)) return false;
    this.state.analysisRunning = false;
    return true;
  }

  cancelAnalysis(): void {
    this.state.batchCancelled = this.state.batchAnalyzing;
    this.analysisSequence += 1;
  }
  finishCancelledAnalysis(): void { this.state.analysisRunning = false; }

  beginOptimization(): string | undefined {
    if (!this.state.filePath || !this.state.report || this.state.optimizeRunning) return undefined;
    this.state.optimizeRunning = true;
    return this.state.filePath;
  }
  acceptOptimization(path: string, result: NonNullable<AppState["result"]>): boolean {
    if (path !== this.state.filePath) return false;
    this.state.result = result;
    return true;
  }
  finishOptimization(path: string): boolean {
    this.state.optimizeRunning = false;
    return path === this.state.filePath;
  }

  retrySingle(): boolean {
    if (this.busy || !this.state.result || !this.state.report) return false;
    this.state.result = undefined;
    return true;
  }

  beginBatchAnalysis(): void { this.state.batchAnalyzing = true; this.state.batchCancelled = false; }
  finishBatchAnalysis(): void { this.state.batchAnalyzing = false; }
  beginBatch(): void {
    this.state.batchRunning = true;
    this.state.batchRunCompleted = false;
    this.state.batchCancelled = false;
  }
  cancelBatch(): void { this.state.batchCancelled = true; }
  finishBatch(): void { this.state.batchRunning = false; this.state.batchRunCompleted = true; }
  setBatchReport(path: string | undefined): void { this.state.batchReportPath = path; }
  recordBatchAnalysis(item: BatchItem, report: OptimizationReport): void {
    item.report = report;
    item.analysisReport = report;
    item.originalSizeBytes = report.originalSize;
  }
  cancelBatchItem(item: BatchItem): void { item.status = "cancelled"; }
  beginBatchItem(item: BatchItem): void { item.status = "running"; }
  completeBatchItem(item: BatchItem, result: NonNullable<AppState["result"]>): void {
    Object.assign(item, applyOptimizationResultToBatchItem(item, result));
  }
  failBatchItem(item: BatchItem, error?: string): void {
    item.status = error === undefined ? "cancelled" : "failed";
    item.error = error;
  }

  retryBatch(): number {
    if (this.state.batchRunning || this.state.batchAnalyzing) return 0;
    let count = 0;
    for (const item of this.state.batchItems) {
      if (item.status !== "done" && item.status !== "failed" && item.status !== "cancelled") continue;
      Object.assign(item, { status: "pending", report: item.analysisReport ?? (item.report?.kind === "analysis" ? item.report : undefined),
        actualSizeBytes: undefined, actualSizeLabel: undefined, outputPath: undefined, reportPath: undefined,
        savedBytes: undefined, savedPercent: undefined, error: undefined });
      count += 1;
    }
    this.state.batchReportPath = undefined;
    this.state.batchRunCompleted = false;
    return count;
  }
}

