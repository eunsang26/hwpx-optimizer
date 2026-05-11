import { applyOptimizationResultToBatchItem, summarizeBatchItems } from "./shared/batchView.js";
import { escapeHtml, fileNameFromPath, looksLikeOptimizedFileName } from "./shared/format.js";
import { actionLabel, groupWarnings, modeLabel, modeWarningMessage, progressLabel } from "./shared/labels.js";
import {
  batchItemRowHtml,
  categoryBarHtml,
  imageComparePairHtml,
  metricHtml
} from "./shared/templates.js";
import { createAnalysisViewModel, formatBytes } from "./shared/viewModel.js";
import type { OptimizationReport } from "@hwpx-optimizer/core";
import type { HwpxOptimizerApi } from "./preload.js";
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
};

const state: AppState = {
  mode: "safe",
  actionSelections: new Map(),
  submissionLimit: { id: "mb20" },
  preservationPreference: "recommended",
  batchItems: [],
  batchAnalyzing: false,
  batchRunning: false,
  batchCancelled: false
};

let settingsSaveSequence = 0;

type DesktopSettings = {
  defaultMode: AppState["mode"];
  saveNextToOriginal: boolean;
  saveReport: boolean;
  preventOverwrite: boolean;
  showAggressiveWarning: boolean;
  submissionLimit: SubmissionLimit;
  preservationPreference: PreservationPreference;
};

const dropZone = requireElement("drop-zone");
const fileName = requireElement("file-name");
const fileMeta = requireElement("file-meta");
const analyzeButton = requireButton("analyze-button");
const chooseButton = requireButton("choose-button");
const chooseManyButton = requireButton("choose-many-button");
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
const settingsButton = requireButton("settings-button");
const settingsPanel = requireElement("settings-panel");
const resultPanel = requireElement("result-panel");
const resultSummary = requireElement("result-summary");
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
const privacyToggle = requireInput("privacy-toggle");
const planTitle = requireElement("plan-title");
const planSummary = requireElement("plan-summary");
const planTotal = requireElement("plan-total");
const analysisDetailSummary = requireElement("analysis-detail-summary");
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

  const selectSingleFile = async () => {
    const selected = await window.hwpxOptimizer.selectHwpx();
    if (selected) await loadFile(selected);
  };

  chooseButton.addEventListener("click", selectSingleFile);
  emptyChooseButton.addEventListener("click", selectSingleFile);

  chooseManyButton.addEventListener("click", async () => {
    const selected = await window.hwpxOptimizer.selectHwpxMany();
    if (selected && selected.length > 0) enterBatchMode(selected);
  });

  const selectFolder = async () => {
    const result = await window.hwpxOptimizer.selectHwpxFolder();
    if (!result) return;
    if (result.files.length === 0) {
      setStatus(`${result.directory} 안에 HWPX 파일이 없습니다.`);
      return;
    }
    enterBatchMode(result.files);
  };

  chooseFolderButton.addEventListener("click", selectFolder);
  emptyFolderButton.addEventListener("click", selectFolder);

  batchClearButton.addEventListener("click", () => {
    if (state.batchRunning) return;
    state.batchItems = [];
    renderBatchList();
    batchPanel.hidden = true;
    selectedFileCard.hidden = true;
    dropZone.hidden = false;
    singleWorkspace.hidden = false;
    document.body.dataset.view = "empty";
    renderEmptySummary();
    setStatus("배치 목록을 비웠습니다.");
  });

  batchRunButton.addEventListener("click", () => {
    void runBatch();
  });

  analyzeButton.addEventListener("click", async () => {
    if (state.filePath) await analyzeFile(state.filePath);
  });

  outputButton.addEventListener("click", async () => {
    const selected = await window.hwpxOptimizer.selectDirectory();
    if (selected) {
      state.outputDirectory = selected;
      await saveSettings({ saveNextToOriginal: false });
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
  cancelButton.addEventListener("click", async () => {
    if (state.batchRunning) {
      state.batchCancelled = true;
    }
    await window.hwpxOptimizer.cancelOptimize();
    setStatus("최적화를 취소했습니다.");
    setIdle();
  });
  settingsButton.addEventListener("click", () => settingsPanel.classList.toggle("is-open"));
  openFileButton.addEventListener("click", () => state.result && window.hwpxOptimizer.openPath(state.result.outputPath));
  openReportButton.addEventListener(
    "click",
    () => state.result?.reportPath && window.hwpxOptimizer.openPath(state.result.reportPath)
  );
  openFolderButton.addEventListener("click", () => state.result && window.hwpxOptimizer.showItem(state.result.outputPath));
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

  privacyToggle.addEventListener("change", () => {
    state.actionSelections.set("clean-shape-comment", privacyToggle.checked);
    refreshSubmissionPlan();
    refreshBatchPlans();
  });

  settingDefaultMode.addEventListener("change", () => {
    const nextMode = settingDefaultMode.value as AppState["mode"];
    state.mode = nextMode;
    modeInputs.find((input) => input.value === nextMode)?.click();
    void saveSettings({ defaultMode: nextMode });
  });
  settingSaveNext.addEventListener("change", () => void saveSettings({ saveNextToOriginal: settingSaveNext.checked }));
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
      state.outputDirectory = selected;
      await saveSettings({ saveNextToOriginal: false });
      setStatus("이번 실행의 저장 위치를 변경했습니다.");
    }
  });
  settingOutputResetButton.addEventListener("click", async () => {
    state.outputDirectory = undefined;
    await saveSettings({ saveNextToOriginal: true });
    setStatus("원본 문서 폴더에 저장하도록 변경했습니다.");
  });

  dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZone.classList.add("is-over");
  });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("is-over"));
  dropZone.addEventListener("drop", async (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-over");
    const dropped = event.dataTransfer?.files;
    if (!dropped || dropped.length === 0) {
      setStatus("HWPX 파일만 선택할 수 있습니다.");
      return;
    }
    const paths: string[] = [];
    let unresolved = 0;
    let nonHwpx = 0;
    for (const file of Array.from(dropped)) {
      const path = resolveDroppedFilePath(file);
      if (!path) {
        if (file.name.toLowerCase().endsWith(".hwpx")) unresolved += 1;
        else nonHwpx += 1;
        continue;
      }
      if (path.toLowerCase().endsWith(".hwpx")) {
        paths.push(path);
      } else {
        nonHwpx += 1;
      }
    }
    if (paths.length === 0) {
      if (unresolved > 0) {
        setStatus("드롭한 파일의 경로를 확인할 수 없습니다. 파일 선택 버튼을 사용하세요.");
      } else if (nonHwpx > 0) {
        setStatus("HWPX 파일만 선택할 수 있습니다.");
      } else {
        setStatus("처리할 HWPX 파일을 찾지 못했습니다.");
      }
      return;
    }
    if (paths.length === 1) {
      await loadFile(paths[0]);
      return;
    }
    enterBatchMode(paths);
  });

  renderModeWarning();
  renderEmptySummary();
  renderPlanActions();
  window.hwpxOptimizer.onOptimizeProgress((progress) => {
    renderProgress(progress.percent, progress.item);
  });
  document.body.dataset.preloadApi = "ready";
  document.body.dataset.appReady = "true";
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
  settingOutputButton.disabled = settings.saveNextToOriginal;
  settingOutputResetButton.disabled = settings.saveNextToOriginal && !state.outputDirectory;
}

function renderSubmissionControls(): void {
  submissionLimitSelect.value = state.submissionLimit.id;
  customLimitField.hidden = state.submissionLimit.id !== "custom";
  customLimitInput.value = state.submissionLimit.customBytes
    ? String(Math.round(state.submissionLimit.customBytes / 1024 / 1024))
    : "";
  preservationSelect.value = state.preservationPreference;
  privacyToggle.checked = state.actionSelections.get("clean-shape-comment") ?? true;
}

function refreshSubmissionPlan(): void {
  if (!state.report) {
    state.currentPlan = undefined;
    planTitle.textContent = "자동 최적화 계획";
    planSummary.textContent = "파일을 분석하면 예상 절감량을 표시합니다.";
    planTotal.textContent = "예상 절감 0 B";
    actionPanelHint.textContent = "옵션을 바꾸면 사용자 지정 계획으로 전환됩니다.";
    renderPlanActions();
    if (!state.batchItems.length) renderEmptySummary();
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
  planSummary.textContent = `${plan.targetStatusLabel} · 예상 결과 ${plan.expectedSizeLabel}`;
  planTotal.textContent = `예상 절감 ${plan.expectedSavingLabel}`;
  actionPanelHint.textContent =
    plan.mode === "safe"
      ? "외형 보존 우선에서는 안전한 항목만 적용합니다."
      : "옵션을 바꾸면 사용자 지정 계획으로 전환됩니다.";
  renderPlanActions(plan);
  syncActionCheckboxIndeterminateState();
  renderSingleSummary(plan);
  renderModeWarning();
  optimizeButton.disabled = false;
}

function renderPlanActions(plan?: SubmissionPlan): void {
  const rows = plan?.actionRows ?? [];
  type DisplayPlanRow = {
    label: string;
    savingLabel: string;
    kind: string;
    checked?: boolean;
    action?: SubmissionActionId;
    actions?: SubmissionActionId[];
  };
  const fallbackRows: DisplayPlanRow[] = [
    { label: "이미지 용량 최적화", savingLabel: "분석 후 표시", kind: "image" },
    { label: "불필요한 이미지 정보 제거", savingLabel: "분석 후 표시", kind: "metadata" },
    { label: "작성자·편집 흔적 정리", savingLabel: "분석 후 표시", kind: "author" }
  ];
  const displayRows: DisplayPlanRow[] =
    rows.length > 0
      ? rows.slice(0, 3).map((row) => ({
          label: planActionLabel(row.label),
          savingLabel: row.savingLabel,
          kind: planActionKind(row.label),
          checked: row.checked,
          action: row.action,
          actions: row.actions
        }))
      : fallbackRows;
  actionCheckboxes.innerHTML = displayRows
    .map((row) => {
      if (row.action && row.actions) {
        const checkedAttr = row.checked ? " checked" : "";
        const actionsAttr = escapeHtml(row.actions.join(","));
        return `<li class="plan-card plan-${escapeHtml(row.kind)}"><label><input type="checkbox" value="${escapeHtml(
          row.action
        )}" data-actions="${actionsAttr}"${checkedAttr} /><span class="plan-icon" aria-hidden="true"></span><span class="plan-copy"><strong>${escapeHtml(
          row.label
        )}</strong><em>${planActionDescription(row.kind)}</em></span><span class="plan-saving"><small>예상 절감</small><strong>${escapeHtml(
          row.savingLabel
        )}</strong></span></label></li>`;
      }
      return `<li class="plan-card plan-${escapeHtml(row.kind)} is-placeholder"><span class="plan-icon" aria-hidden="true"></span><span class="plan-copy"><strong>${escapeHtml(
        row.label
      )}</strong><em>${planActionDescription(row.kind)}</em></span><span class="plan-saving"><small>예상 절감</small><strong>${escapeHtml(
        row.savingLabel
      )}</strong></span></li>`;
    })
    .join("");
}

function planActionLabel(label: string): string {
  if (label.includes("큰 이미지")) return "이미지 용량 최적화";
  if (label.includes("중복")) return "이미지 용량 최적화";
  if (label.includes("불필요") || label.includes("메타")) return "불필요한 이미지 정보 제거";
  if (label.includes("개인정보") || label.includes("흔적")) return "작성자·편집 흔적 정리";
  return label;
}

function planActionKind(label: string): string {
  const normalized = planActionLabel(label);
  if (normalized.includes("작성자")) return "author";
  if (normalized.includes("불필요")) return "metadata";
  return "image";
}

function planActionDescription(kind: string): string {
  if (kind === "author") return "작성자 정보 및 편집 기록 등 개인 정보를 정리합니다.";
  if (kind === "metadata") return "불필요한 메타데이터 및 숨은 정보를 제거합니다.";
  return "이미지 압축 및 크기 조정으로 파일 용량을 줄입니다.";
}

function renderEmptySummary(): void {
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
  optimizeButton.textContent = "파일을 선택해 분석 시작";
  optimizeButton.disabled = true;
}

function renderSingleSummary(plan: SubmissionPlan): void {
  if (!state.report) return;
  document.body.dataset.view = "single";
  selectionPill.textContent = "단일 파일";
  selectedFileCard.hidden = false;
  dropZone.hidden = true;
  singleOriginalSize.textContent = plan.originalSizeLabel;
  singleExpectedSize.textContent = plan.expectedSizeLabel.replace(/^약 /, "");
  const savingPercent = percentFromPlan(plan);
  singleSavingRing.textContent = `${savingPercent.toFixed(2)}%`;
  summaryOriginal.textContent = plan.originalSizeLabel;
  summaryExpected.textContent = plan.expectedSizeLabel.replace(/^약 /, "");
  summarySaving.textContent = plan.expectedSavingLabel.replace(/^최대 /, "");
  summaryPercent.textContent = `${savingPercent.toFixed(2)}%`;
  summaryStatus.innerHTML = `<span class="success-dot" aria-hidden="true"></span>${singleStatusText(plan)}`;
  summaryResultLine.textContent = `예상 결과: ${plan.expectedSizeLabel.replace(/^약 /, "")}`;
  summaryTargetLine.textContent = `제출 기준: ${targetLabelForDisplay()}`;
  targetTrackFill.style.width = `${progressForPlan(plan)}%`;
  optimizeButton.textContent = "제출 기준에 맞게 줄이기";
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
}

function targetLabelForDisplay(): string {
  const bytes = resolveTargetBytesForDisplay();
  if (!bytes) return "제한 없음";
  return bytes >= 1024 * 1024 ? `${Math.round(bytes / 1024 / 1024)}MB` : formatBytes(bytes);
}

function resolveTargetBytesForDisplay(): number | undefined {
  if (state.currentPlan?.targetBytes) return state.currentPlan.targetBytes;
  if (state.submissionLimit.id === "mb10") return 10 * 1024 * 1024;
  if (state.submissionLimit.id === "mb20") return 20 * 1024 * 1024;
  if (state.submissionLimit.id === "mb50") return 50 * 1024 * 1024;
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
  if (state.batchRunning) {
    setStatus("일괄 처리 중에는 새 파일을 열 수 없습니다. 완료 후 다시 시도하세요.");
    return;
  }
  document.body.dataset.view = "single";
  state.batchItems = [];
  batchPanel.hidden = true;
  state.filePath = path;
  state.report = undefined;
  state.result = undefined;
  state.currentPlan = undefined;
  state.actionSelections.clear();
  singleWorkspace.hidden = false;
  actionPanel.hidden = true;
  actionCheckboxes.innerHTML = "";
  refreshSubmissionPlan();
  resultPanel.hidden = true;
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
  analyzeButton.disabled = false;
  optimizeButton.disabled = true;
  if (looksLikeOptimizedFileName(baseName)) {
    setStatus("이미 최적화된 파일로 보입니다. 추가 절감 효과는 작을 수 있습니다.");
  }
  await analyzeFile(path);
}

async function analyzeFile(path: string): Promise<void> {
  try {
    setBusy("문서를 분석하는 중입니다...", { cancelable: false });
    renderProgress(18, "파일을 불러와 분석을 준비하는 중입니다");
    const response = await window.hwpxOptimizer.analyze(path);
    renderProgress(82, "예상 용량과 제출 기준 충족 여부를 계산하는 중입니다");
    state.report = response.report;
    state.actionSelections.clear();
    renderAnalysis(response.report);
    refreshSubmissionPlan();
    renderProgress(100, "분석 완료");
    setStatus("분석이 완료되었습니다. 최적화 방식을 선택하세요.");
  } catch (error) {
    setStatus(errorMessage(error));
  } finally {
    setIdle();
    hideProgressPanel();
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
    setStatus(errorMessage(error));
  } finally {
    setIdle();
    hideProgressPanel();
    if (!succeeded) renderProgress(0, "");
  }
}

function renderProgress(percent: number, item: string): void {
  progressPanel.hidden = false;
  progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  progressItem.textContent = progressLabel(item);
}

function hideProgressPanel(): void {
  document.body.dataset.busy = "";
  progressPanel.classList.remove("is-loading");
  progressPanel.hidden = true;
}

function renderAnalysis(report: OptimizationReport): void {
  const view = createAnalysisViewModel(report);
  selectedOriginalMeta.textContent = `원본 크기: ${view.originalSizeLabel}`;
  selectedModifiedMeta.textContent = `수정일: ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
  analysisDetailSummary.textContent = `세부 분석 보기 · 예상 절감 ${view.estimatedSavingLabel}`;
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
  resultPanel.hidden = false;
  resultSummary.innerHTML = [
    metricHtml("원본 용량", formatBytes(report.originalSize)),
    metricHtml("결과 용량", formatBytes(report.optimizedSize ?? report.originalSize)),
    metricHtml("실제 절감", formatBytes(report.savedBytes ?? 0)),
    metricHtml("절감률", `${(report.savedPercent ?? 0).toFixed(2)}%`)
  ].join("");
  requireElement("output-path").textContent = `결과 파일: ${fileNameFromPath(outputPath)}`;
  requireElement("report-path").textContent = reportPath
    ? `현재 리포트: ${fileNameFromPath(reportPath)}`
    : "리포트 저장이 꺼져 있습니다.";
  openReportButton.disabled = !reportPath;
  reverifyButton.disabled = false;
  compareButton.disabled = state.mode === "safe";
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
  } catch (error) {
    setStatus(`검증 실패: ${errorMessage(error)}`);
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

function setBusy(message: string, options: { cancelable: boolean }): void {
  setStatus(message);
  document.body.dataset.busy = options.cancelable ? "optimization" : "analysis";
  progressPanel.hidden = false;
  progressPanel.classList.add("is-loading");
  optimizeButton.disabled = true;
  analyzeButton.disabled = true;
  cancelButton.disabled = !options.cancelable;
}

function setIdle(): void {
  analyzeButton.disabled = !state.filePath;
  optimizeButton.disabled = !state.currentPlan;
  cancelButton.disabled = true;
}

function setStatus(message: string): void {
  statusText.textContent = message;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function setAllActionSelections(enabled: boolean): void {
  for (const action of currentPlanActions()) {
    state.actionSelections.set(action, enabled);
  }
}

function currentPlanActions(): SubmissionActionId[] {
  return state.currentPlan?.actionRows.flatMap((row) => row.actions) ?? [];
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
  if (state.batchRunning) return;
  document.body.dataset.view = "batch";
  state.filePath = undefined;
  state.report = undefined;
  state.result = undefined;
  state.currentPlan = undefined;
  state.actionSelections.clear();
  resultPanel.hidden = true;
  actionPanel.hidden = true;
  actionCheckboxes.innerHTML = "";
  singleWorkspace.hidden = false;
  selectedFileCard.hidden = true;
  dropZone.hidden = true;
  refreshSubmissionPlan();
  fileName.textContent = "여러 HWPX 일괄 처리";
  fileMeta.textContent = `${paths.length}개 파일`;
  analyzeButton.disabled = true;
  optimizeButton.disabled = true;

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
  batchPanel.hidden = false;
  renderBatchList();
  renderBatchSummary();
  setStatus(`${state.batchItems.length}개 파일이 일괄 처리 대기 중입니다.`);
  void analyzeBatchItems();
}

function renderBatchList(): void {
  batchSummary.textContent = summarizeBatchItems(state.batchItems, { running: state.batchRunning }).text;
  batchList.innerHTML = state.batchItems
    .map((item, index) => batchItemRowHtml(item, index, { running: state.batchRunning }))
    .join("");
  batchRunButton.disabled =
    state.batchAnalyzing || state.batchRunning || !state.batchItems.some((item) => item.status === "pending");
  batchClearButton.disabled = state.batchAnalyzing || state.batchRunning;
  batchRunButton.textContent = state.batchAnalyzing ? "분석 중..." : state.batchRunning ? "처리 중..." : "일괄 최적화";
  renderBatchSummary();
  batchList.querySelectorAll<HTMLButtonElement>("button[data-action]").forEach((button) => {
    button.addEventListener("click", () => handleBatchRowAction(button));
  });
}

async function analyzeBatchItems(): Promise<void> {
  const pendingItems = state.batchItems.filter((item) => !item.report && item.status === "pending");
  if (pendingItems.length > 0) {
    state.batchAnalyzing = true;
    setBusy("파일 목록을 분석하는 중입니다...", { cancelable: false });
    renderProgress(4, "일괄 분석을 준비하는 중입니다");
    renderBatchList();
  }
  let analyzedCount = 0;
  try {
    for (const item of state.batchItems) {
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
        item.status = "failed";
        item.error = errorMessage(error);
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
    if (state.batchRunning) return;
    state.batchItems.splice(index, 1);
    if (state.batchItems.length === 0) {
      batchPanel.hidden = true;
      dropZone.hidden = false;
      document.body.dataset.view = "empty";
      singleWorkspace.hidden = false;
      renderEmptySummary();
      setStatus("배치 목록을 비웠습니다.");
    }
    renderBatchList();
  }
}

async function runBatch(): Promise<void> {
  if (state.batchRunning || state.batchItems.length === 0) return;
  state.batchRunning = true;
  state.batchCancelled = false;
  setBusy(`${state.batchItems.filter((item) => item.status === "pending").length}개 파일을 처리합니다.`, {
    cancelable: true
  });
  optimizeButton.disabled = true;
  analyzeButton.disabled = true;
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
  cancelButton.disabled = true;
  hideProgressPanel();
  renderBatchList();
  const completed = state.batchItems.filter((item) => item.status === "done").length;
  const failed = state.batchItems.filter((item) => item.status === "failed").length;
  setStatus(`일괄 처리가 끝났습니다. 완료 ${completed}, 실패 ${failed}.`);
}

function selectedActionsForPlan(plan: SubmissionPlan | undefined): string[] | undefined {
  if (!plan || plan.mode === "safe" || plan.kind === "automatic") return undefined;
  return plan.selectedActions;
}

function resolveDroppedFilePath(file: File): string {
  const legacyPath = (file as File & { path?: string }).path;
  if (typeof legacyPath === "string" && legacyPath.length > 0) return legacyPath;
  const api = window.hwpxOptimizer;
  if (typeof api?.getPathForFile === "function") {
    return api.getPathForFile(file);
  }
  return "";
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
