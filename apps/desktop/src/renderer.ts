import {
  appendUniquePaths,
  applyOptimizationResultToBatchItem,
  batchResultTitleForCounts,
  selectionModeForPaths,
  summarizeBatchItems
} from "./shared/batchView.js";
import { escapeHtml, fileNameFromPath, looksLikeOptimizedFileName } from "./shared/format.js";
import { actionLabel, errorLabel, groupWarnings, modeLabel, modeWarningMessage, progressLabel } from "./shared/labels.js";
import {
  batchItemRowHtml,
  categoryBarHtml,
  imageComparePairHtml,
  metricHtml
} from "./shared/templates.js";
import { createAnalysisViewModel, formatBytes } from "./shared/viewModel.js";
import type { OptimizationReport } from "@hwpx-optimizer/core";
import type { HwpxOptimizerApi } from "./preload.js";
import {
  allocateRemainingAggregateTargetBytes,
  summarizeAggregateTargetAllocation
} from "./shared/batchTargetAlloc.js";
import type { AggregateTargetAllocationSummary } from "./shared/batchTargetAlloc.js";
import { resultGuidanceText } from "./shared/resultGuidance.js";
import {
  createSubmissionPlan,
  modeForPreservation,
  preservationForMode,
  resolveSubmissionLimitBytes
} from "./shared/submissionPlan.js";
import type {
  PreservationPreference,
  SubmissionActionId,
  SubmissionLimit,
  SubmissionPlan
} from "./shared/submissionPlan.js";

const JPEG_QUALITY_FLOOR = 60;
const JPEG_QUALITY_CEILING = 95;
const DEFAULT_JPEG_QUALITY = 88;

declare global {
  interface Window {
    hwpxOptimizer: HwpxOptimizerApi;
  }
}

type BatchItem = {
  path: string;
  fileName: string;
  selected: boolean;
  status: "pending" | "running" | "done" | "failed" | "cancelled";
  report?: OptimizationReport;
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

type BatchTargetMode = "aggregate" | "per-file";

type AppState = {
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

type DisplayPlanRow = {
  label: string;
  savingLabel: string;
  kind: string;
  detail?: string;
  checked?: boolean;
  action?: SubmissionActionId;
  actions?: SubmissionActionId[];
  priority?: number;
};

type BatchPlanSummary = {
  analyzedCount: number;
  selectedCount: number;
  rowCount: number;
  reviewCount: number;
  metCount: number;
  warningCount: number;
  expectedSizeBytes: number;
  expectedSavingBytes: number;
  rows: DisplayPlanRow[];
};

const state: AppState = {
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

let settingsSaveSequence = 0;
let analysisSequence = 0;
let progressAnimationTimer: number | undefined;
let displayedProgressPercent = 0;
let targetProgressPercent = 0;
let dragDepth = 0;
const CLEANUP_ACTIONS = ["clean-shape-comment", "strip-metadata"] as const satisfies readonly SubmissionActionId[];

type DesktopSettings = {
  defaultMode: AppState["mode"];
  saveNextToOriginal: boolean;
  saveReport: boolean;
  preventOverwrite: boolean;
  showAggressiveWarning: boolean;
  submissionLimit: SubmissionLimit;
  preservationPreference: PreservationPreference;
  batchTargetMode: BatchTargetMode;
};

const dropOverlay = requireElement("drop-overlay");
const dropZone = requireElement("drop-zone");
const fileName = requireElement("file-name");
const fileMeta = requireElement("file-meta");
const chooseButton = requireButton("choose-button");
const chooseFolderButton = requireButton("choose-folder-button");
const emptyChooseButton = requireButton("empty-choose-button");
const emptyFolderButton = requireButton("empty-folder-button");
const optimizeButton = requireButton("optimize-button");
const batchPanel = requireElement("batch-panel");
const batchList = requireElement("batch-list");
const batchSelectAll = requireInput("batch-select-all");
const batchSummary = requireElement("batch-summary");
const batchClearButton = requireButton("batch-clear");
const batchRunButton = requireButton("batch-run");
const outputButton = requireButton("output-button");
const outputDirectoryLine = requireElement("output-directory-line");
const settingsButton = requireButton("settings-button");
const settingsPanel = requireElement("settings-panel");
const settingsBackdrop = requireElement("settings-backdrop");
const settingsCloseButton = requireButton("settings-close-button");
const helpButton = requireButton("help-button");
const helpPanel = requireElement("help-panel");
const helpBackdrop = requireElement("help-backdrop");
const helpCloseButton = requireButton("help-close-button");
const resultPanel = requireElement("result-panel");
const resultSummary = requireElement("result-summary");
const resultGuidance = requireElement("result-guidance");
const batchResultPanel = requireElement("batch-result-panel");
const batchResultTitle = requireElement("batch-result-title");
const batchResultLine = requireElement("batch-result-line");
const batchResultStats = requireElement("batch-result-stats");
const batchResultDetails = requireElement("batch-result-details");
const batchOpenFolderButton = requireButton("batch-open-folder-button");
const batchOpenReportButton = requireButton("batch-open-report-button");
const batchRetryButton = requireButton("batch-retry-button");
const progressPanel = requireElement("progress-panel");
const progressTitle = requireElement("progress-title");
const progressBar = requireElement("progress-bar");
const progressItem = requireElement("progress-item");
const analysisGrid = requireElement("analysis-grid");
const categoryChart = requireElement("category-chart");
const opportunityList = requireElement("opportunity-list");
const actionPanel = requireElement("action-panel");
const actionPanelHint = requireElement("action-panel-hint");
const actionCheckboxes = requireElement("action-checkboxes");
const actionSelectAll = requireButton("action-select-all");
const actionSelectNone = requireButton("action-select-none");
const actionReset = requireButton("action-reset");
const warningList = requireElement("warning-list");
const statusText = requireElement("status-text");
const statusBanner = requireElement("status-banner");
const statusBannerText = requireElement("status-banner-text");
const modeInputs = Array.from(document.querySelectorAll<HTMLInputElement>("input[name='mode']"));
const openFileButton = requireButton("open-file-button");
const openReportButton = requireButton("open-report-button");
const openFolderButton = requireButton("open-folder-button");
const reverifyButton = requireButton("reverify-button");
const compareButton = requireButton("compare-button");
const compareModal = requireElement("compare-modal");
const compareList = requireElement("compare-list");
const compareSummary = requireElement("compare-summary");
const compareCloseButton = requireButton("compare-close");
const cancelButton = requireButton("cancel-button");
const settingDefaultMode = requireSelect("setting-default-mode");
const settingSubmissionLimit = requireSelect("setting-submission-limit");
const settingCustomLimitField = requireElement("setting-custom-limit-field");
const settingCustomLimitInput = requireInput("setting-custom-limit-input");
const settingSaveNext = requireInput("setting-save-next");
const settingSaveReport = requireInput("setting-save-report");
const settingPreventOverwrite = requireInput("setting-prevent-overwrite");
const settingAggressiveWarning = requireInput("setting-aggressive-warning");
const settingOutputDirectory = requireElement("setting-output-directory");
const settingOutputButton = requireButton("setting-output-button");
const settingOutputResetButton = requireButton("setting-output-reset-button");
const singleWorkspace = requireElement("single-workspace");
const submissionLimitSelect = requireSelect("submission-limit-select");
const customLimitField = requireElement("custom-limit-field");
const customLimitInput = requireInput("custom-limit-input");
const preservationSelect = requireSelect("preservation-select");
const batchTargetModeSelect = requireSelect("batch-target-mode-select");
const cleanupDocumentToggle = requireInput("cleanup-document-toggle");
const cleanupImageToggle = requireInput("cleanup-image-toggle");
const planTitle = requireElement("plan-title");
const planSummary = requireElement("plan-summary");
const planTotal = requireElement("plan-total");
const planCountPill = requireElement("plan-count-pill");
const optionPlanSummary = requireElement("option-plan-summary");
const analysisDetailSummary = requireElement("analysis-detail-summary");
const analysisDetails = requireElement("analysis-details") as HTMLDetailsElement;
const verificationBody = requireElement("verification-body");
const selectionPill = requireElement("selection-pill");
const selectedFileCard = requireElement("selected-file-card");
const selectedFileName = requireElement("selected-file-name");
const selectedFilePath = requireElement("selected-file-path");
const selectedOriginalMeta = requireElement("selected-original-meta");
const selectedModifiedMeta = requireElement("selected-modified-meta");
const singleOriginalSize = requireElement("single-original-size");
const singleExpectedSize = requireElement("single-expected-size");
const singleSavingRing = requireElement("single-saving-ring");
const summaryOriginal = requireElement("summary-original");
const summaryExpected = requireElement("summary-expected");
const summarySaving = requireElement("summary-saving");
const summaryPercent = requireElement("summary-percent");
const summaryStatus = requireElement("summary-status");
const summaryResultLine = requireElement("summary-result-line");
const summaryTargetLine = requireElement("summary-target-line");
const targetTrackFill = requireElement("target-track-fill");
const targetTrackLimit = requireElement("target-track-limit");
const summaryVerdict = requireElement("summary-verdict");
const summaryVerdictDetail = requireElement("summary-verdict-detail");
const targetRow = requireElement("gauge-hero").querySelector(".target-row") as HTMLElement;
const qualityControls = requireElement("quality-controls");
const qualityModeAuto = requireButton("quality-mode-auto");
const qualityModeManual = requireButton("quality-mode-manual");
const qualityManual = requireElement("quality-manual");
const batchQualityAuto = requireElement("batch-quality-auto");
const batchQualityAvg = requireElement("batch-quality-avg");
const qualityHeadLabel = requireElement("quality-head-label");
const jpegQualitySlider = requireInput("jpeg-quality-slider");
const jpegQualityInput = requireInput("jpeg-quality-input");
const qualityPlannedLabel = requireElement("quality-planned-label");
const qualityHint = requireElement("quality-hint");
const heroChips = requireElement("hero-chips");
const chipPolicy = requireElement("chip-policy");
const chipLimit = requireElement("chip-limit");
const chipQuality = requireElement("chip-quality");
const gaugeMidLabel = requireElement("gauge-mid-label");
const gaugeStartLabel = requireElement("gauge-start-label");
const gaugeEndLabel = requireElement("gauge-end-label");
const reviewStrip = requireElement("review-strip");
const reviewStripTitle = requireElement("review-strip-title");
const reviewStripDetail = requireElement("review-strip-detail");
const reviewStripChips = requireElement("review-strip-chips");
const summaryGrid = requireElement("summary-grid");
const detailOptionsSheet = requireElement("detail-options-sheet");
const toggleOptionsButton = requireButton("toggle-options-button");
const policyLive = requireElement("policy-live");
const runDock = requireElement("run-dock");
const runDockStatus = requireElement("run-dock-status");
const runDockSummary = requireElement("run-dock-summary");
const runDockButton = requireButton("run-dock-button");

void init();

async function init(): Promise<void> {
  const settings = (await window.hwpxOptimizer.loadSettings()) as DesktopSettings;
  state.settings = settings;
  // Toolbar preservation is the product control; keep mode / 기본 모드 in sync with it.
  state.preservationPreference = settings.preservationPreference ?? "recommended";
  state.mode = modeForPreservation(state.preservationPreference);
  state.submissionLimit = settings.submissionLimit ?? { id: "mb40" };
  state.batchTargetMode = settings.batchTargetMode ?? "per-file";
  renderSettings({ ...settings, defaultMode: state.mode });
  renderSubmissionControls();
  renderQualityControls();
  const modeInput = modeInputs.find((input) => input.value === state.mode);
  if (modeInput) modeInput.checked = true;
  if (settings.defaultMode !== state.mode) {
    void saveSettings({ defaultMode: state.mode });
  }

  const selectFiles = async () => {
    const selected = await window.hwpxOptimizer.selectHwpxMany();
    if (selected && selected.length > 0) await handleAdditionalPaths(selected);
  };

  chooseButton.addEventListener("click", selectFiles);
  emptyChooseButton.addEventListener("click", selectFiles);

  const selectFolder = async () => {
    const result = await window.hwpxOptimizer.selectHwpxFolder();
    if (!result) return;
    if (result.files.length === 0) {
      setStatus(`${result.directory} 안에 HWPX 파일이 없습니다.`);
      return;
    }
    await handleAdditionalPaths(result.files);
  };

  chooseFolderButton.addEventListener("click", selectFolder);
  emptyFolderButton.addEventListener("click", selectFolder);

  batchClearButton.addEventListener("click", () => {
    if (state.batchRunning || state.batchAnalyzing) return;
    clearSelectedFiles(document.body.dataset.view === "batch" ? "배치 목록을 비웠습니다." : "선택한 파일을 제거했습니다.");
  });

  batchRunButton.addEventListener("click", () => {
    void runBatch();
  });
  batchList.addEventListener("click", (event) => {
    const editButton = (event.target as Element | null)?.closest<HTMLButtonElement>("button[data-batch-quality-edit]");
    if (editButton) {
      handleBatchQualityEditClick(editButton);
      return;
    }
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>("button[data-action]");
    if (button) handleBatchRowAction(button);
  });
  batchList.addEventListener("change", (event) => {
    const target = event.target as HTMLInputElement | null;
    if (!target) return;
    if (target.classList.contains("batch-quality-input")) {
      handleBatchQualityInput(target);
      return;
    }
    if (!target.classList.contains("batch-select")) return;
    const index = Number(target.dataset.batchIndex);
    const item = Number.isInteger(index) ? state.batchItems[index] : undefined;
    if (!item) return;
    item.selected = target.checked;
    refreshBatchPlans();
    renderBatchList();
  });
  batchSelectAll.addEventListener("change", () => {
    if (state.batchRunning || state.batchAnalyzing) return;
    for (const item of state.batchItems) {
      if (item.status === "pending") item.selected = batchSelectAll.checked;
    }
    refreshBatchPlans();
    renderBatchList();
  });

  outputButton.addEventListener("click", async () => {
    const selected = await window.hwpxOptimizer.selectDirectory();
    if (selected) {
      applySessionOutputDirectory(selected);
      setStatus("이번 실행의 저장 위치를 변경했습니다.");
    }
  });

  optimizeButton.addEventListener("click", () => {
    if (document.body.dataset.view === "batch") {
      void runBatch();
      return;
    }
    void optimizeCurrentFile();
  });
  runDockButton.addEventListener("click", () => optimizeButton.click());
  cancelButton.addEventListener("click", async () => {
    if (state.analysisRunning || state.batchAnalyzing) {
      const cancellingBatchAnalysis = state.batchAnalyzing;
      state.batchCancelled = cancellingBatchAnalysis;
      // Invalidate the in-flight analyze so a late resolve can't overwrite the
      // cancelled status with a normal result (best-effort backend cancel).
      analysisSequence += 1;
      state.analysisRunning = false;
      await window.hwpxOptimizer.cancelAnalyze();
      setStatus("분석을 취소했습니다.");
      if (!cancellingBatchAnalysis) {
        setIdle();
        hideProgressPanel();
        return;
      }
      return;
    }
    if (state.batchRunning) {
      state.batchCancelled = true;
    }
    await window.hwpxOptimizer.cancelOptimize();
    setStatus("최적화를 취소했습니다.");
    setIdle();
  });
  settingsButton.addEventListener("click", () => setSettingsOpen(!settingsPanel.classList.contains("is-open")));
  settingsCloseButton.addEventListener("click", () => setSettingsOpen(false));
  settingsBackdrop.addEventListener("click", () => setSettingsOpen(false));
  helpButton.addEventListener("click", () => setHelpOpen(!helpPanel.classList.contains("is-open")));
  helpCloseButton.addEventListener("click", () => setHelpOpen(false));
  helpBackdrop.addEventListener("click", () => setHelpOpen(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!compareModal.hidden) {
        closeImageCompareModal();
        return;
      }
      setSettingsOpen(false);
      setHelpOpen(false);
      return;
    }
    if (event.key === "Tab") {
      const overlay = openOverlayElement();
      if (overlay) trapFocus(event, overlay);
    }
  });
  openFileButton.addEventListener("click", () => state.result && window.hwpxOptimizer.openPath(state.result.outputPath));
  openReportButton.addEventListener(
    "click",
    () => state.result?.reportPath && window.hwpxOptimizer.openPath(state.result.reportPath)
  );
  openFolderButton.addEventListener("click", () => state.result && window.hwpxOptimizer.showItem(state.result.outputPath));
  batchOpenFolderButton.addEventListener("click", () => {
    const firstOutput = state.batchItems.find((item) => item.status === "done" && item.outputPath)?.outputPath;
    if (firstOutput) void window.hwpxOptimizer.showItem(firstOutput);
  });
  batchOpenReportButton.addEventListener("click", () => {
    if (state.batchReportPath) void window.hwpxOptimizer.openPath(state.batchReportPath);
  });
  batchRetryButton.addEventListener("click", resetBatchCompletedItems);
  reverifyButton.addEventListener("click", reverifyCurrentResult);
  compareButton.addEventListener("click", openImageCompareModal);
  compareCloseButton.addEventListener("click", closeImageCompareModal);
  compareModal.addEventListener("click", (event) => {
    if (event.target === compareModal) closeImageCompareModal();
  });

  for (const input of modeInputs) {
    input.addEventListener("change", () => {
      state.mode = input.value as AppState["mode"];
      state.preservationPreference = preservationForMode(state.mode);
      settingDefaultMode.value = state.mode;
      void saveSettings({
        defaultMode: state.mode,
        preservationPreference: state.preservationPreference
      });
      renderModeWarning();
      renderSubmissionControls();
      renderQualityControls();
      refreshSubmissionPlan();
      refreshBatchPlans();
    });
  }

  actionSelectAll.addEventListener("click", () => {
    setAllActionSelections(true);
    refreshSubmissionPlan();
  });
  actionSelectNone.addEventListener("click", () => {
    setAllActionSelections(false);
    refreshSubmissionPlan();
  });
  actionReset.addEventListener("click", () => {
    state.actionSelections.clear();
    refreshSubmissionPlan();
  });
  actionCheckboxes.addEventListener("change", (event) => {
    const target = event.target as HTMLInputElement | null;
    if (!target || target.type !== "checkbox") return;
    const actions = actionValuesFromCheckbox(target);
    for (const action of actions) {
      state.actionSelections.set(action, target.checked);
    }
    refreshSubmissionPlan();
  });

  submissionLimitSelect.addEventListener("change", () => {
    state.submissionLimit = {
      id: submissionLimitSelect.value as SubmissionLimit["id"],
      customBytes: state.submissionLimit.customBytes
    };
    renderSubmissionControls();
    refreshSubmissionPlan();
    refreshBatchPlans();
    void saveSettings({ submissionLimit: state.submissionLimit });
  });
  customLimitInput.addEventListener("change", () => {
    const value = Number(customLimitInput.value);
    state.submissionLimit = {
      id: "custom",
      customBytes: Number.isFinite(value) && value > 0 ? value * 1024 * 1024 : undefined
    };
    renderSubmissionControls();
    refreshSubmissionPlan();
    refreshBatchPlans();
    void saveSettings({ submissionLimit: state.submissionLimit });
  });
  preservationSelect.addEventListener("change", () => {
    state.preservationPreference = preservationSelect.value as PreservationPreference;
    state.mode = modeForPreservation(state.preservationPreference);
    state.actionSelections.clear();
    if (state.preservationPreference === "size") {
      state.qualityMode = "auto";
      for (const item of state.batchItems) delete item.jpegQualityOverride;
    }
    const modeInput = modeInputs.find((input) => input.value === state.mode);
    if (modeInput) modeInput.checked = true;
    settingDefaultMode.value = state.mode;
    renderSubmissionControls();
    renderQualityControls();
    refreshSubmissionPlan();
    refreshBatchPlans();
    void saveSettings({
      preservationPreference: state.preservationPreference,
      defaultMode: state.mode
    });
  });
  batchTargetModeSelect.addEventListener("change", () => {
    state.batchTargetMode = batchTargetModeSelect.value as BatchTargetMode;
    renderSubmissionControls();
    refreshBatchPlans();
    void saveSettings({ batchTargetMode: state.batchTargetMode });
  });

  qualityModeAuto.addEventListener("click", () => {
    state.qualityMode = "auto";
    for (const item of state.batchItems) delete item.jpegQualityOverride;
    renderQualityControls();
    refreshSubmissionPlan();
    refreshBatchPlans();
  });
  qualityModeManual.addEventListener("click", () => {
    if (state.preservationPreference === "size") return;
    state.qualityMode = "manual";
    // Seed bulk % from selected planned average when entering manual.
    const selectedQualities = state.batchItems
      .filter((item) => item.selected && item.jpegQualityDisplay !== undefined)
      .map((item) => item.jpegQualityDisplay as number);
    if (selectedQualities.length > 0) {
      state.jpegQuality = clampJpegQuality(
        Math.round(selectedQualities.reduce((sum, value) => sum + value, 0) / selectedQualities.length)
      );
    }
    for (const item of state.batchItems) delete item.jpegQualityOverride;
    renderQualityControls();
    refreshSubmissionPlan();
    refreshBatchPlans();
  });
  const syncManualQuality = (raw: number) => {
    if (state.preservationPreference === "size") return;
    state.jpegQuality = clampJpegQuality(raw);
    state.qualityMode = "manual";
    renderQualityControls();
    refreshSubmissionPlan();
    refreshBatchPlans();
  };
  jpegQualitySlider.addEventListener("input", () => syncManualQuality(Number(jpegQualitySlider.value)));
  jpegQualityInput.addEventListener("change", () => syncManualQuality(Number(jpegQualityInput.value)));
  toggleOptionsButton.addEventListener("click", () => {
    const open = detailOptionsSheet.hidden;
    detailOptionsSheet.hidden = !open;
    toggleOptionsButton.setAttribute("aria-expanded", open ? "true" : "false");
    toggleOptionsButton.classList.toggle("is-active", open);
  });

  cleanupDocumentToggle.addEventListener("change", () => {
    state.actionSelections.set("clean-shape-comment", cleanupDocumentToggle.checked);
    refreshSubmissionPlan();
    refreshBatchPlans();
  });
  cleanupImageToggle.addEventListener("change", () => {
    state.actionSelections.set("strip-metadata", cleanupImageToggle.checked);
    refreshSubmissionPlan();
    refreshBatchPlans();
  });

  settingDefaultMode.addEventListener("change", () => {
    const nextMode = settingDefaultMode.value as AppState["mode"];
    state.mode = nextMode;
    state.preservationPreference = preservationForMode(nextMode);
    state.actionSelections.clear();
    if (state.preservationPreference === "size") {
      state.qualityMode = "auto";
      for (const item of state.batchItems) delete item.jpegQualityOverride;
    }
    const modeInput = modeInputs.find((input) => input.value === nextMode);
    if (modeInput) modeInput.checked = true;
    renderSubmissionControls();
    renderQualityControls();
    refreshSubmissionPlan();
    refreshBatchPlans();
    void saveSettings({
      defaultMode: nextMode,
      preservationPreference: state.preservationPreference
    });
  });
  settingSubmissionLimit.addEventListener("change", () => {
    state.submissionLimit = {
      id: settingSubmissionLimit.value as SubmissionLimit["id"],
      customBytes: state.submissionLimit.customBytes
    };
    settingCustomLimitField.hidden = state.submissionLimit.id !== "custom";
    renderSubmissionControls();
    refreshSubmissionPlan();
    refreshBatchPlans();
    void saveSettings({ submissionLimit: state.submissionLimit });
  });
  settingCustomLimitInput.addEventListener("change", () => {
    const value = Number(settingCustomLimitInput.value);
    state.submissionLimit = {
      id: "custom",
      customBytes: Number.isFinite(value) && value > 0 ? value * 1024 * 1024 : undefined
    };
    renderSubmissionControls();
    refreshSubmissionPlan();
    refreshBatchPlans();
    void saveSettings({ submissionLimit: state.submissionLimit });
  });
  settingSaveNext.addEventListener("change", async () => {
    if (settingSaveNext.checked) {
      state.outputDirectory = undefined;
      void saveSettings({ saveNextToOriginal: true });
      return;
    }
    const selected = await window.hwpxOptimizer.selectDirectory();
    if (selected) {
      applySessionOutputDirectory(selected);
      setStatus("이번 실행의 저장 위치를 변경했습니다.");
      return;
    }
    applySessionSaveNextToOriginal(true);
  });
  settingSaveReport.addEventListener("change", () => void saveSettings({ saveReport: settingSaveReport.checked }));
  settingPreventOverwrite.addEventListener(
    "change",
    () => void saveSettings({ preventOverwrite: settingPreventOverwrite.checked })
  );
  settingAggressiveWarning.addEventListener(
    "change",
    () => void saveSettings({ showAggressiveWarning: settingAggressiveWarning.checked })
  );
  settingOutputButton.addEventListener("click", async () => {
    const selected = await window.hwpxOptimizer.selectDirectory();
    if (selected) {
      applySessionOutputDirectory(selected);
      setStatus("이번 실행의 저장 위치를 변경했습니다.");
    }
  });
  settingOutputResetButton.addEventListener("click", async () => {
    state.outputDirectory = undefined;
    await saveSettings({ saveNextToOriginal: true });
    setStatus("원본 문서 폴더에 저장하도록 변경했습니다.");
  });

  document.addEventListener("dragenter", (event) => {
    event.preventDefault();
    dragDepth += 1;
    setDragOver(true);
  });
  document.addEventListener("dragover", (event) => {
    event.preventDefault();
    setDragOver(true);
  });
  document.addEventListener("dragleave", (event) => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0 || !event.relatedTarget) setDragOver(false);
  });
  document.addEventListener("drop", async (event) => {
    event.preventDefault();
    dragDepth = 0;
    setDragOver(false);
    const dropped = event.dataTransfer?.files;
    await handleDroppedFiles(dropped ? Array.from(dropped) : []);
  });

  renderModeWarning();
  renderEmptySummary();
  renderPlanActions();
  const unsubscribeOptimizeProgress = window.hwpxOptimizer.onOptimizeProgress((progress) => {
    renderProgress(progress.percent, progress.item);
  });
  window.addEventListener("beforeunload", unsubscribeOptimizeProgress, { once: true });
  document.body.dataset.preloadApi = "ready";
  document.body.dataset.appReady = "true";
}

async function handleSelectedPaths(paths: string[]): Promise<void> {
  const mode = selectionModeForPaths(paths);
  if (mode === "empty") return;
  if (mode === "single") {
    await loadFile(paths[0]);
    return;
  }
  enterBatchMode(paths);
}

async function handleAdditionalPaths(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  if (state.batchRunning || state.batchAnalyzing || state.analysisRunning || state.optimizeRunning) {
    setStatus("처리 중에는 새 파일을 추가할 수 없습니다. 완료 후 다시 시도하세요.");
    return;
  }
  if (document.body.dataset.view === "batch" && state.batchItems.length > 0) {
    const existingPaths = state.batchItems.map((item) => item.path);
    const mergedPaths = appendUniquePaths(existingPaths, paths);
    const additionalPaths = mergedPaths.slice(existingPaths.length);
    if (additionalPaths.length === 0) {
      setStatus("이미 배치 목록에 있는 파일입니다.");
      return;
    }
    enterBatchMode(additionalPaths, { preservePolicy: true });
    return;
  }
  if (document.body.dataset.view === "single" && state.filePath) {
    const merged = appendUniquePaths([state.filePath], paths);
    if (merged.length === 1) {
      setStatus("이미 선택한 파일입니다.");
      return;
    }
    enterBatchMode(merged);
    return;
  }
  await handleSelectedPaths(paths);
}

async function handleDroppedFiles(
  files: File[],
  options: { allowEmptyRegistration?: boolean; silentWhenEmpty?: boolean } = {}
): Promise<void> {
  if (files.length === 0 && !options.allowEmptyRegistration) {
    setStatus("HWPX 파일만 선택할 수 있습니다.");
    return;
  }
  const hwpxFiles = files.filter((file) => file.name.toLowerCase().endsWith(".hwpx"));
  const nonHwpx = files.length - hwpxFiles.length;
  let paths: string[] = [];
  try {
    paths = await window.hwpxOptimizer.registerDroppedHwpxFiles(hwpxFiles);
  } catch (error) {
    setStatus(errorMessage(error));
    return;
  }
  const unresolved = Math.max(0, hwpxFiles.length - paths.length);
  if (paths.length === 0) {
    if (options.silentWhenEmpty) return;
    if (unresolved > 0) {
      setStatus("드롭한 파일의 경로를 확인할 수 없습니다. 파일 선택 버튼을 사용하세요.");
    } else if (nonHwpx > 0) {
      setStatus("HWPX 파일만 선택할 수 있습니다.");
    } else {
      setStatus("처리할 HWPX 파일을 찾지 못했습니다.");
    }
    return;
  }
  await handleAdditionalPaths(paths);
}

async function saveSettings(patch: Partial<DesktopSettings>): Promise<void> {
  const sequence = ++settingsSaveSequence;
  const settings = (await window.hwpxOptimizer.saveSettings(patch)) as DesktopSettings;
  if (sequence !== settingsSaveSequence) return;
  state.settings = settings;
  state.submissionLimit = settings.submissionLimit ?? state.submissionLimit;
  state.preservationPreference = settings.preservationPreference ?? state.preservationPreference;
  state.batchTargetMode = settings.batchTargetMode ?? state.batchTargetMode;
  renderSettings(settings);
  renderSubmissionControls();
  if (state.report) refreshSubmissionPlan();
  if (state.batchItems.length > 0) refreshBatchPlans();
}

function renderSettings(settings: DesktopSettings): void {
  settingDefaultMode.value = settings.defaultMode;
  const settingLimit = settings.submissionLimit ?? state.submissionLimit;
  settingSubmissionLimit.value = settingLimit.id;
  settingCustomLimitField.hidden = settingLimit.id !== "custom";
  settingCustomLimitInput.value =
    settingLimit.id === "custom" && settingLimit.customBytes
      ? String(Math.round((settingLimit.customBytes / (1024 * 1024)) * 100) / 100)
      : "";
  settingSaveNext.checked = settings.saveNextToOriginal;
  settingSaveReport.checked = settings.saveReport;
  settingPreventOverwrite.checked = settings.preventOverwrite;
  settingAggressiveWarning.checked = settings.showAggressiveWarning;
  const usingOriginal = settings.saveNextToOriginal || !state.outputDirectory;
  settingOutputDirectory.textContent = usingOriginal
    ? "이번 실행 저장 위치: 원본 문서 폴더"
    : `이번 실행 저장 위치: ${state.outputDirectory}`;
  outputDirectoryLine.textContent = usingOriginal
    ? "저장 폴더: 원본 문서 폴더"
    : `저장 폴더: ${state.outputDirectory}`;
  settingOutputButton.disabled = settings.saveNextToOriginal;
  settingOutputResetButton.disabled = settings.saveNextToOriginal && !state.outputDirectory;
  renderRunDock(state.currentPlan);
}

let panelReturnFocus: HTMLElement | null = null;

function setSettingsOpen(open: boolean): void {
  if (open) setHelpOpen(false);
  const wasOpen = settingsPanel.classList.contains("is-open");
  settingsPanel.classList.toggle("is-open", open);
  settingsPanel.setAttribute("aria-hidden", open ? "false" : "true");
  settingsPanel.inert = !open;
  settingsBackdrop.hidden = !open;
  syncPanelFocus(open, wasOpen, settingsCloseButton);
}

function setHelpOpen(open: boolean): void {
  if (open) setSettingsOpen(false);
  const wasOpen = helpPanel.classList.contains("is-open");
  helpPanel.classList.toggle("is-open", open);
  helpPanel.setAttribute("aria-hidden", open ? "false" : "true");
  helpPanel.inert = !open;
  helpBackdrop.hidden = !open;
  syncPanelFocus(open, wasOpen, helpCloseButton);
}

// Move focus into a panel on open and restore it to the trigger on close, so a
// keyboard user is never left focused on an off-screen (inert) panel.
function syncPanelFocus(open: boolean, wasOpen: boolean, focusTarget: HTMLElement): void {
  if (open && !wasOpen) {
    panelReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    focusTarget.focus();
  } else if (!open && wasOpen) {
    panelReturnFocus?.focus();
    panelReturnFocus = null;
  }
}

function applySessionOutputDirectory(outputDirectory: string): void {
  state.outputDirectory = outputDirectory;
  applySessionSaveNextToOriginal(false);
}

function applySessionSaveNextToOriginal(saveNextToOriginal: boolean): void {
  if (!state.settings) return;
  const settings = { ...state.settings, saveNextToOriginal };
  state.settings = settings;
  renderSettings(settings);
}

function renderSubmissionControls(): void {
  submissionLimitSelect.value = state.submissionLimit.id;
  customLimitField.hidden = state.submissionLimit.id !== "custom";
  customLimitInput.value = state.submissionLimit.customBytes
    ? formatCustomLimitMb(state.submissionLimit.customBytes)
    : "";
  preservationSelect.value = state.preservationPreference;
  batchTargetModeSelect.value = state.batchTargetMode;
  renderCleanupSettings();
}

// Preserve a fractional MB entry (e.g. 0.5) instead of rounding it to an integer
// that no longer matches the stored byte value.
function formatCustomLimitMb(customBytes: number): string {
  const mb = customBytes / 1024 / 1024;
  return Number.isInteger(mb) ? String(mb) : String(Number(mb.toFixed(2)));
}

function refreshSubmissionPlan(): void {
  if (!state.report) {
    state.currentPlan = undefined;
    if (state.batchItems.length > 0) {
      renderBatchPlanSummary();
    } else {
      renderDefaultPlan();
    }
    renderRunDock();
    if (state.analysisRunning && state.filePath) {
      renderPendingAnalysisSummary();
    } else if (!state.batchItems.length) {
      renderEmptySummary();
    }
    optimizeButton.disabled = true;
    return;
  }
  const plan = createSubmissionPlan(state.report, {
    submissionLimit: state.submissionLimit,
    preservationPreference: state.preservationPreference,
    actionOverrides: state.actionSelections,
    ...(state.qualityMode === "manual" &&
    state.preservationPreference !== "preserve" &&
    state.preservationPreference !== "size"
      ? { jpegQuality: state.jpegQuality }
      : {})
  });
  state.currentPlan = plan;
  state.mode = plan.mode;
  planTitle.textContent = plan.kind === "custom" ? "사용자 지정 계획" : "자동 최적화 계획";
  const reviewNoteCount = plan.planNotes.filter((note) => note.kind === "review").length;
  const visibleRows = visiblePlanRows(plan);
  const visibleSelectedCount = visibleRows.filter((row) => row.checked).length;
  const cleanupSelectedCount = cleanupRows(plan).filter((row) => row.checked).length;
  planCountPill.textContent =
    reviewNoteCount > 0
      ? `용량 ${visibleSelectedCount}/${visibleRows.length} · 정리 ${cleanupSelectedCount}/2 · 확인 ${reviewNoteCount}`
      : `용량 ${visibleSelectedCount}/${visibleRows.length} · 정리 ${cleanupSelectedCount}/2`;
  planSummary.textContent = "절감량은 중복 제외 기준으로 계산합니다.";
  planTotal.textContent = `선택 예상 ${plan.expectedSavingLabel} · 결과 ${plan.expectedSizeLabel}`;
  optionPlanSummary.textContent = `${plan.targetStatusLabel} · 용량 작업 ${visibleSelectedCount}개 · 정리 ${cleanupSelectedCount}개`;
  actionPanelHint.textContent =
    plan.mode === "safe"
      ? "외형 보존 우선에서는 안전한 항목만 적용합니다."
      : "옵션을 바꾸면 사용자 지정 계획으로 전환됩니다.";
  renderPlanActions(plan);
  renderCleanupSettings(plan);
  syncActionCheckboxIndeterminateState();
  optimizeButton.disabled = false;
  renderSingleSummary(plan);
  renderRunDock(plan);
  renderModeWarning();
}

function renderDefaultPlan(): void {
  planTitle.textContent = "자동 최적화 계획";
  planSummary.textContent = "파일을 분석하면 예상 절감량을 표시합니다.";
  planTotal.textContent = "예상 절감 0 B";
  planCountPill.textContent = "작업 3개";
  optionPlanSummary.textContent = "파일을 분석하면 선택한 작업의 예상 절감량이 표시됩니다.";
  actionPanelHint.textContent = "옵션을 바꾸면 사용자 지정 계획으로 전환됩니다.";
  renderPlanActions();
  renderCleanupSettings();
}

function renderPlanActions(plan?: SubmissionPlan): void {
  const fallbackRows: DisplayPlanRow[] = [
    { priority: 1, label: "큰 이미지 적정 크기로 줄이기", savingLabel: "분석 후 표시", kind: "image" },
    { priority: 2, label: "중복 이미지 정리", savingLabel: "분석 후 표시", kind: "image" },
    { priority: 3, label: "이미지 불필요 정보 제거", savingLabel: "분석 후 표시", kind: "metadata" },
    { priority: 4, label: "사용하지 않는 파일 제거", savingLabel: "분석 후 표시", kind: "metadata" },
    { priority: 5, label: "문서 XML·개인정보 흔적 정리", savingLabel: "분석 후 표시", kind: "author" }
  ];
  const visibleRows = plan ? visiblePlanRows(plan) : [];
  const displayRows: DisplayPlanRow[] =
    visibleRows.length > 0
      ? [
          ...visibleRows.map((row, index) => ({
            label: row.label,
            savingLabel: row.savingLabel,
            kind: row.bucket,
            checked: row.checked,
            action: row.action,
            actions: row.actions,
            priority: index + 1
          })),
          ...(plan?.planNotes ?? []).map((note) => ({
            label: note.label,
            savingLabel: `${note.count}개`,
            kind: note.kind,
            detail: note.detail
          }))
        ]
      : fallbackRows;
  renderDisplayPlanRows(displayRows);
}

function renderCleanupSettings(plan?: SubmissionPlan): void {
  cleanupDocumentToggle.checked = cleanupActionChecked("clean-shape-comment", plan);
  cleanupImageToggle.checked = cleanupActionChecked("strip-metadata", plan);
}

function cleanupActionChecked(action: (typeof CLEANUP_ACTIONS)[number], plan?: SubmissionPlan): boolean {
  const override = state.actionSelections.get(action);
  if (override !== undefined) return override;
  const row = plan?.actionRows.find((item) => item.action === action);
  return row?.checked ?? true;
}

function visiblePlanRows(plan: SubmissionPlan): SubmissionPlan["actionRows"] {
  return plan.actionRows.filter((row) => !isCleanupAction(row.action));
}

function cleanupRows(plan: SubmissionPlan): SubmissionPlan["actionRows"] {
  return plan.actionRows.filter((row) => isCleanupAction(row.action));
}

function isCleanupAction(action: SubmissionActionId): action is (typeof CLEANUP_ACTIONS)[number] {
  return CLEANUP_ACTIONS.includes(action as (typeof CLEANUP_ACTIONS)[number]);
}

function renderDisplayPlanRows(displayRows: DisplayPlanRow[]): void {
  actionCheckboxes.innerHTML = displayRows
    .map((row) => {
      if (row.action && row.actions) {
        const checkedAttr = row.checked ? " checked" : "";
        const actionsAttr = escapeHtml(row.actions.join(","));
        const priorityLabel = row.priority ? `#${row.priority}` : "-";
        return `<li class="plan-card plan-${escapeHtml(row.kind)}"><label><input type="checkbox" value="${escapeHtml(
          row.action
        )}" data-actions="${actionsAttr}"${checkedAttr} /><span class="plan-priority" aria-label="우선순위 ${escapeHtml(
          priorityLabel
        )}">${escapeHtml(priorityLabel)}</span><span class="plan-icon" aria-hidden="true"></span><span class="plan-copy"><strong>${escapeHtml(
          row.label
        )}</strong><em>${escapeHtml(row.detail ?? planActionDescription(row.kind))}</em></span><span class="plan-saving"><small>예상</small><strong>${escapeHtml(
          row.savingLabel
        )}</strong></span></label></li>`;
      }
      const priorityLabel = row.priority ? `#${row.priority}` : "-";
      return `<li class="plan-card plan-${escapeHtml(row.kind)} is-placeholder"><span class="plan-priority" aria-label="우선순위 ${escapeHtml(
        priorityLabel
      )}">${escapeHtml(priorityLabel)}</span><span class="plan-icon" aria-hidden="true"></span><span class="plan-copy"><strong>${escapeHtml(
        row.label
      )}</strong><em>${escapeHtml(row.detail ?? planActionDescription(row.kind))}</em></span><span class="plan-saving"><small>예상</small><strong>${escapeHtml(
        row.savingLabel
      )}</strong></span></li>`;
    })
    .join("");
}

function renderBatchPlanSummary(): void {
  const batchPlan = createBatchPlanSummary();
  if (!batchPlan) {
    planTitle.textContent = "일괄 최적화 계획";
    planSummary.textContent = state.batchAnalyzing ? "파일별 예상 절감량을 분석 중입니다." : "일괄 분석 후 예상 절감량을 표시합니다.";
    planTotal.textContent = "예상 절감 0 B";
    planCountPill.textContent = state.batchItems.length > 0 ? `${state.batchItems.length}개 파일` : "작업 3개";
    optionPlanSummary.textContent = "파일별 분석이 끝나면 선택한 작업의 예상 절감량이 표시됩니다.";
    actionPanelHint.textContent = "일괄 계획은 분석된 파일들의 최적화 후보를 합산해 표시합니다.";
    renderPlanActions();
    renderCleanupSettings();
    return;
  }
  planTitle.textContent = state.actionSelections.size > 0 ? "사용자 지정 일괄 계획" : "일괄 최적화 계획";
  planCountPill.textContent =
    batchPlan.reviewCount > 0
      ? `선택 ${batchPlan.selectedCount}/${batchPlan.rowCount} · 확인 ${batchPlan.reviewCount}`
      : `선택 ${batchPlan.selectedCount}/${batchPlan.rowCount}`;
  planSummary.textContent = `${batchPlan.analyzedCount}개 분석 완료 · 목표 통과 예상 ${batchPlan.metCount}개 · 주의 ${batchPlan.warningCount}개`;
  planTotal.textContent = `예상 절감 ${formatBytes(batchPlan.expectedSavingBytes)} · 결과 ${formatBytes(
    batchPlan.expectedSizeBytes
  )}`;
  optionPlanSummary.textContent = `일괄 ${batchPlan.analyzedCount}개 · 중복 제외 절감 ${formatBytes(
    batchPlan.expectedSavingBytes
  )} · 예상 결과 ${formatBytes(batchPlan.expectedSizeBytes)}`;
  actionPanelHint.textContent = "일괄 계획은 분석된 파일들의 최적화 후보를 합산해 표시합니다.";
  renderDisplayPlanRows(batchPlan.rows);
  syncActionCheckboxIndeterminateState();
}

function planActionDescription(kind: string): string {
  if (kind === "target") return "목표 용량에 맞춰 추가 후보를 검토합니다.";
  if (kind === "quality") return "품질 기준을 통과한 후보만 적용합니다.";
  if (kind === "review") return "자동 처리하지 않고 확인 항목으로 표시합니다.";
  if (kind === "author") return "작성자 정보 및 편집 기록 등 개인 정보를 정리합니다.";
  if (kind === "metadata") return "불필요한 메타데이터 및 숨은 정보를 제거합니다.";
  return "이미지 압축 및 크기 조정으로 파일 용량을 줄입니다.";
}

function renderEmptySummary(): void {
  document.body.dataset.batchResult = "";
  document.body.dataset.result = "";
  batchResultPanel.hidden = true;
  selectionPill.textContent = "단일 파일";
  selectedFileCard.hidden = true;
  dropZone.hidden = false;
  summaryOriginal.textContent = "-";
  summaryExpected.textContent = "-";
  summarySaving.textContent = "-";
  summaryPercent.textContent = "-";
  summaryStatus.innerHTML = '<span class="success-dot" aria-hidden="true"></span>여기에서 제출 기준 통과 여부를 확인합니다.';
  summaryResultLine.textContent = "파일을 선택하면 예상 결과 용량을 계산합니다.";
  summaryTargetLine.textContent = `제출 기준: ${targetLabelForDisplay()}`;
  clearTargetGauge();
  optimizeButton.textContent = "파일을 선택해 시작하세요";
  optimizeButton.disabled = true;
  renderSelectionClearButton();
  renderRunDock();
}

function renderPendingAnalysisSummary(): void {
  selectionPill.textContent = "단일 파일";
  summaryOriginal.textContent = "-";
  summaryExpected.textContent = "-";
  summarySaving.textContent = "-";
  summaryPercent.textContent = "-";
  summaryStatus.innerHTML = '<span class="success-dot" aria-hidden="true"></span>파일을 분석하는 중입니다.';
  summaryResultLine.textContent = "예상 결과: 계산 중";
  summaryTargetLine.textContent = `제출 기준: ${targetLabelForDisplay()}`;
  clearTargetGauge();
  optimizeButton.textContent = "분석 중입니다";
  optimizeButton.disabled = true;
  renderSelectionClearButton();
  renderRunDock();
}

function renderSingleSummary(plan: SubmissionPlan): void {
  if (!state.report) return;
  document.body.dataset.batchResult = "";
  document.body.dataset.result = "";
  batchResultPanel.hidden = true;
  document.body.dataset.view = "single";
  selectionPill.textContent = "단일 파일";
  selectedFileCard.hidden = false;
  dropZone.hidden = true;
  singleOriginalSize.textContent = plan.originalSizeLabel;
  singleExpectedSize.textContent = plan.expectedSizeLabel.replace(/^약 /, "");
  const savingPercent = percentFromPlan(plan);
  singleSavingRing.textContent = `${savingPercent.toFixed(2)}%`;
  const ringDeg = Math.max(0, Math.min(360, (savingPercent / 100) * 360));
  const ringHost = singleSavingRing.closest(".saving-ring") as HTMLElement | null;
  if (ringHost) ringHost.style.setProperty("--ring-deg", `${ringDeg.toFixed(1)}deg`);
  summaryOriginal.textContent = plan.originalSizeLabel;
  summaryExpected.textContent = plan.expectedSizeLabel.replace(/^약 /, "");
  summarySaving.textContent = plan.expectedSavingLabel.replace(/^최대 /, "");
  summaryPercent.textContent = `${savingPercent.toFixed(2)}%`;
  summaryStatus.innerHTML = `<span class="success-dot" aria-hidden="true"></span>${plan.verdictLabel}`;
  summaryStatus.classList.remove("hero-verdict--mix", "hero-verdict--bad");
  summaryResultLine.textContent = `예상 결과: ${plan.expectedSizeLabel.replace(/^약 /, "")}`;
  summaryTargetLine.textContent = `제출 기준: ${targetLabelForDisplay()}`;
  renderTargetGauge(plan);
  renderHeroChips(plan);
  renderReviewStrip(plan);
  renderQualityControls(plan);
  summaryGrid.hidden = true;
  optimizeButton.textContent = "최적화 실행";
  renderSelectionClearButton();
  renderRunDock(plan);
}

// A안: capacity gauge — fill = expected/original, tick = target/original.
function renderTargetGauge(plan: SubmissionPlan): void {
  const original = state.report?.originalSize ?? 0;
  const expectedRatio =
    original > 0 ? Math.min(100, Math.max(0, (plan.expectedSizeBytes / original) * 100)) : 0;
  targetTrackFill.style.width = `${expectedRatio}%`;
  const fillStatus =
    plan.verdict === "hard-miss" ? "hard-miss" : plan.verdict === "need-more" ? "over" : "pass";
  targetTrackFill.dataset.status = fillStatus;
  targetRow.dataset.verdict = plan.verdict;

  if (plan.targetBytes && plan.targetBytes > 0 && original > plan.targetBytes) {
    const targetPercent = Math.min(100, Math.max(0, (plan.targetBytes / original) * 100));
    targetTrackLimit.style.left = `${targetPercent}%`;
    targetTrackLimit.hidden = false;
    gaugeMidLabel.style.left = `${targetPercent}%`;
  } else {
    targetTrackLimit.hidden = true;
    gaugeMidLabel.style.left = "50%";
  }

  const expectedLine = document.createElement("span");
  expectedLine.append("예상 ");
  const expectedValue = document.createElement("b");
  expectedValue.textContent = plan.expectedSizeLabel.replace(/^약 /, "");
  expectedLine.append(expectedValue);
  const roomLine = document.createElement("small");
  roomLine.textContent = plan.verdict === "no-target" ? "제출 기준 없음" : plan.verdictDetail;
  summaryVerdict.replaceChildren(expectedLine, roomLine);
  summaryVerdict.dataset.status = plan.verdict === "pass" ? "pass" : plan.verdict;
  summaryVerdict.hidden = false;
  summaryVerdictDetail.textContent =
    plan.verdict === "no-target" ? "제출 기준이 없습니다." : plan.verdictDetail;
}

function clearTargetGauge(): void {
  targetTrackFill.style.width = "0%";
  delete targetTrackFill.dataset.status;
  delete targetRow.dataset.verdict;
  targetTrackLimit.hidden = true;
  gaugeStartLabel.textContent = "0";
  gaugeMidLabel.hidden = false;
  gaugeMidLabel.textContent = "40MB";
  gaugeMidLabel.style.left = "50%";
  gaugeEndLabel.textContent = "원본";
  summaryVerdict.hidden = true;
  delete summaryVerdict.dataset.status;
  summaryVerdictDetail.textContent = "제출 기준 대비 예상 용량을 보여줍니다.";
  heroChips.hidden = true;
  reviewStrip.hidden = true;
  summaryGrid.hidden = true;
}

function renderBatchSummary(): void {
  if (state.batchItems.length === 0) {
    renderEmptySummary();
    return;
  }
  document.body.dataset.view = "batch";
  selectionPill.textContent = `일괄 처리 · ${state.batchItems.length}개 파일`;
  const analyzed = state.batchItems.filter(
    (item) => item.originalSizeBytes !== undefined && item.expectedSizeBytes !== undefined
  );
  // Hero/pass-rate always describe files that will actually run (selected).
  const summaryItems = analyzed.filter((item) => item.selected !== false);
  const originalTotal = summaryItems.reduce((sum, item) => sum + (item.originalSizeBytes ?? 0), 0);
  const expectedTotal = summaryItems.reduce((sum, item) => sum + (item.expectedSizeBytes ?? item.originalSizeBytes ?? 0), 0);
  const saving = Math.max(0, originalTotal - expectedTotal);
  const savingPercent = originalTotal > 0 ? (saving / originalTotal) * 100 : 0;
  const passed = summaryItems.filter((item) => item.targetStatusLabel === "제출 가능").length;
  const needMore = summaryItems.filter((item) => item.targetStatusLabel === "더 압축 필요").length;
  const hardMiss = summaryItems.filter((item) => item.targetStatusLabel === "기준 미달").length;
  const warning = needMore + hardMiss;
  const plannedCount = summaryItems.length;
  const batchTargetBytes = resolveBatchTargetBytes();
  const targetModeLabel = state.batchTargetMode === "aggregate" ? "전체 합계 기준" : "파일별 기준";
  const targetStatusSummary = state.batchTargetMode === "aggregate"
    ? aggregateTargetStatusText(originalTotal, expectedTotal, batchTargetBytes)
    : fileTargetStatusText(passed, warning, batchTargetBytes);
  // Aggregate hero must mirror the summed-total status — not per-file allocation pass/fail.
  let mixVerdict = "선택·분석 대기";
  let mixClass: "pass" | "need-more" | "hard-miss" | "mix" = "pass";
  if (plannedCount === 0) {
    mixVerdict = "선택·분석 대기";
  } else if (state.batchTargetMode === "aggregate") {
    mixVerdict = targetStatusSummary;
    mixClass = targetStatusSummary === "전체 목표 주의 필요" ? "mix" : "pass";
  } else if (!needMore && !hardMiss) {
    mixVerdict = `${passed}통과`;
    mixClass = "pass";
  } else if (hardMiss > 0 && passed === 0 && needMore === 0) {
    mixVerdict = `${hardMiss}미달`;
    mixClass = "hard-miss";
  } else {
    mixVerdict = `${passed}통과`;
    if (needMore) mixVerdict += ` · ${needMore}더압축`;
    if (hardMiss) mixVerdict += ` · ${hardMiss}미달`;
    mixClass = "mix";
  }
  summaryOriginal.textContent = summaryItems.length ? formatBytes(originalTotal) : "-";
  summaryExpected.textContent = summaryItems.length ? formatBytes(expectedTotal) : "-";
  summarySaving.textContent = summaryItems.length ? formatBytes(saving) : "-";
  summaryPercent.textContent = summaryItems.length ? `${savingPercent.toFixed(1)}%` : "-";
  summaryStatus.innerHTML = `<span class="success-dot" aria-hidden="true"></span>${mixVerdict}`;
  summaryStatus.classList.toggle("hero-verdict--mix", mixClass === "mix");
  summaryStatus.classList.toggle("hero-verdict--bad", mixClass === "hard-miss");
  summaryResultLine.textContent = summaryItems.length
    ? `${targetModeLabel} · ${targetStatusSummary}`
    : "예상 결과: -";
  summaryTargetLine.textContent = batchTargetSummaryLine(batchTargetBytes);
  const batchScopeLine = document.createElement("span");
  batchScopeLine.textContent =
    state.batchTargetMode === "aggregate" ? "선택 합계 배분" : "파일별 기준";
  const batchTargetLine = document.createElement("b");
  batchTargetLine.textContent = batchTargetBytes
    ? `${Math.round(batchTargetBytes / (1024 * 1024))}MB`
    : "제한 없음";
  summaryVerdict.replaceChildren(batchScopeLine, batchTargetLine);
  summaryVerdict.dataset.status =
    mixClass === "pass" ? "pass" : mixClass === "hard-miss" ? "hard-miss" : "need-more";
  summaryVerdict.hidden = plannedCount === 0;
  const aggregatePass =
    state.batchTargetMode === "aggregate" &&
    Boolean(batchTargetBytes) &&
    expectedTotal < (batchTargetBytes as number);
  summaryVerdictDetail.textContent =
    plannedCount === 0
      ? "선택된 분석 파일이 없습니다."
      : state.batchTargetMode === "aggregate"
        ? aggregatePass || !batchTargetBytes
          ? `합계 ${formatBytes(expectedTotal)}`
          : `합계 초과 · 파일 ${passed}/${plannedCount}`
        : `통과 ${passed}/${plannedCount}`;
  const passRate =
    plannedCount === 0
      ? 0
      : state.batchTargetMode === "aggregate"
        ? !batchTargetBytes || originalTotal < batchTargetBytes || expectedTotal < batchTargetBytes
          ? 100
          : Math.min(99, Math.round((batchTargetBytes / Math.max(expectedTotal, 1)) * 100))
        : (passed / plannedCount) * 100;
  targetTrackFill.style.width = `${passRate}%`;
  targetTrackFill.dataset.status =
    state.batchTargetMode === "aggregate"
      ? mixClass === "mix"
        ? "over"
        : "pass"
      : hardMiss > 0
        ? "hard-miss"
        : warning > 0
          ? "over"
          : "pass";
  targetTrackLimit.style.left = `${passRate}%`;
  targetTrackLimit.hidden = plannedCount === 0;
  gaugeStartLabel.textContent = state.batchTargetMode === "aggregate" ? "합계" : "통과율";
  gaugeMidLabel.textContent =
    plannedCount === 0
      ? state.batchTargetMode === "aggregate"
        ? "합계"
        : "통과율"
      : state.batchTargetMode === "aggregate"
        ? `${Math.round(passRate)}%`
        : `${passed}/${plannedCount}`;
  gaugeMidLabel.hidden = false;
  gaugeMidLabel.style.left = `${passRate}%`;
  gaugeEndLabel.textContent = "";
  summaryGrid.hidden = false;
  heroChips.hidden = false;
  chipPolicy.textContent =
    state.preservationPreference === "size"
      ? "최대 압축"
      : state.batchTargetMode === "aggregate"
        ? "합계 배분 맞춤"
        : "파일별 목표 맞춤";
  chipPolicy.className = `hero-chip ${
    state.preservationPreference === "size" ? "hero-chip--max" : "hero-chip--fit"
  }`;
  chipLimit.textContent = state.batchTargetMode === "aggregate" ? "체크 시 배분·품질% 갱신" : "체크=실행 대상";
  chipLimit.className = "hero-chip hero-chip--soft";
  const qualities = summaryItems
    .map((item) => item.jpegQualityDisplay)
    .filter((value): value is number => value !== undefined);
  const avgQ = qualities.length
    ? Math.round(qualities.reduce((sum, value) => sum + value, 0) / qualities.length)
    : DEFAULT_JPEG_QUALITY;
  chipQuality.textContent = `평균 예정 ${avgQ}%`;
  chipQuality.hidden = true;
  policyLive.textContent = `선택 ${state.batchItems.filter((item) => item.selected).length} · 평균 예정 ${avgQ}%`;
  renderBatchReviewStrip(summaryItems);
  optimizeButton.textContent = "선택 파일 일괄 최적화";
  optimizeButton.disabled =
    state.batchAnalyzing || !state.batchItems.some((item) => item.selected !== false && item.status === "pending");
  renderQualityControls();
  renderRunDock();
  renderBatchPlanSummary();
  renderBatchResultPanel();
}

function renderBatchReviewStrip(
  summaryItems: Array<{ report?: OptimizationReport | null; targetStatusLabel?: string }>
): void {
  if (summaryItems.length === 0) {
    reviewStrip.hidden = true;
    return;
  }
  let near = 0;
  let fonts = 0;
  let ole = 0;
  for (const item of summaryItems) {
    const report = item.report;
    if (!report) continue;
    near += report.nearDuplicateImages?.length ?? 0;
    fonts += (report.resourceDiagnostics ?? []).filter((entry) => entry.kind === "font").length;
    ole += (report.resourceDiagnostics ?? []).filter((entry) => entry.kind === "ole").length;
  }
  const hardMiss = summaryItems.some((item) => item.targetStatusLabel === "기준 미달");
  reviewStripTitle.textContent = hardMiss
    ? "최대 압축으로도 부족"
    : state.qualityMode === "auto"
      ? "품질 %는 자동"
      : "품질 %는 일괄 수동";
  reviewStripDetail.textContent = hardMiss
    ? "폰트/유사 병합·원본 이미지 교체 등 수동 검토가 필요합니다."
    : "세부 옵션에서 작업만 on/off · 유사 병합 기본 끔";
  const chips: string[] = [];
  if (fonts > 0) chips.push(`폰트 ${fonts}`);
  if (near > 0) chips.push(`유사 ${near}`);
  if (ole > 0) chips.push(`OLE ${ole}`);
  reviewStripChips.innerHTML = chips.map((chip) => `<span>${escapeHtml(chip)}</span>`).join("");
  reviewStrip.hidden = false;
}

function createBatchPlanSummary(): BatchPlanSummary | undefined {
  const analyzedItems = state.batchItems.filter(
    (item) => item.report && item.selected !== false
  );
  if (analyzedItems.length === 0) return undefined;
  const rowMap = new Map<SubmissionActionId, DisplayPlanRow & { savingBytes: number; count: number }>();
  let expectedSizeBytes = 0;
  let expectedSavingBytes = 0;
  let metCount = 0;
  let warningCount = 0;
  let reviewCount = 0;
  const targetAllocation = summarizeAggregateTargetAllocation(state.batchItems);

  for (const item of analyzedItems) {
    if (!item.report) continue;
    // Finished rows: use actual optimize outcome already stored on the item.
    if (item.status === "done") {
      expectedSizeBytes += item.expectedSizeBytes ?? item.report.optimizedSize ?? 0;
      expectedSavingBytes += item.savedBytes ?? 0;
      if (
        item.targetStatusLabel === "제출 가능" ||
        item.targetStatusLabel === "목표 제한 없음"
      ) {
        metCount += 1;
      } else if (item.targetStatusLabel) {
        warningCount += 1;
      }
      continue;
    }
    if (item.status === "failed" || item.status === "cancelled") continue;
    const jpegQuality =
      state.preservationPreference === "size" || state.preservationPreference === "preserve"
        ? undefined
        : item.jpegQualityOverride ??
          (state.qualityMode === "manual" ? state.jpegQuality : undefined);
    const plan = createSubmissionPlan(item.report, {
      submissionLimit: batchSubmissionLimitForItem(item, targetAllocation),
      preservationPreference: state.preservationPreference,
      actionOverrides: state.actionSelections,
      ...(jpegQuality !== undefined ? { jpegQuality } : {})
    });
    expectedSizeBytes += plan.expectedSizeBytes;
    expectedSavingBytes += Math.max(0, item.report.originalSize - plan.expectedSizeBytes);
    if (plan.targetStatus === "target-missed") {
      warningCount += 1;
    } else {
      metCount += 1;
    }
    reviewCount += plan.planNotes.filter((note) => note.kind === "review").reduce((sum, note) => sum + note.count, 0);
    for (const row of visiblePlanRows(plan)) {
      const existing = rowMap.get(row.action);
      if (existing) {
        existing.savingBytes += row.savingBytes;
        existing.count += row.count;
        existing.checked = existing.checked || row.checked;
        existing.savingLabel = formatBytes(existing.savingBytes);
        existing.detail = `${existing.count}개 후보 · ${batchPlanDescription(row.bucket)}`;
      } else {
        rowMap.set(row.action, {
          priority: row.priority,
          label: row.label,
          savingLabel: row.savingLabel,
          kind: row.bucket,
          detail: `${row.count}개 후보 · ${batchPlanDescription(row.bucket)}`,
          checked: row.checked,
          action: row.action,
          actions: row.actions,
          savingBytes: row.savingBytes,
          count: row.count
        });
      }
    }
  }

  const rows = [...rowMap.values()]
    .sort((left, right) => (left.priority ?? 99) - (right.priority ?? 99) || left.label.localeCompare(right.label))
    .map((row, index) => ({
      priority: index + 1,
      label: row.label,
      savingLabel: formatBytes(row.savingBytes),
      kind: row.kind,
      detail: row.detail,
      checked: row.checked,
      action: row.action,
      actions: row.actions
    }));

  return {
    analyzedCount: analyzedItems.length,
    selectedCount: rows.filter((row) => row.checked).length,
    rowCount: rows.length,
    reviewCount,
    metCount,
    warningCount,
    expectedSizeBytes,
    expectedSavingBytes,
    rows
  };
}

function batchPlanDescription(kind: string): string {
  if (kind === "author") return "개인 정보 정리";
  if (kind === "metadata") return "메타데이터/숨은 정보 정리";
  return "이미지 용량 최적화";
}

function renderRunDock(plan?: SubmissionPlan): void {
  const shouldShow = false;
  runDock.hidden = !shouldShow;
  if (!shouldShow || !plan) {
    runDockStatus.textContent = state.analysisRunning ? "분석 중" : "분석 결과 대기 중";
    runDockSummary.textContent = state.analysisRunning
      ? `제출 기준 ${targetLabelForDisplay()} · 결과 계산 중`
      : "파일을 선택하면 실행 요약이 표시됩니다.";
    runDockButton.textContent = optimizeButton.textContent;
    runDockButton.disabled = true;
    return;
  }
  runDockStatus.textContent = plan.targetStatusLabel;
  runDockSummary.textContent = `예상 결과 ${plan.expectedSizeLabel} · 중복 제외 절감 ${plan.expectedSavingLabel} · 저장 ${outputDirectoryLabel()}`;
  runDockButton.textContent = optimizeButton.textContent;
  runDockButton.disabled = optimizeButton.disabled;
}

function outputDirectoryLabel(): string {
  return state.outputDirectory ? state.outputDirectory : "원본 폴더";
}

function targetLabelForDisplay(): string {
  const bytes = resolveTargetBytesForDisplay();
  if (!bytes) return "제한 없음";
  return bytes >= 1024 * 1024 ? `${Math.round(bytes / 1024 / 1024)}MB` : formatBytes(bytes);
}

function resolveTargetBytesForDisplay(): number | undefined {
  if (state.currentPlan?.targetBytes) return state.currentPlan.targetBytes;
  return resolveSubmissionLimitBytes(state.submissionLimit);
}

function resolveBatchTargetBytes(): number | undefined {
  return resolveSubmissionLimitBytes(state.submissionLimit);
}

function batchTargetSummaryLine(targetBytes: number | undefined): string {
  const targetLabel = targetBytes ? formatBytes(targetBytes) : "제한 없음";
  return state.batchTargetMode === "aggregate"
    ? `전체 제출 기준: ${targetLabel}`
    : `파일별 제출 기준: ${targetLabel}`;
}

function aggregateTargetStatusText(
  originalTotal: number,
  expectedTotal: number,
  targetBytes: number | undefined
): string {
  if (!targetBytes) return "전체 목표 제한 없음";
  if (originalTotal < targetBytes) return "이미 전체 목표 미만";
  if (expectedTotal < targetBytes) return "전체 목표 달성 예상";
  return "전체 목표 주의 필요";
}

function fileTargetStatusText(passed: number, warning: number, targetBytes: number | undefined): string {
  if (!targetBytes) return "파일별 목표 제한 없음";
  if (warning === 0 && passed > 0) return "파일별 목표 달성 예상";
  if (warning > 0) return "파일별 목표 주의 필요";
  return "파일별 분석 대기";
}

function batchSubmissionLimitForItem(
  item: BatchItem,
  targetAllocation?: AggregateTargetAllocationSummary
): SubmissionLimit {
  if (state.batchTargetMode === "per-file") return state.submissionLimit;
  const targetBytes = batchTargetBytesForItem(item, targetAllocation);
  return targetBytes ? { id: "custom", customBytes: targetBytes } : { id: "none" };
}

function batchTargetBytesForItem(
  item: BatchItem,
  targetAllocation = summarizeAggregateTargetAllocation(state.batchItems)
): number | undefined {
  const batchTargetBytes = resolveBatchTargetBytes();
  if (!batchTargetBytes || !item.originalSizeBytes) return undefined;
  if (state.batchTargetMode === "per-file") return batchTargetBytes;
  if (!item.selected) return undefined;
  return allocateRemainingAggregateTargetBytes({
    batchTargetBytes,
    completedOutputBytes: targetAllocation.completedOutputBytes,
    itemOriginalBytes: item.originalSizeBytes,
    pendingOriginalTotal: targetAllocation.pendingOriginalTotal
  });
}

function batchTargetLabelForItem(
  item: BatchItem,
  targetAllocation?: AggregateTargetAllocationSummary
): string {
  if (state.batchTargetMode === "aggregate" && !item.selected) return "선택 제외";
  const targetBytes = batchTargetBytesForItem(item, targetAllocation);
  return targetBytes ? `${formatBytes(targetBytes)} 미만` : "제한 없음";
}

function batchAllocatedTargetLabelForItem(
  item: BatchItem,
  targetAllocation?: AggregateTargetAllocationSummary
): string | undefined {
  if (state.batchTargetMode !== "aggregate") return undefined;
  const targetBytes = batchTargetBytesForItem(item, targetAllocation);
  return targetBytes ? `배분 목표 ${formatBytes(targetBytes)}` : undefined;
}

function percentFromPlan(plan: SubmissionPlan): number {
  const original = state.report?.originalSize ?? 0;
  return original > 0 ? (plan.expectedSavingBytes / original) * 100 : 0;
}

function clampJpegQuality(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_JPEG_QUALITY;
  return Math.max(JPEG_QUALITY_FLOOR, Math.min(JPEG_QUALITY_CEILING, Math.round(value)));
}

function jpegQualityForOptimize(item?: BatchItem): number | undefined {
  // Aggressive always runs at the engine floor — never forward a manual %.
  if (
    state.mode === "safe" ||
    state.preservationPreference === "preserve" ||
    state.preservationPreference === "size"
  ) {
    return undefined;
  }
  if (item?.jpegQualityOverride !== undefined) return clampJpegQuality(item.jpegQualityOverride);
  if (state.qualityMode === "manual") return clampJpegQuality(state.jpegQuality);
  return undefined;
}

function renderQualityControls(plan?: SubmissionPlan): void {
  const showQuality = state.preservationPreference !== "preserve" && state.mode !== "safe";
  qualityControls.hidden = !showQuality;
  if (!showQuality) {
    batchQualityAuto.hidden = true;
    return;
  }

  const isBatch = document.body.dataset.view === "batch";
  const maxMode = state.preservationPreference === "size";
  const effectiveQualityMode = maxMode ? "auto" : state.qualityMode;
  qualityModeAuto.setAttribute("aria-pressed", effectiveQualityMode === "auto" ? "true" : "false");
  qualityModeManual.setAttribute("aria-pressed", effectiveQualityMode === "manual" ? "true" : "false");
  qualityModeAuto.textContent = isBatch ? "자동" : "자동(목표)";
  qualityModeManual.textContent = isBatch ? "일괄 수동" : "수동";
  qualityModeManual.disabled = maxMode;
  qualityModeAuto.disabled = maxMode;
  qualityHeadLabel.textContent = maxMode
    ? "JPEG 품질 · 최대 압축"
    : isBatch
      ? effectiveQualityMode === "auto"
        ? "품질 · 파일별 자동"
        : "일괄 품질 (선택 파일)"
      : "JPEG 품질";
  jpegQualitySlider.value = String(state.jpegQuality);
  jpegQualityInput.value = String(state.jpegQuality);

  const showManual = !maxMode && effectiveQualityMode === "manual";
  const showFloorReadOnly = maxMode;
  const showPlannedReadOnly =
    !maxMode && !isBatch && effectiveQualityMode === "auto" && plan?.plannedJpegQuality !== undefined;
  qualityManual.hidden = !(showManual || showPlannedReadOnly || showFloorReadOnly);
  jpegQualitySlider.disabled = !showManual;
  jpegQualityInput.disabled = !showManual;
  if (showFloorReadOnly) {
    jpegQualitySlider.value = String(JPEG_QUALITY_FLOOR);
    jpegQualityInput.value = String(JPEG_QUALITY_FLOOR);
  } else if (showPlannedReadOnly && plan?.plannedJpegQuality !== undefined) {
    jpegQualitySlider.value = String(plan.plannedJpegQuality);
    jpegQualityInput.value = String(plan.plannedJpegQuality);
  }
  batchQualityAuto.hidden = !(isBatch && effectiveQualityMode === "auto" && !maxMode);
  if (isBatch && effectiveQualityMode === "auto") {
    const qualities = state.batchItems
      .filter((item) => item.selected && item.report && item.jpegQualityDisplay !== undefined)
      .map((item) => item.jpegQualityDisplay as number);
    const avg =
      qualities.length > 0
        ? Math.round(qualities.reduce((sum, value) => sum + value, 0) / qualities.length)
        : plan?.plannedJpegQuality ?? (maxMode ? JPEG_QUALITY_FLOOR : DEFAULT_JPEG_QUALITY);
    batchQualityAvg.textContent = `${avg}%`;
  }

  if (maxMode) {
    qualityPlannedLabel.textContent = `최대 압축 · ${JPEG_QUALITY_FLOOR}%`;
    qualityHint.textContent = "용량 우선: 제출 기준과 무관하게 하한 품질까지 압축합니다. 수동 %는 사용할 수 없습니다.";
  } else if (effectiveQualityMode === "manual") {
    qualityPlannedLabel.textContent = `직접 지정 · ${state.jpegQuality}%`;
    qualityHint.textContent = isBatch
      ? "슬라이더·숫자는 선택된 모든 파일에 같은 %를 넣습니다. 행에서 숫자를 바꾸면 그 파일만 덮어씁니다."
      : plan?.targetBytes
        ? `수동 ${state.jpegQuality}%. 기준을 넘으면 「더 압축 필요」(하한 품질까지 여지 있을 때) 또는 「기준 미달」(여지 없을 때).`
        : "지정한 JPEG 품질로 압축합니다.";
  } else {
    const planned = plan?.plannedJpegQuality;
    qualityPlannedLabel.textContent =
      planned !== undefined ? `자동 · 예정 ${planned}%` : "자동 · 목표에 맞춤";
    qualityHint.textContent = isBatch
      ? state.batchTargetMode === "aggregate"
        ? "상단 슬라이더 없음. 합계 배분 목표마다 파일별 품질을 따로 탐색합니다."
        : "상단 슬라이더 없음. 각 파일이 제출 기준에 맞춰 품질을 따로 정합니다."
      : plan?.targetBytes
        ? `자동: 목표에 맞춰 품질 이분 탐색 → 예정 ${planned ?? DEFAULT_JPEG_QUALITY}%. 하한 품질까지 해도 안 되면 기준 미달.`
        : "목표가 없으면 기본 균형 품질을 사용합니다.";
  }
}

function renderHeroChips(plan?: SubmissionPlan): void {
  if (!plan) {
    heroChips.hidden = true;
    return;
  }
  const maxMode = state.preservationPreference === "size";
  const policy =
    maxMode ? "최대 압축" : state.qualityMode === "manual" ? "품질 수동" : "목표 맞춤";
  chipPolicy.textContent = policy;
  chipPolicy.className = `hero-chip ${maxMode || state.qualityMode === "manual" ? "hero-chip--max" : "hero-chip--fit"}`;
  chipLimit.textContent = plan.targetBytes
    ? `개별 · ${Math.round(plan.targetBytes / (1024 * 1024))}MB`
    : "제한 없음";
  const q =
    state.qualityMode === "manual"
      ? state.jpegQuality
      : plan.plannedJpegQuality ?? (maxMode ? JPEG_QUALITY_FLOOR : DEFAULT_JPEG_QUALITY);
  const atFloor = maxMode || (typeof q === "number" && q <= JPEG_QUALITY_FLOOR);
  chipQuality.textContent = `${q}%${atFloor ? " · 하한" : ""}`;
  chipQuality.hidden = false;
  heroChips.hidden = false;
  policyLive.textContent = `${state.qualityMode === "manual" ? "수동" : "자동"} · ${q}%`;

  const original = state.report?.originalSize ?? 0;
  gaugeStartLabel.textContent = "0";
  gaugeMidLabel.textContent = plan.targetBytes
    ? `${Math.round(plan.targetBytes / (1024 * 1024))}MB`
    : "목표";
  gaugeMidLabel.hidden = !plan.targetBytes || original <= plan.targetBytes;
  gaugeEndLabel.textContent = original > 0 ? formatBytes(original) : "원본";
}

function renderReviewStrip(plan?: SubmissionPlan): void {
  if (!plan || !state.report) {
    reviewStrip.hidden = true;
    return;
  }
  const near = state.report.nearDuplicateImages?.length ?? 0;
  const fonts = (state.report.resourceDiagnostics ?? []).filter((item) => item.kind === "font").length;
  const ole = (state.report.resourceDiagnostics ?? []).filter((item) => item.kind === "ole").length;
  const reviewNotes = plan.planNotes.filter((note) => note.kind === "review");
  const hardMiss = plan.verdict === "hard-miss";
  reviewStripTitle.textContent = hardMiss ? "최대 압축으로도 부족" : "자동으로 건드리지 않음";
  reviewStripDetail.textContent = hardMiss
    ? "폰트/유사 병합·원본 이미지 교체 등 수동 검토가 필요합니다."
    : "폰트·유사 이미지는 품질 계획에서 제외됩니다.";
  const chips: string[] = [];
  if (fonts > 0) chips.push(`폰트 ${fonts}`);
  if (near > 0) chips.push(`유사 ${near}`);
  if (ole > 0) chips.push(`OLE ${ole}`);
  for (const note of reviewNotes) {
    if (note.label && !chips.includes(note.label)) chips.push(note.label);
  }
  reviewStripChips.innerHTML = chips.map((chip) => `<span>${escapeHtml(chip)}</span>`).join("");
  reviewStrip.hidden = false;
}

function handleBatchQualityEditClick(button: HTMLButtonElement): void {
  if (state.batchRunning || state.batchAnalyzing) return;
  if (state.preservationPreference === "size" || state.preservationPreference === "preserve") return;
  const index = Number(button.dataset.batchQualityEdit);
  const item = Number.isInteger(index) ? state.batchItems[index] : undefined;
  if (!item || !item.report) return;
  const current = item.jpegQualityDisplay ?? DEFAULT_JPEG_QUALITY;
  item.jpegQualityOverride = clampJpegQuality(current);
  refreshBatchPlans();
  requestAnimationFrame(() => {
    const input = batchList.querySelector<HTMLInputElement>(
      `input.batch-quality-input[data-batch-quality-index="${index}"]`
    );
    input?.focus();
    input?.select();
  });
}

function handleBatchQualityInput(input: HTMLInputElement): void {
  if (state.batchRunning || state.batchAnalyzing) return;
  if (state.preservationPreference === "size" || state.preservationPreference === "preserve") return;
  const index = Number(input.dataset.batchQualityIndex);
  const item = Number.isInteger(index) ? state.batchItems[index] : undefined;
  if (!item || !item.report) return;
  const raw = input.value.trim();
  if (raw === "") {
    delete item.jpegQualityOverride;
  } else {
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      setStatus("JPEG 품질은 60–95 사이 숫자여야 합니다.");
      refreshBatchPlans();
      return;
    }
    item.jpegQualityOverride = clampJpegQuality(value);
  }
  refreshBatchPlans();
}

function qualityDisplayForBatchItem(item: BatchItem, plan: SubmissionPlan): number | undefined {
  if (state.preservationPreference === "preserve") return undefined;
  if (state.preservationPreference === "size") return JPEG_QUALITY_FLOOR;
  if (item.jpegQualityOverride !== undefined) return item.jpegQualityOverride;
  if (state.qualityMode === "manual") return state.jpegQuality;
  return plan.plannedJpegQuality;
}

function qualityLabelForBatchItem(item: BatchItem, plan: SubmissionPlan): string {
  const display = qualityDisplayForBatchItem(item, plan);
  if (display === undefined) return "-";
  if (state.preservationPreference === "size") return `${display}% · 하한`;
  if (item.jpegQualityOverride !== undefined || state.qualityMode === "manual") return `${display}%`;
  if (state.qualityMode === "auto" && state.preservationPreference === "recommended" && plan.verdict === "need-more") {
    return `~${display}%↓`;
  }
  return `${display}%`;
}

async function loadFile(path: string): Promise<void> {
  if (state.batchRunning || state.batchAnalyzing || state.analysisRunning || state.optimizeRunning) {
    setStatus("처리 중에는 새 파일을 열 수 없습니다. 완료 후 다시 시도하세요.");
    return;
  }
  document.body.dataset.view = "single";
  document.body.dataset.result = "";
  state.batchItems = [];
  state.batchRunCompleted = false;
  batchPanel.hidden = true;
  state.filePath = path;
  state.report = undefined;
  state.result = undefined;
  state.batchReportPath = undefined;
  state.currentPlan = undefined;
  state.analysisRunning = true;
  state.actionSelections.clear();
  singleWorkspace.hidden = false;
  actionPanel.hidden = true;
  actionCheckboxes.innerHTML = "";
  refreshSubmissionPlan();
  resultPanel.hidden = true;
  resultGuidance.textContent = "";
  resetVerificationPanel();
  compareButton.disabled = true;
  closeImageCompareModal();
  const baseName = path.split(/[\\/]/).pop() ?? path;
  fileName.textContent = baseName;
  fileMeta.textContent = "선택한 경로는 현재 실행에서만 사용하며 저장하지 않습니다.";
  selectedFileName.textContent = baseName;
  selectedFilePath.textContent = "파일 경로는 앱 기록으로 저장하지 않습니다.";
  selectedOriginalMeta.textContent = "원본 크기: 분석 중";
  selectedModifiedMeta.textContent = "수정일: 분석 중";
  selectedFileCard.hidden = false;
  dropZone.hidden = true;
  optimizeButton.disabled = true;
  if (looksLikeOptimizedFileName(baseName)) {
    setStatus("이미 최적화된 파일로 보입니다. 추가 절감 효과는 작을 수 있습니다.");
  }
  await analyzeFile(path);
}

async function analyzeFile(path: string): Promise<void> {
  const runId = ++analysisSequence;
  try {
    state.analysisRunning = true;
    setBusy("문서를 분석하는 중입니다...", { cancelable: true, kind: "analysis" });
    renderProgress(18, "파일을 불러와 분석을 준비하는 중입니다");
    const response = await window.hwpxOptimizer.analyze(path);
    if (runId !== analysisSequence || state.filePath !== path) return;
    renderProgress(82, "문서 구조 · 이미지 · 목표 맞춤 품질 추정…");
    state.report = response.report;
    state.actionSelections.clear();
    renderAnalysis(response.report);
    refreshSubmissionPlan();
    renderRunDock(state.currentPlan);
    renderProgress(100, "분석 완료");
    setStatus("분석이 완료되었습니다. 최적화 방식을 선택하세요.");
  } catch (error) {
    if (runId === analysisSequence) {
      setStatus(errorMessage(error));
      renderEmptySummary();
    }
  } finally {
    if (runId === analysisSequence) {
      state.analysisRunning = false;
      setIdle();
      hideProgressPanel();
    }
  }
}

async function optimizeCurrentFile(): Promise<void> {
  if (!state.filePath || !state.report || state.optimizeRunning) return;
  // Capture the file this run belongs to. If the user loads a different file
  // while this optimize is in flight, the resolved result must not overwrite the
  // newer file's view.
  const requestFilePath = state.filePath;
  state.optimizeRunning = true;
  let succeeded = false;
  try {
    setBusy(`${modeLabel(state.mode)} 모드로 최적화하는 중입니다...`, { cancelable: true });
    renderProgress(5, "최적화를 준비하는 중입니다");
    const response = await window.hwpxOptimizer.optimize({
      filePath: requestFilePath,
      mode: state.mode,
      outputDirectory: state.outputDirectory,
      outputMode: "single",
      actions: selectedActionsForOptimize(),
      targetBytes: state.currentPlan?.targetBytes ?? resolveSubmissionLimitBytes(state.submissionLimit),
      ...(jpegQualityForOptimize() !== undefined ? { jpegQuality: jpegQualityForOptimize() } : {})
    });
    if (state.filePath !== requestFilePath) return;
    state.result = response;
    renderResult(response.report, response.outputPath, response.reportPath);
    setStatus("최적화가 완료되었습니다. 파일을 열어 제출 전 상태를 확인하세요.");
    succeeded = true;
  } catch (error) {
    if (state.filePath === requestFilePath) {
      renderVerificationFailure(error);
      setStatus(errorMessage(error));
    }
  } finally {
    state.optimizeRunning = false;
    if (state.filePath === requestFilePath) {
      setIdle();
      if (!succeeded) resetProgressAnimation();
      hideProgressPanel();
    }
  }
}

function renderProgress(percent: number, item: string): void {
  progressPanel.hidden = false;
  targetProgressPercent = Math.max(targetProgressPercent, Math.max(0, Math.min(100, percent)));
  progressItem.textContent = `${progressLabel(item)} · ${Math.round(targetProgressPercent)}%`;
  progressBar.setAttribute("aria-valuenow", String(Math.round(targetProgressPercent)));
  startProgressAnimation();
}

function hideProgressPanel(): void {
  document.body.dataset.busy = "";
  progressTitle.textContent = "진행 상황";
  progressPanel.classList.remove("is-loading");
  progressPanel.hidden = true;
  stopProgressAnimation();
  if (!state.analysisRunning && !state.batchAnalyzing && !state.batchRunning) {
    setSubmissionInputsDisabled(false);
  }
}

function resetProgressAnimation(): void {
  stopProgressAnimation();
  displayedProgressPercent = 0;
  targetProgressPercent = 0;
  progressBar.style.width = "0%";
  progressBar.setAttribute("aria-valuenow", "0");
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function startProgressAnimation(): void {
  if (prefersReducedMotion()) {
    displayedProgressPercent = targetProgressPercent;
    progressBar.style.width = `${Math.max(0, Math.min(100, displayedProgressPercent))}%`;
    return;
  }
  progressAnimationTimer ??= window.setInterval(() => {
    const delta = targetProgressPercent - displayedProgressPercent;
    if (delta <= 0.3) {
      displayedProgressPercent = targetProgressPercent;
    } else {
      displayedProgressPercent += Math.max(0.4, delta * 0.18);
    }
    progressBar.style.width = `${Math.max(0, Math.min(100, displayedProgressPercent))}%`;
    if (displayedProgressPercent >= 100) stopProgressAnimation();
  }, 60);
}

function stopProgressAnimation(): void {
  if (progressAnimationTimer !== undefined) {
    window.clearInterval(progressAnimationTimer);
    progressAnimationTimer = undefined;
  }
}

function renderAnalysis(report: OptimizationReport): void {
  const view = createAnalysisViewModel(report);
  selectedOriginalMeta.textContent = `원본 ${view.originalSizeLabel}`;
  selectedModifiedMeta.textContent = `수정일: ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
  analysisDetails.open = false;
  analysisDetailSummary.innerHTML = `<span class="search-icon" aria-hidden="true"></span><strong>세부 분석 보기</strong><span>예상 절감 ${escapeHtml(
    view.estimatedSavingLabel
  )}</span>`;
  analysisGrid.innerHTML = [
    metricHtml("원본 용량", view.originalSizeLabel),
    metricHtml("이미지", String(view.imageCount)),
    metricHtml("BMP 후보", String(view.bmpCount)),
    metricHtml("메타데이터", String(view.metadataImageCount)),
    metricHtml("미사용 리소스", String(view.unusedResourceCount)),
    metricHtml("중복 이미지", String(view.duplicateGroupCount)),
    metricHtml("주의 리소스", String(view.riskyResourceCount)),
    metricHtml("예상 절감", view.estimatedSavingLabel)
  ].join("");

  if (view.categoryBreakdown.length === 0) {
    categoryChart.hidden = true;
    categoryChart.innerHTML = "";
  } else {
    categoryChart.hidden = false;
    categoryChart.innerHTML = view.categoryBreakdown.map(categoryBarHtml).join("");
  }

  opportunityList.innerHTML =
    view.topOpportunities.length === 0
      ? "<li class=\"empty\">뚜렷한 최적화 후보가 없습니다.</li>"
      : view.topOpportunities
          .map(
            (item) =>
              `<li><span>${actionLabel(item.action)}</span><strong>${item.savingLabel}</strong><em>${item.count}개</em></li>`
          )
          .join("");

  warningList.innerHTML = renderWarningList(view.warnings);
  renderAnalysisVerification(report);
}

function renderWarningList(warnings: readonly string[]): string {
  if (warnings.length === 0) {
    return "<li class=\"empty\">현재 표시할 주의사항이 없습니다.</li>";
  }
  const grouped = groupWarnings(warnings);
  return grouped
    .map((group) => {
      const detailsHtml =
        group.count > 1 && group.details.length > 0
          ? `<details class="warning-details"><summary>${group.details.length}개 항목 보기${
              group.count > group.details.length ? ` (전체 ${group.count}개)` : ""
            }</summary><ul>${group.details
              .map((detail) => `<li>${escapeHtml(detail)}</li>`)
              .join("")}</ul></details>`
          : "";
      return `<li>${escapeHtml(group.label)}${detailsHtml}</li>`;
    })
    .join("");
}

function renderResult(report: OptimizationReport, outputPath: string, reportPath?: string): void {
  batchResultPanel.hidden = true;
  document.body.dataset.result = "visible";
  resultPanel.hidden = false;
  const plan = state.currentPlan;
  const optimizedSize = report.optimizedSize ?? report.originalSize;
  const savedBytes = report.savedBytes ?? 0;
  const planDeltaBytes = plan ? savedBytes - plan.expectedSavingBytes : undefined;
  resultSummary.innerHTML = [
    ...(plan ? [metricHtml("계획 예상", `${plan.expectedSizeLabel} / ${plan.expectedSavingLabel}`)] : []),
    metricHtml("원본 용량", formatBytes(report.originalSize)),
    metricHtml("결과 용량", formatBytes(optimizedSize)),
    metricHtml("실제 절감", formatBytes(savedBytes)),
    metricHtml("절감률", `${(report.savedPercent ?? 0).toFixed(2)}%`),
    ...(planDeltaBytes !== undefined ? [metricHtml("계획 대비", planDeltaLabel(planDeltaBytes))] : []),
    ...(report.targetBytes
      ? [metricHtml("제출 목표", `${formatBytes(report.targetBytes)} · ${targetStatusText(report.targetStatus)}`)]
      : [])
  ].join("");
  requireElement("output-path").textContent = `결과 파일: ${fileNameFromPath(outputPath)}`;
  requireElement("report-path").textContent = reportPath
    ? `현재 리포트: ${fileNameFromPath(reportPath)}`
    : "리포트 저장이 꺼져 있습니다.";
  resultGuidance.textContent = resultGuidanceText(report, plan);
  openReportButton.disabled = !reportPath;
  reverifyButton.disabled = false;
  compareButton.disabled = state.mode === "safe";
  renderVerificationResult(report);
  renderRunDock(plan);
}

function renderBatchResultPanel(): void {
  const finished = state.batchItems.filter(
    (item) => item.status === "done" || item.status === "failed" || item.status === "cancelled"
  );
  const done = state.batchItems.filter((item) => item.status === "done");
  const failed = state.batchItems.filter((item) => item.status === "failed");
  const cancelled = state.batchItems.filter((item) => item.status === "cancelled");
  const totalSavedBytes = done.reduce((sum, item) => sum + (item.savedBytes ?? 0), 0);
  const hasOutput = done.some((item) => item.outputPath);
  const shouldShow =
    state.batchRunCompleted && state.batchItems.length > 0 && !state.batchRunning && !state.batchAnalyzing && finished.length > 0;
  document.body.dataset.batchResult = shouldShow ? "visible" : "";
  batchResultPanel.hidden = !shouldShow;
  if (!shouldShow) return;
  const batchStatusLine =
    failed.length > 0 || cancelled.length > 0
      ? `${done.length}개 파일 완료 · 실패 ${failed.length} · 취소 ${cancelled.length}`
      : `${done.length}개 파일 완료 · 총 절감 ${formatBytes(totalSavedBytes)}`;
  batchResultTitle.textContent = batchResultTitleForCounts({
    failed: failed.length,
    cancelled: cancelled.length
  });
  batchResultLine.textContent = batchStatusLine;
  batchResultStats.innerHTML = [
    metricHtml("완료", `${done.length}개`),
    metricHtml("총 절감", formatBytes(totalSavedBytes)),
    metricHtml("실패", `${failed.length}개`),
    metricHtml("리포트", state.batchReportPath ? "저장됨" : "꺼짐")
  ].join("");
  batchResultDetails.textContent = batchResultDetailsText({ done, failed, cancelled });
  batchOpenFolderButton.disabled = !hasOutput;
  batchOpenReportButton.disabled = !state.batchReportPath;
}

function batchResultDetailsText(input: { done: BatchItem[]; failed: BatchItem[]; cancelled: BatchItem[] }): string {
  if (input.failed.length > 0) {
    return `실패 파일: ${input.failed
      .slice(0, 3)
      .map((item) => `${item.fileName}${item.error ? ` (${item.error})` : ""}`)
      .join(" · ")}${input.failed.length > 3 ? ` 외 ${input.failed.length - 3}개` : ""}`;
  }
  if (input.cancelled.length > 0) {
    return `취소 파일: ${input.cancelled.slice(0, 3).map((item) => item.fileName).join(" · ")}${
      input.cancelled.length > 3 ? ` 외 ${input.cancelled.length - 3}개` : ""
    }`;
  }
  const topSaved = input.done
    .filter((item) => (item.savedBytes ?? 0) > 0)
    .sort((a, b) => (b.savedBytes ?? 0) - (a.savedBytes ?? 0))
    .slice(0, 3);
  if (topSaved.length === 0) return "절감된 파일이 없습니다. 원본과 동일하거나 이미 충분히 최적화된 문서입니다.";
  return `절감 상위: ${topSaved.map((item) => `${item.fileName} ${formatBytes(item.savedBytes ?? 0)}`).join(" · ")}`;
}

function resetBatchCompletedItems(): void {
  if (state.batchRunning || state.batchAnalyzing) return;
  let resetCount = 0;
  for (const item of state.batchItems) {
    if (item.status !== "done" && item.status !== "failed" && item.status !== "cancelled") continue;
    item.status = "pending";
    item.outputPath = undefined;
    item.reportPath = undefined;
    item.savedBytes = undefined;
    item.savedPercent = undefined;
    item.error = undefined;
    resetCount += 1;
  }
  state.batchReportPath = undefined;
  state.batchRunCompleted = false;
  renderBatchList();
  renderBatchResultPanel();
  setStatus(`${resetCount}개 파일을 다시 최적화할 수 있습니다.`);
}

function planDeltaLabel(deltaBytes: number): string {
  if (Math.abs(deltaBytes) < 1024) return "계획과 유사";
  if (deltaBytes > 0) return `예상보다 ${formatBytes(deltaBytes)} 더 절감`;
  return `예상보다 ${formatBytes(Math.abs(deltaBytes))} 덜 절감`;
}

function resetVerificationPanel(): void {
  verificationBody.textContent = "최적화 후 문서 구조, 누락 리소스, 이미지 품질 기준을 자동으로 확인합니다.";
}

function renderAnalysisVerification(report: OptimizationReport): void {
  const warningCount = report.warnings.length;
  const diagnosticCount = (report.resourceDiagnostics ?? []).length + (report.riskyResources?.length ?? 0);
  verificationBody.textContent = [
    "분석 단계 사전 점검을 완료했습니다.",
    warningCount > 0 ? `주의 ${warningCount}개` : "주의 없음",
    diagnosticCount > 0 ? `리소스 진단 ${diagnosticCount}개` : "리소스 진단 없음",
    "이미지 품질 검증은 최적화 실행 시 자동 수행됩니다."
  ].join(" · ");
}

function renderVerificationResult(report: OptimizationReport): void {
  const appliedCount = report.actions.applied.length;
  const skippedCount = report.actions.skipped.length;
  const warningCount = report.warnings.length;
  analysisDetails.open = true;
  analysisDetailSummary.innerHTML =
    '<span class="search-icon" aria-hidden="true"></span><strong>세부 분석 보기</strong><span>검증 완료</span>';
  verificationBody.textContent = [
    "문서 구조와 누락 리소스 검증을 통과했습니다.",
    `적용 ${appliedCount}개`,
    `보류 ${skippedCount}개`,
    warningCount > 0 ? `주의 ${warningCount}개` : "추가 주의 없음"
  ].join(" · ");
}

function renderVerificationFailure(error: unknown): void {
  analysisDetails.open = true;
  analysisDetailSummary.innerHTML =
    '<span class="search-icon" aria-hidden="true"></span><strong>세부 분석 보기</strong><span>검증 실패</span>';
  verificationBody.textContent = errorMessage(error);
}

function targetStatusText(status: OptimizationReport["targetStatus"]): string {
  if (status === "met") return "목표 달성";
  if (status === "already-under-target") return "이미 목표 미만";
  if (status === "missed") return "목표 미달 가능 / 추가 수동 확인 필요";
  return "목표 확인 필요";
}

function openOverlayElement(): HTMLElement | null {
  if (!compareModal.hidden) {
    return (compareModal.querySelector<HTMLElement>(".modal-card") ?? compareModal);
  }
  if (settingsPanel.classList.contains("is-open")) return settingsPanel;
  if (helpPanel.classList.contains("is-open")) return helpPanel;
  return null;
}

function trapFocus(event: KeyboardEvent, container: HTMLElement): void {
  const focusables = Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => element.offsetParent !== null || element === document.activeElement);
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

let compareReturnFocus: HTMLElement | null = null;

async function openImageCompareModal(): Promise<void> {
  if (!state.filePath || !state.result) return;
  compareReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  compareModal.hidden = false;
  compareCloseButton.focus();
  compareSummary.textContent = "이미지 변경 사항을 불러오는 중입니다...";
  compareList.innerHTML = "<p class=\"empty\">잠시만 기다려주세요...</p>";
  try {
    const pairs = await window.hwpxOptimizer.previewImageDiffs({
      originalPath: state.filePath,
      optimizedPath: state.result.outputPath
    });
    if (pairs.length === 0) {
      compareSummary.textContent = "변경된 이미지가 없습니다.";
      compareList.innerHTML = "<p class=\"empty\">표시할 이미지 변경 사항이 없습니다.</p>";
      return;
    }
    compareSummary.textContent = `상위 ${pairs.length}개 이미지 변경 사항을 표시합니다.`;
    compareList.innerHTML = pairs.map(imageComparePairHtml).join("");
  } catch (error) {
    compareSummary.textContent = "이미지 비교를 불러오지 못했습니다.";
    compareList.innerHTML = `<p class="empty">${escapeHtml(errorMessage(error))}</p>`;
  }
}

function closeImageCompareModal(): void {
  const wasOpen = !compareModal.hidden;
  compareModal.hidden = true;
  compareList.innerHTML = "";
  if (wasOpen) {
    compareReturnFocus?.focus();
    compareReturnFocus = null;
  }
}

async function reverifyCurrentResult(): Promise<void> {
  if (!state.result) return;
  reverifyButton.disabled = true;
  setStatus("결과 파일을 다시 검증하는 중입니다...");
  try {
    const response = await window.hwpxOptimizer.verify(state.result.outputPath);
    setStatus(response.ok ? "결과 파일이 유효합니다." : "검증 결과를 받지 못했습니다.");
    analysisDetailSummary.innerHTML =
      '<span class="search-icon" aria-hidden="true"></span><strong>세부 분석 보기</strong><span>재검증 완료</span>';
    verificationBody.textContent = response.ok
      ? "결과 파일 재검증을 통과했습니다."
      : "재검증 응답을 받았지만 통과 여부를 확인하지 못했습니다.";
  } catch (error) {
    setStatus(`검증 실패: ${errorMessage(error)}`);
    analysisDetailSummary.innerHTML =
      '<span class="search-icon" aria-hidden="true"></span><strong>세부 분석 보기</strong><span>검증 실패</span>';
    verificationBody.textContent = errorMessage(error);
  } finally {
    reverifyButton.disabled = !state.result;
  }
}

function renderModeWarning(): void {
  const warning = requireElement("mode-warning");
  warning.textContent = modeWarningMessage({
    mode: state.mode,
    showAggressiveWarning: state.settings?.showAggressiveWarning ?? true
  });
}

function setBusy(message: string, options: { cancelable: boolean; kind?: "analysis" | "optimization" }): void {
  setStatus(message);
  const busyKind = options.kind ?? (options.cancelable ? "optimization" : "analysis");
  document.body.dataset.busy = busyKind;
  progressTitle.textContent = busyKind === "analysis" ? "분석 중" : "최적화 중";
  resetProgressAnimation();
  progressPanel.hidden = false;
  progressPanel.classList.add("is-loading");
  optimizeButton.disabled = true;
  renderSelectionClearButton();
  setSubmissionInputsDisabled(true);
  renderRunDock(state.currentPlan);
  cancelButton.disabled = !options.cancelable;
}

function setIdle(): void {
  optimizeButton.disabled = !state.currentPlan;
  setSubmissionInputsDisabled(false);
  renderSelectionClearButton();
  renderRunDock(state.currentPlan);
  cancelButton.disabled = true;
}

function setSubmissionInputsDisabled(disabled: boolean): void {
  submissionLimitSelect.disabled = disabled;
  customLimitInput.disabled = disabled;
  preservationSelect.disabled = disabled;
  batchTargetModeSelect.disabled = disabled;
  cleanupDocumentToggle.disabled = disabled;
  cleanupImageToggle.disabled = disabled;
  actionCheckboxes.querySelectorAll<HTMLInputElement>("input[type='checkbox']").forEach((input) => {
    input.disabled = disabled;
  });
  runDockButton.disabled = disabled || optimizeButton.disabled;
}

function setStatus(message: string): void {
  statusText.textContent = message;
  statusBannerText.textContent = message;
  statusBanner.hidden = message.trim().length === 0;
  statusBanner.dataset.tone = statusTone(message);
}

function statusTone(message: string): "info" | "success" | "warning" {
  if (/실패|오류|없습니다|초과|권한|손상|아닙니다|보류|우회|지원/i.test(message)) return "warning";
  if (/완료|성공|통과|변경했습니다|저장/i.test(message)) return "success";
  return "info";
}

function errorMessage(error: unknown): string {
  return errorLabel(error instanceof Error ? error.message : String(error));
}

function setAllActionSelections(enabled: boolean): void {
  for (const action of currentPlanActions()) {
    state.actionSelections.set(action, enabled);
  }
}

function currentPlanActions(): SubmissionActionId[] {
  if (document.body.dataset.view === "batch") {
    return createBatchPlanSummary()?.rows.flatMap((row) => row.actions ?? []) ?? [];
  }
  return state.currentPlan ? visiblePlanRows(state.currentPlan).flatMap((row) => row.actions) : [];
}

function selectedActionsForOptimize(): string[] | undefined {
  if (!state.currentPlan || state.currentPlan.mode === "safe") return undefined;
  const selected = state.currentPlan.selectedActions;
  if (state.currentPlan.kind === "automatic") return undefined;
  return selected;
}

function actionValuesFromCheckbox(input: HTMLInputElement): SubmissionActionId[] {
  const actions = input.dataset.actions?.split(",").filter(Boolean) as SubmissionActionId[] | undefined;
  return actions && actions.length > 0 ? actions : [input.value as SubmissionActionId];
}

function syncActionCheckboxIndeterminateState(): void {
  actionCheckboxes.querySelectorAll<HTMLInputElement>("input[data-indeterminate='true']").forEach((input) => {
    input.indeterminate = true;
  });
}

function enterBatchMode(paths: string[], options: { preservePolicy?: boolean } = {}): void {
  if (state.batchRunning || state.batchAnalyzing || state.analysisRunning || state.optimizeRunning) {
    setStatus("처리 중에는 새 파일을 추가할 수 없습니다. 완료 후 다시 시도하세요.");
    return;
  }
  document.body.dataset.view = "batch";
  state.filePath = undefined;
  state.report = undefined;
  state.result = undefined;
  state.batchReportPath = undefined;
  state.batchRunCompleted = false;
  state.currentPlan = undefined;
  if (!options.preservePolicy) state.actionSelections.clear();
  resultPanel.hidden = true;
  resultGuidance.textContent = "";
  resetVerificationPanel();
  actionPanel.hidden = true;
  actionCheckboxes.innerHTML = "";
  singleWorkspace.hidden = false;
  selectedFileCard.hidden = true;
  dropZone.hidden = true;

  const seen = new Set(state.batchItems.map((item) => item.path));
  for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);
    state.batchItems.push({
      path,
      fileName: fileNameFromPath(path),
      selected: true,
      status: "pending"
    });
  }
  refreshSubmissionPlan();
  selectedFileCard.hidden = true;
  dropZone.hidden = true;
  fileName.textContent = "여러 HWPX 일괄 처리";
  fileMeta.textContent = `${state.batchItems.length}개 파일`;
  optimizeButton.disabled = true;
  batchPanel.hidden = false;
  renderBatchList();
  setStatus(`${state.batchItems.length}개 파일이 일괄 처리 대기 중입니다.`);
  void analyzeBatchItems();
}

function renderBatchList(): void {
  const busy = state.batchRunning || state.batchAnalyzing;
  batchSummary.textContent = summarizeBatchItems(state.batchItems, { running: busy }).text;
  batchList.innerHTML = state.batchItems
    .map((item, index) => batchItemRowHtml(item, index, { running: busy }))
    .join("");
  const pendingItems = state.batchItems.filter((item) => item.status === "pending");
  const selectedPending = pendingItems.filter((item) => item.selected).length;
  batchRunButton.disabled = state.batchAnalyzing || state.batchRunning || selectedPending === 0;
  batchSelectAll.disabled = busy || pendingItems.length === 0;
  batchSelectAll.checked = pendingItems.length > 0 && selectedPending === pendingItems.length;
  batchSelectAll.indeterminate = selectedPending > 0 && selectedPending < pendingItems.length;
  renderSelectionClearButton();
  batchRunButton.textContent = state.batchAnalyzing ? "분석 중..." : state.batchRunning ? "처리 중..." : "일괄 최적화";
  renderBatchSummary();
}

function renderSelectionClearButton(): void {
  const busy = state.batchAnalyzing || state.batchRunning || state.analysisRunning;
  const isBatch = document.body.dataset.view === "batch" && state.batchItems.length > 0;
  const isSingle = document.body.dataset.view === "single" && Boolean(state.filePath);
  batchClearButton.disabled = busy || (!isBatch && !isSingle);
  batchClearButton.innerHTML = `<span class="trash-icon" aria-hidden="true"></span>${isSingle ? "파일 제거" : "목록 비우기"}`;
}

function clearSelectedFiles(message: string): void {
  analysisSequence += 1;
  document.body.dataset.view = "empty";
  document.body.dataset.result = "";
  document.body.dataset.batchResult = "";
  state.filePath = undefined;
  state.report = undefined;
  state.result = undefined;
  state.currentPlan = undefined;
  state.batchItems = [];
  state.batchReportPath = undefined;
  state.batchRunCompleted = false;
  state.actionSelections.clear();
  batchList.innerHTML = "";
  batchPanel.hidden = true;
  batchResultPanel.hidden = true;
  selectedFileCard.hidden = true;
  dropZone.hidden = false;
  singleWorkspace.hidden = false;
  actionPanel.hidden = true;
  actionCheckboxes.innerHTML = "";
  resultPanel.hidden = true;
  resultGuidance.textContent = "";
  fileName.textContent = "HWPX 파일 가져오기";
  fileMeta.innerHTML = "<strong>창 어디에든</strong> 끌어다 놓거나, 아래 버튼으로 선택하세요.";
  resetVerificationPanel();
  renderSubmissionControls();
  renderDefaultPlan();
  renderEmptySummary();
  setStatus(message);
}

function promoteRemainingBatchItemToSingle(item: BatchItem): void {
  analysisSequence += 1;
  document.body.dataset.view = "single";
  document.body.dataset.result = "";
  document.body.dataset.batchResult = "";
  state.filePath = item.path;
  state.report = item.report;
  state.result = undefined;
  state.currentPlan = undefined;
  state.batchItems = [];
  state.batchReportPath = undefined;
  state.batchRunCompleted = false;
  state.batchCancelled = false;
  state.actionSelections.clear();
  batchList.innerHTML = "";
  batchPanel.hidden = true;
  batchResultPanel.hidden = true;
  singleWorkspace.hidden = false;
  selectedFileCard.hidden = false;
  dropZone.hidden = true;
  resultPanel.hidden = true;
  resultGuidance.textContent = "";
  fileName.textContent = item.fileName;
  fileMeta.textContent = "선택한 경로는 현재 실행에서만 사용하며 저장하지 않습니다.";
  selectedFileName.textContent = item.fileName;
  selectedFilePath.textContent = "파일 경로는 앱 기록으로 저장하지 않습니다.";
  selectedOriginalMeta.textContent = item.originalSizeLabel ? `원본 ${item.originalSizeLabel}` : "원본 분석 대기";
  selectedModifiedMeta.textContent = "수정일: 분석 대기";
  resetVerificationPanel();
  compareButton.disabled = true;
  closeImageCompareModal();

  if (item.report) {
    renderAnalysis(item.report);
    refreshSubmissionPlan();
    renderRunDock(state.currentPlan);
    setStatus("남은 1개 파일을 단일 모드로 전환했습니다.");
    return;
  }

  state.report = undefined;
  state.analysisRunning = true;
  renderPendingAnalysisSummary();
  setStatus("남은 1개 파일을 단일 모드로 전환하고 분석합니다.");
  void analyzeFile(item.path);
}

function setDragOver(active: boolean): void {
  document.body.dataset.dragOver = active ? "true" : "";
  dropOverlay.hidden = !active;
  dropOverlay.setAttribute("aria-hidden", active ? "false" : "true");
  dropZone.classList.toggle("is-over", active && !dropZone.hidden);
}

async function analyzeBatchItems(): Promise<void> {
  const pendingItems = state.batchItems.filter((item) => !item.report && item.status === "pending");
  if (pendingItems.length > 0) {
    state.batchAnalyzing = true;
    state.batchCancelled = false;
    setBusy("파일 목록을 분석하는 중입니다...", { cancelable: true, kind: "analysis" });
    renderProgress(4, "일괄 분석을 준비하는 중입니다");
    renderBatchList();
  }
  let analyzedCount = 0;
  try {
    for (const item of state.batchItems) {
      if (state.batchCancelled) {
        if (item.status === "pending" && !item.report) item.status = "cancelled";
        continue;
      }
      if (item.report || item.status !== "pending") continue;
      try {
        const percentBase = pendingItems.length > 0 ? (analyzedCount / pendingItems.length) * 88 : 0;
        renderProgress(6 + percentBase, `${item.fileName} 분석 중`);
        const response = await window.hwpxOptimizer.analyze(item.path);
        item.report = response.report;
        item.originalSizeBytes = response.report.originalSize;
        const targetAllocation = summarizeAggregateTargetAllocation(state.batchItems);
        const plan = createSubmissionPlan(response.report, {
          submissionLimit: batchSubmissionLimitForItem(item, targetAllocation),
          preservationPreference: state.preservationPreference,
          actionOverrides: state.actionSelections,
          ...(state.qualityMode === "manual" && state.preservationPreference !== "preserve"
            ? { jpegQuality: state.jpegQuality }
            : {})
        });
        item.expectedSizeBytes = plan.expectedSizeBytes;
        item.originalSizeLabel = plan.originalSizeLabel;
        item.expectedSizeLabel = plan.expectedSizeLabel.replace(/^약 /, "");
        item.targetLabel = batchTargetLabelForItem(item, targetAllocation);
        item.targetStatusLabel = plan.verdictLabel;
        item.qualityLabel = qualityLabelForBatchItem(item, plan);
        item.jpegQualityDisplay = qualityDisplayForBatchItem(item, plan);
        item.qualityEditable =
          state.preservationPreference !== "size" &&
          state.preservationPreference !== "preserve" &&
          (state.qualityMode === "manual" || item.jpegQualityOverride !== undefined);
        item.allocatedTargetLabel = batchAllocatedTargetLabelForItem(item, targetAllocation);
        analyzedCount += 1;
        renderProgress(
          6 + (pendingItems.length > 0 ? (analyzedCount / pendingItems.length) * 88 : 88),
          `${item.fileName} 분석 완료`
        );
        renderBatchList();
      } catch (error) {
        analyzedCount += 1;
        item.status = state.batchCancelled ? "cancelled" : "failed";
        item.error = state.batchCancelled ? undefined : errorMessage(error);
        renderBatchList();
      }
    }
    if (pendingItems.length > 0 && !state.batchCancelled) {
      renderProgress(100, "일괄 분석 완료");
      setStatus("일괄 분석이 완료되었습니다. 제출 기준에 맞게 최적화할 수 있습니다.");
      refreshBatchPlanItems();
    }
  } finally {
    if (pendingItems.length > 0) {
      state.batchAnalyzing = false;
      setIdle();
      hideProgressPanel();
    }
    renderBatchList();
  }
}

function refreshBatchPlans(): void {
  if (state.batchItems.length === 0) return;
  refreshBatchPlanItems();
  renderBatchList();
}

function refreshBatchPlanItems(): void {
  const targetAllocation = summarizeAggregateTargetAllocation(state.batchItems);
  for (const item of state.batchItems) {
    if (!item.report) continue;
    // Terminal rows keep the actual optimize outcome — do not re-estimate from the result report.
    if (item.status === "done" || item.status === "failed" || item.status === "cancelled") continue;
    const jpegQuality =
      state.preservationPreference === "size" || state.preservationPreference === "preserve"
        ? undefined
        : item.jpegQualityOverride ??
          (state.qualityMode === "manual" ? state.jpegQuality : undefined);
    const plan = createSubmissionPlan(item.report, {
      submissionLimit: batchSubmissionLimitForItem(item, targetAllocation),
      preservationPreference: state.preservationPreference,
      actionOverrides: state.actionSelections,
      ...(jpegQuality !== undefined ? { jpegQuality } : {})
    });
    item.expectedSizeBytes = plan.expectedSizeBytes;
    item.expectedSizeLabel = plan.expectedSizeLabel.replace(/^약 /, "");
    item.targetLabel = batchTargetLabelForItem(item, targetAllocation);
    item.targetStatusLabel = plan.verdictLabel;
    item.qualityLabel = qualityLabelForBatchItem(item, plan);
    item.jpegQualityDisplay = qualityDisplayForBatchItem(item, plan);
    item.qualityEditable =
      state.preservationPreference !== "size" &&
      state.preservationPreference !== "preserve" &&
      (state.qualityMode === "manual" || item.jpegQualityOverride !== undefined);
    item.allocatedTargetLabel = batchAllocatedTargetLabelForItem(item, targetAllocation);
  }
}

function handleBatchRowAction(button: HTMLButtonElement): void {
  const action = button.dataset.action;
  const index = Number(button.dataset.index ?? "-1");
  const item = Number.isInteger(index) ? state.batchItems[index] : undefined;
  if (!item) return;
  if (action === "open-file" && item.outputPath) {
    void window.hwpxOptimizer.openPath(item.outputPath);
  } else if (action === "show-folder" && item.outputPath) {
    void window.hwpxOptimizer.showItem(item.outputPath);
  } else if (action === "open-report" && item.reportPath) {
    void window.hwpxOptimizer.openPath(item.reportPath);
  } else if (action === "remove") {
    if (state.batchRunning || state.batchAnalyzing) return;
    state.batchItems.splice(index, 1);
    if (state.batchItems.length === 0) {
      batchPanel.hidden = true;
      dropZone.hidden = false;
      document.body.dataset.view = "empty";
      singleWorkspace.hidden = false;
      renderEmptySummary();
      setStatus("배치 목록을 비웠습니다.");
    } else if (state.batchItems.length === 1) {
      promoteRemainingBatchItemToSingle(state.batchItems[0]);
      return;
    }
    renderBatchList();
  }
}

async function runBatch(): Promise<void> {
  if (state.batchRunning || state.batchItems.length === 0) return;
  const selectedPending = state.batchItems.filter((item) => item.status === "pending" && item.selected).length;
  if (selectedPending === 0) {
    setStatus("처리할 파일을 하나 이상 선택하세요.");
    return;
  }
  state.batchRunning = true;
  state.batchRunCompleted = false;
  state.batchCancelled = false;
  setBusy(`${selectedPending}개 파일을 처리합니다.`, {
    cancelable: true
  });
  optimizeButton.disabled = true;
  renderBatchList();

  for (let index = 0; index < state.batchItems.length; index += 1) {
    const item = state.batchItems[index];
    // Unchecked files stay pending and are intentionally skipped.
    if (item.status !== "pending" || !item.selected) continue;
    if (state.batchCancelled) {
      item.status = "cancelled";
      continue;
    }
    item.status = "running";
    const targetAllocation = summarizeAggregateTargetAllocation(state.batchItems);
    renderBatchList();
    // Reset per item so each file's own 0->100 progress (from onOptimizeProgress)
    // shows, instead of the monotonic bar sticking at 100% after the first file.
    resetProgressAnimation();
    renderProgress(2, `${index + 1}/${state.batchItems.length} ${item.fileName} 처리 중`);
    try {
      const plan = item.report
        ? createSubmissionPlan(item.report, {
            submissionLimit: batchSubmissionLimitForItem(item, targetAllocation),
            preservationPreference: state.preservationPreference,
            actionOverrides: state.actionSelections
          })
        : undefined;
      const jpegQuality = jpegQualityForOptimize(item);
      const response = await window.hwpxOptimizer.optimize({
        filePath: item.path,
        mode: plan?.mode ?? modeForPreservation(state.preservationPreference),
        outputDirectory: state.outputDirectory,
        outputMode: "batch",
        actions: selectedActionsForPlan(plan),
        targetBytes: batchTargetBytesForItem(item, targetAllocation),
        ...(jpegQuality !== undefined ? { jpegQuality } : {})
      });
      Object.assign(item, applyOptimizationResultToBatchItem(item, response));
    } catch (error) {
      if (state.batchCancelled) {
        item.status = "cancelled";
      } else {
        item.status = "failed";
        item.error = errorMessage(error);
      }
    }
    renderBatchList();
  }

  state.batchRunning = false;
  state.batchRunCompleted = true;
  cancelButton.disabled = true;
  hideProgressPanel();
  const batchReportPath = await saveBatchSummaryReport();
  state.batchReportPath = batchReportPath;
  renderBatchList();
  renderBatchResultPanel();
  const completed = state.batchItems.filter((item) => item.status === "done").length;
  const failed = state.batchItems.filter((item) => item.status === "failed").length;
  setStatus(
    batchReportPath
      ? `일괄 처리가 끝났습니다. 완료 ${completed}, 실패 ${failed}. 리포트: ${fileNameFromPath(batchReportPath)}`
      : `일괄 처리가 끝났습니다. 완료 ${completed}, 실패 ${failed}.`
  );
}

async function saveBatchSummaryReport(): Promise<string | undefined> {
  if (!state.settings?.saveReport || state.batchItems.length === 0) return undefined;
  const firstInputPath = state.batchItems[0]?.path;
  if (!firstInputPath) return undefined;
  try {
    const result = await window.hwpxOptimizer.saveBatchReport({
      firstInputPath,
      outputDirectory: state.outputDirectory,
      mode: modeForPreservation(state.preservationPreference),
      batchTargetBytes: state.batchTargetMode === "aggregate" ? resolveBatchTargetBytes() : undefined,
      items: state.batchItems
        .filter((item) => item.status === "done" || item.status === "failed" || item.status === "cancelled")
        .map((item) => ({
          input: item.fileName,
          status: item.status as "done" | "failed" | "cancelled",
          output: item.outputPath,
          report: item.reportPath,
          error: item.error,
          originalSize: item.report?.originalSize,
          optimizedSize: item.report?.optimizedSize,
          savedBytes: item.savedBytes,
          savedPercent: item.savedPercent
        }))
    });
    return result.reportPath;
  } catch (error) {
    setStatus(`일괄 처리는 끝났지만 리포트를 저장하지 못했습니다. ${errorMessage(error)}`);
    return undefined;
  }
}

function selectedActionsForPlan(plan: SubmissionPlan | undefined): string[] | undefined {
  if (!plan || plan.mode === "safe" || plan.kind === "automatic") return undefined;
  return plan.selectedActions;
}

function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element;
}

function requireButton(id: string): HTMLButtonElement {
  return requireElement(id) as HTMLButtonElement;
}

function requireInput(id: string): HTMLInputElement {
  return requireElement(id) as HTMLInputElement;
}

function requireSelect(id: string): HTMLSelectElement {
  return requireElement(id) as HTMLSelectElement;
}
