import {
  appendUniquePaths,
  applyOptimizationResultToBatchItem,
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
import { resultGuidanceText } from "./shared/resultGuidance.js";
import { createSubmissionPlan, modeForPreservation } from "./shared/submissionPlan.js";
import type {
  PreservationPreference,
  SubmissionActionId,
  SubmissionLimit,
  SubmissionPlan
} from "./shared/submissionPlan.js";

declare global {
  interface Window {
    hwpxOptimizer: HwpxOptimizerApi;
  }
}

type BatchItem = {
  path: string;
  fileName: string;
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
  savedBytes?: number;
  savedPercent?: number;
  error?: string;
};

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
  currentPlan?: SubmissionPlan;
  batchItems: BatchItem[];
  batchAnalyzing: boolean;
  batchRunning: boolean;
  batchCancelled: boolean;
  batchRunCompleted: boolean;
  analysisRunning: boolean;
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
  submissionLimit: { id: "mb20" },
  preservationPreference: "recommended",
  batchItems: [],
  batchAnalyzing: false,
  batchRunning: false,
  batchCancelled: false,
  batchRunCompleted: false,
  analysisRunning: false
};

let settingsSaveSequence = 0;
let analysisSequence = 0;
let progressAnimationTimer: number | undefined;
let displayedProgressPercent = 0;
let targetProgressPercent = 0;
let lastTauriDropEventAt = 0;
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
const runDock = requireElement("run-dock");
const runDockStatus = requireElement("run-dock-status");
const runDockSummary = requireElement("run-dock-summary");
const runDockButton = requireButton("run-dock-button");

void init();

async function init(): Promise<void> {
  const settings = (await window.hwpxOptimizer.loadSettings()) as DesktopSettings;
  state.settings = settings;
  state.mode = settings.defaultMode ?? "safe";
  state.submissionLimit = settings.submissionLimit ?? { id: "mb20" };
  state.preservationPreference = settings.preservationPreference ?? "recommended";
  renderSettings(settings);
  renderSubmissionControls();
  modeInputs.find((input) => input.value === state.mode)?.click();

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
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>("button[data-action]");
    if (button) handleBatchRowAction(button);
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
      state.batchCancelled = state.batchAnalyzing;
      await window.hwpxOptimizer.cancelAnalyze();
      setStatus("분석을 취소했습니다.");
      setIdle();
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
      setSettingsOpen(false);
      setHelpOpen(false);
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
      void saveSettings({ defaultMode: state.mode });
      renderModeWarning();
      refreshSubmissionPlan();
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
    state.actionSelections.clear();
    renderSubmissionControls();
    refreshSubmissionPlan();
    refreshBatchPlans();
    void saveSettings({ preservationPreference: state.preservationPreference });
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
    modeInputs.find((input) => input.value === nextMode)?.click();
    void saveSettings({ defaultMode: nextMode });
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
    if (Date.now() - lastTauriDropEventAt < 500) return;
    const dropped = event.dataTransfer?.files;
    await handleDroppedFiles(dropped ? Array.from(dropped) : []);
  });
  window.addEventListener("hwpx-tauri-dropped-files", () => {
    lastTauriDropEventAt = Date.now();
    setDragOver(false);
    void handleDroppedFiles([], { allowEmptyRegistration: true, silentWhenEmpty: true });
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
  if (state.batchRunning || state.batchAnalyzing || state.analysisRunning) {
    setStatus("처리 중에는 새 파일을 추가할 수 없습니다. 완료 후 다시 시도하세요.");
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
  renderSettings(settings);
  renderSubmissionControls();
  if (state.report) refreshSubmissionPlan();
  if (state.batchItems.length > 0) refreshBatchPlans();
}

function renderSettings(settings: DesktopSettings): void {
  settingDefaultMode.value = settings.defaultMode;
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

function setSettingsOpen(open: boolean): void {
  if (open) setHelpOpen(false);
  settingsPanel.classList.toggle("is-open", open);
  settingsPanel.setAttribute("aria-hidden", open ? "false" : "true");
  settingsBackdrop.hidden = !open;
}

function setHelpOpen(open: boolean): void {
  if (open) setSettingsOpen(false);
  helpPanel.classList.toggle("is-open", open);
  helpPanel.setAttribute("aria-hidden", open ? "false" : "true");
  helpBackdrop.hidden = !open;
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
    ? String(Math.round(state.submissionLimit.customBytes / 1024 / 1024))
    : "";
  preservationSelect.value = state.preservationPreference;
  renderCleanupSettings();
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
    actionOverrides: state.actionSelections
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
    { priority: 1, label: "중복 이미지 참조 정리", savingLabel: "분석 후 표시", kind: "image" },
    { priority: 2, label: "이미지 무손실 최적화", savingLabel: "분석 후 표시", kind: "image" },
    { priority: 3, label: "큰 이미지 변환·리사이즈", savingLabel: "분석 후 표시", kind: "image" }
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
  summaryStatus.innerHTML = '<span class="success-dot" aria-hidden="true"></span>파일을 선택하면 분석 결과가 표시됩니다.';
  summaryResultLine.textContent = "예상 결과: -";
  summaryTargetLine.textContent = `제출 기준: ${targetLabelForDisplay()}`;
  targetTrackFill.style.width = "0%";
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
  targetTrackFill.style.width = "0%";
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
  summaryStatus.innerHTML = `<span class="success-dot" aria-hidden="true"></span>${singleStatusText(plan)}`;
  summaryResultLine.textContent = `예상 결과: ${plan.expectedSizeLabel.replace(/^약 /, "")}`;
  summaryTargetLine.textContent = `제출 기준: ${targetLabelForDisplay()}`;
  targetTrackFill.style.width = `${progressForPlan(plan)}%`;
  optimizeButton.textContent = "제출 기준에 맞게 줄이기";
  renderSelectionClearButton();
  renderRunDock(plan);
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
  const originalTotal = analyzed.reduce((sum, item) => sum + (item.originalSizeBytes ?? 0), 0);
  const expectedTotal = analyzed.reduce((sum, item) => sum + (item.expectedSizeBytes ?? item.originalSizeBytes ?? 0), 0);
  const saving = Math.max(0, originalTotal - expectedTotal);
  const savingPercent = originalTotal > 0 ? (saving / originalTotal) * 100 : 0;
  const passed = analyzed.filter((item) => item.targetStatusLabel !== "목표 미달 가능").length;
  const warning = Math.max(0, analyzed.length - passed);
  summaryOriginal.textContent = analyzed.length ? formatBytes(originalTotal) : "-";
  summaryExpected.textContent = analyzed.length ? formatBytes(expectedTotal) : "-";
  summarySaving.textContent = analyzed.length ? formatBytes(saving) : "-";
  summaryPercent.textContent = analyzed.length ? `${savingPercent.toFixed(1)}%` : "-";
  summaryStatus.innerHTML = `<span class="success-dot" aria-hidden="true"></span>${
    analyzed.length ? `목표 통과 예상 ${passed}개 · 주의 필요 ${warning}개` : "파일을 분석하는 중입니다."
  }`;
  summaryResultLine.textContent = analyzed.length ? `예상 결과: ${formatBytes(expectedTotal)}` : "예상 결과: -";
  summaryTargetLine.textContent = `제출 기준: ${targetLabelForDisplay()}`;
  targetTrackFill.style.width = `${Math.min(100, Math.max(0, savingPercent))}%`;
  optimizeButton.textContent = "제출 기준에 맞게 일괄 최적화";
  optimizeButton.disabled = state.batchAnalyzing || !state.batchItems.some((item) => item.status === "pending");
  renderRunDock();
  renderBatchPlanSummary();
  renderBatchResultPanel();
}

function createBatchPlanSummary(): BatchPlanSummary | undefined {
  const analyzedItems = state.batchItems.filter((item) => item.report);
  if (analyzedItems.length === 0) return undefined;
  const rowMap = new Map<SubmissionActionId, DisplayPlanRow & { savingBytes: number; count: number }>();
  let expectedSizeBytes = 0;
  let expectedSavingBytes = 0;
  let metCount = 0;
  let warningCount = 0;
  let reviewCount = 0;

  for (const item of analyzedItems) {
    if (!item.report) continue;
    const plan = createSubmissionPlan(item.report, {
      submissionLimit: state.submissionLimit,
      preservationPreference: state.preservationPreference,
      actionOverrides: state.actionSelections
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
  if (state.submissionLimit.id === "mb5") return 5 * 1024 * 1024;
  if (state.submissionLimit.id === "mb10") return 10 * 1024 * 1024;
  if (state.submissionLimit.id === "mb20") return 20 * 1024 * 1024;
  if (state.submissionLimit.id === "mb30") return 30 * 1024 * 1024;
  if (state.submissionLimit.id === "mb41") return 41 * 1024 * 1024;
  if (state.submissionLimit.id === "mb50") return 50 * 1024 * 1024;
  if (state.submissionLimit.id === "mb100") return 100 * 1024 * 1024;
  if (state.submissionLimit.id === "custom") return state.submissionLimit.customBytes;
  return undefined;
}

function percentFromPlan(plan: SubmissionPlan): number {
  const original = state.report?.originalSize ?? 0;
  return original > 0 ? (plan.expectedSavingBytes / original) * 100 : 0;
}

function progressForPlan(plan: SubmissionPlan): number {
  const original = state.report?.originalSize ?? 0;
  if (original <= 0) return 0;
  return Math.min(100, Math.max(0, (plan.expectedSavingBytes / original) * 100));
}

function singleStatusText(plan: SubmissionPlan): string {
  if (plan.targetStatus === "target-met") return "제출 기준 충족 가능";
  if (plan.targetStatus === "already-under-target") return "이미 제출 기준 이하";
  if (plan.targetStatus === "target-missed") return "제출 기준 주의 필요";
  return "목표 제한 없음";
}

async function loadFile(path: string): Promise<void> {
  if (state.batchRunning || state.batchAnalyzing || state.analysisRunning) {
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
    renderProgress(82, "예상 용량과 제출 기준 충족 여부를 계산하는 중입니다");
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
  if (!state.filePath || !state.report) return;
  let succeeded = false;
  try {
    setBusy(`${modeLabel(state.mode)} 모드로 최적화하는 중입니다...`, { cancelable: true });
    renderProgress(5, "최적화를 준비하는 중입니다");
    const response = await window.hwpxOptimizer.optimize({
      filePath: state.filePath,
      mode: state.mode,
      outputDirectory: state.outputDirectory,
      outputMode: "single",
      actions: selectedActionsForOptimize()
    });
    state.result = response;
    renderResult(response.report, response.outputPath, response.reportPath);
    setStatus("최적화가 완료되었습니다. 파일을 열어 제출 전 상태를 확인하세요.");
    succeeded = true;
  } catch (error) {
    renderVerificationFailure(error);
    setStatus(errorMessage(error));
  } finally {
    setIdle();
    if (!succeeded) resetProgressAnimation();
    hideProgressPanel();
  }
}

function renderProgress(percent: number, item: string): void {
  progressPanel.hidden = false;
  targetProgressPercent = Math.max(targetProgressPercent, Math.max(0, Math.min(100, percent)));
  progressItem.textContent = `${progressLabel(item)} · ${Math.round(targetProgressPercent)}%`;
  startProgressAnimation();
}

function hideProgressPanel(): void {
  document.body.dataset.busy = "";
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
}

function startProgressAnimation(): void {
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
  selectedOriginalMeta.textContent = `원본 크기: ${view.originalSizeLabel}`;
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
  batchResultTitle.textContent = failed.length > 0 ? "일괄 최적화 확인 필요" : "일괄 최적화 완료";
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
  if (status === "already-under-target") return "이미 목표 이하";
  if (status === "missed") return "목표 미달 가능 / 추가 수동 확인 필요";
  return "목표 확인 필요";
}

async function openImageCompareModal(): Promise<void> {
  if (!state.filePath || !state.result) return;
  compareModal.hidden = false;
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
  compareModal.hidden = true;
  compareList.innerHTML = "";
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
  document.body.dataset.busy = options.kind ?? (options.cancelable ? "optimization" : "analysis");
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

function enterBatchMode(paths: string[]): void {
  if (state.batchRunning || state.batchAnalyzing || state.analysisRunning) {
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
  state.actionSelections.clear();
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
      status: "pending"
    });
  }
  refreshSubmissionPlan();
  selectedFileCard.hidden = true;
  dropZone.hidden = true;
  fileName.textContent = "여러 HWPX 일괄 처리";
  fileMeta.textContent = `${paths.length}개 파일`;
  optimizeButton.disabled = true;
  batchPanel.hidden = false;
  renderBatchList();
  renderBatchSummary();
  setStatus(`${state.batchItems.length}개 파일이 일괄 처리 대기 중입니다.`);
  void analyzeBatchItems();
}

function renderBatchList(): void {
  const busy = state.batchRunning || state.batchAnalyzing;
  batchSummary.textContent = summarizeBatchItems(state.batchItems, { running: busy }).text;
  batchList.innerHTML = state.batchItems
    .map((item, index) => batchItemRowHtml(item, index, { running: busy }))
    .join("");
  batchRunButton.disabled =
    state.batchAnalyzing || state.batchRunning || !state.batchItems.some((item) => item.status === "pending");
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
  selectedOriginalMeta.textContent = item.originalSizeLabel ? `원본 크기: ${item.originalSizeLabel}` : "원본 크기: 분석 대기";
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
        const plan = createSubmissionPlan(response.report, {
          submissionLimit: state.submissionLimit,
          preservationPreference: state.preservationPreference,
          actionOverrides: state.actionSelections
        });
        item.report = response.report;
        item.originalSizeBytes = response.report.originalSize;
        item.expectedSizeBytes = plan.expectedSizeBytes;
        item.originalSizeLabel = plan.originalSizeLabel;
        item.expectedSizeLabel = plan.expectedSizeLabel;
        item.targetLabel = targetLabelForDisplay();
        item.targetStatusLabel = plan.targetStatusLabel;
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
    if (pendingItems.length > 0) {
      renderProgress(100, "일괄 분석 완료");
      setStatus("일괄 분석이 완료되었습니다. 제출 기준에 맞게 최적화할 수 있습니다.");
    }
  } finally {
    if (pendingItems.length > 0) {
      state.batchAnalyzing = false;
      hideProgressPanel();
    }
    renderBatchList();
  }
  renderBatchSummary();
}

function refreshBatchPlans(): void {
  if (state.batchItems.length === 0) return;
  for (const item of state.batchItems) {
    if (!item.report) continue;
    const plan = createSubmissionPlan(item.report, {
      submissionLimit: state.submissionLimit,
      preservationPreference: state.preservationPreference,
      actionOverrides: state.actionSelections
    });
    item.expectedSizeBytes = plan.expectedSizeBytes;
    item.expectedSizeLabel = plan.expectedSizeLabel;
    item.targetLabel = targetLabelForDisplay();
    item.targetStatusLabel = plan.targetStatusLabel;
  }
  renderBatchList();
  renderBatchSummary();
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
  state.batchRunning = true;
  state.batchRunCompleted = false;
  state.batchCancelled = false;
  setBusy(`${state.batchItems.filter((item) => item.status === "pending").length}개 파일을 처리합니다.`, {
    cancelable: true
  });
  optimizeButton.disabled = true;
  renderBatchList();

  for (let index = 0; index < state.batchItems.length; index += 1) {
    const item = state.batchItems[index];
    if (item.status !== "pending") continue;
    if (state.batchCancelled) {
      item.status = "cancelled";
      continue;
    }
    item.status = "running";
    renderBatchList();
    renderProgress(
      (index / state.batchItems.length) * 100,
      `${index + 1}/${state.batchItems.length} ${item.fileName} 처리 시작`
    );
    try {
      const plan = item.report
        ? createSubmissionPlan(item.report, {
            submissionLimit: state.submissionLimit,
            preservationPreference: state.preservationPreference,
            actionOverrides: state.actionSelections
          })
        : undefined;
      const response = await window.hwpxOptimizer.optimize({
        filePath: item.path,
        mode: plan?.mode ?? modeForPreservation(state.preservationPreference),
        outputDirectory: state.outputDirectory,
        outputMode: "batch",
        actions: selectedActionsForPlan(plan)
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
