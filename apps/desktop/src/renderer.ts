import { createAnalysisViewModel, formatBytes } from "./shared/viewModel.js";
import type { OptimizationReport } from "@hwpx-optimizer/core";
import type { HwpxOptimizerApi } from "./preload.js";

declare global {
  interface Window {
    hwpxOptimizer: HwpxOptimizerApi;
  }
}

type AppState = {
  filePath?: string;
  report?: OptimizationReport;
  result?: { outputPath: string; reportPath?: string; report: OptimizationReport };
  mode: "safe" | "balanced" | "aggressive";
  outputDirectory?: string;
  settings?: DesktopSettings;
};

const state: AppState = { mode: "safe" };

type DesktopSettings = {
  defaultMode: AppState["mode"];
  saveNextToOriginal: boolean;
  saveReport: boolean;
  preventOverwrite: boolean;
  showAggressiveWarning: boolean;
  outputDirectory?: string;
};

const dropZone = requireElement("drop-zone");
const fileName = requireElement("file-name");
const fileMeta = requireElement("file-meta");
const analyzeButton = requireButton("analyze-button");
const chooseButton = requireButton("choose-button");
const optimizeButton = requireButton("optimize-button");
const outputButton = requireButton("output-button");
const settingsButton = requireButton("settings-button");
const settingsPanel = requireElement("settings-panel");
const resultPanel = requireElement("result-panel");
const resultSummary = requireElement("result-summary");
const progressPanel = requireElement("progress-panel");
const progressBar = requireElement("progress-bar");
const progressItem = requireElement("progress-item");
const analysisGrid = requireElement("analysis-grid");
const opportunityList = requireElement("opportunity-list");
const warningList = requireElement("warning-list");
const statusText = requireElement("status-text");
const modeInputs = Array.from(document.querySelectorAll<HTMLInputElement>("input[name='mode']"));
const openFileButton = requireButton("open-file-button");
const openReportButton = requireButton("open-report-button");
const openFolderButton = requireButton("open-folder-button");
const cancelButton = requireButton("cancel-button");
const settingDefaultMode = requireSelect("setting-default-mode");
const settingSaveNext = requireInput("setting-save-next");
const settingSaveReport = requireInput("setting-save-report");
const settingPreventOverwrite = requireInput("setting-prevent-overwrite");
const settingAggressiveWarning = requireInput("setting-aggressive-warning");
const settingOutputDirectory = requireElement("setting-output-directory");
const settingOutputButton = requireButton("setting-output-button");
const settingOutputResetButton = requireButton("setting-output-reset-button");

void init();

async function init(): Promise<void> {
  const settings = (await window.hwpxOptimizer.loadSettings()) as DesktopSettings;
  state.settings = settings;
  state.mode = settings.defaultMode ?? "safe";
  state.outputDirectory = settings.outputDirectory;
  renderSettings(settings);
  modeInputs.find((input) => input.value === state.mode)?.click();

  chooseButton.addEventListener("click", async () => {
    const selected = await window.hwpxOptimizer.selectHwpx();
    if (selected) await loadFile(selected);
  });

  analyzeButton.addEventListener("click", async () => {
    if (state.filePath) await analyzeFile(state.filePath);
  });

  outputButton.addEventListener("click", async () => {
    const selected = await window.hwpxOptimizer.selectDirectory();
    if (selected) {
      state.outputDirectory = selected;
      await saveSettings({ outputDirectory: selected, saveNextToOriginal: false });
      setStatus(`저장 위치를 변경했습니다: ${selected}`);
    }
  });

  optimizeButton.addEventListener("click", optimizeCurrentFile);
  cancelButton.addEventListener("click", async () => {
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

  for (const input of modeInputs) {
    input.addEventListener("change", () => {
      state.mode = input.value as AppState["mode"];
      void saveSettings({ defaultMode: state.mode });
      renderModeWarning();
    });
  }

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
      await saveSettings({ outputDirectory: selected, saveNextToOriginal: false });
      setStatus(`저장 위치를 변경했습니다: ${selected}`);
    }
  });
  settingOutputResetButton.addEventListener("click", async () => {
    state.outputDirectory = undefined;
    await saveSettings({ outputDirectory: undefined, saveNextToOriginal: true });
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
    const file = event.dataTransfer?.files.item(0);
    if (!file) {
      setStatus("HWPX 파일만 선택할 수 있습니다.");
      return;
    }
    const path = resolveDroppedFilePath(file);
    if (path && path.toLowerCase().endsWith(".hwpx")) {
      await loadFile(path);
      return;
    }
    if (file.name.toLowerCase().endsWith(".hwpx")) {
      setStatus("드롭한 파일의 경로를 확인할 수 없습니다. 파일 선택 버튼을 사용하세요.");
      return;
    }
    setStatus("HWPX 파일만 선택할 수 있습니다.");
  });

  renderModeWarning();
  window.hwpxOptimizer.onOptimizeProgress((progress) => {
    renderProgress(progress.percent, progress.item);
  });
  document.body.dataset.preloadApi = "ready";
  document.body.dataset.appReady = "true";
}

async function saveSettings(patch: Partial<DesktopSettings>): Promise<void> {
  const settings = (await window.hwpxOptimizer.saveSettings(patch)) as DesktopSettings;
  state.settings = settings;
  state.outputDirectory = settings.outputDirectory;
  renderSettings(settings);
}

function renderSettings(settings: DesktopSettings): void {
  settingDefaultMode.value = settings.defaultMode;
  settingSaveNext.checked = settings.saveNextToOriginal;
  settingSaveReport.checked = settings.saveReport;
  settingPreventOverwrite.checked = settings.preventOverwrite;
  settingAggressiveWarning.checked = settings.showAggressiveWarning;
  const usingOriginal = settings.saveNextToOriginal || !settings.outputDirectory;
  settingOutputDirectory.textContent = usingOriginal
    ? "저장 위치: 원본 문서 폴더"
    : `저장 위치: ${settings.outputDirectory}`;
  settingOutputButton.disabled = settings.saveNextToOriginal;
  settingOutputResetButton.disabled = settings.saveNextToOriginal && !settings.outputDirectory;
}

async function loadFile(path: string): Promise<void> {
  state.filePath = path;
  state.report = undefined;
  state.result = undefined;
  resultPanel.hidden = true;
  const baseName = path.split(/[\\/]/).pop() ?? path;
  fileName.textContent = baseName;
  fileMeta.textContent = path;
  analyzeButton.disabled = false;
  optimizeButton.disabled = true;
  if (looksLikeOptimizedFileName(baseName)) {
    setStatus("이미 최적화된 파일로 보입니다. 추가 절감 효과는 작을 수 있습니다.");
  }
  await analyzeFile(path);
}

function looksLikeOptimizedFileName(name: string): boolean {
  return /\.optimized(?:-\d+)?\.hwpx$/i.test(name);
}

async function analyzeFile(path: string): Promise<void> {
  try {
    setBusy("문서를 분석하는 중입니다...");
    const response = await window.hwpxOptimizer.analyze(path);
    state.report = response.report;
    renderAnalysis(response.report);
    optimizeButton.disabled = false;
    setStatus("분석이 완료되었습니다. 최적화 방식을 선택하세요.");
  } catch (error) {
    setStatus(errorMessage(error));
  } finally {
    setIdle();
  }
}

async function optimizeCurrentFile(): Promise<void> {
  if (!state.filePath || !state.report) return;
  try {
    setBusy(`${modeLabel(state.mode)} 모드로 최적화하는 중입니다...`);
    progressPanel.hidden = false;
    renderProgress(5, "최적화를 준비하는 중입니다");
    const response = await window.hwpxOptimizer.optimize({
      filePath: state.filePath,
      mode: state.mode,
      outputDirectory: state.outputDirectory
    });
    state.result = response;
    renderResult(response.report, response.outputPath, response.reportPath);
    setStatus("최적화가 완료되었습니다. 결과 파일을 확인하세요.");
  } catch (error) {
    setStatus(errorMessage(error));
  } finally {
    setIdle();
  }
}

function renderProgress(percent: number, item: string): void {
  progressPanel.hidden = false;
  progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  progressItem.textContent = progressLabel(item);
}

function renderAnalysis(report: OptimizationReport): void {
  const view = createAnalysisViewModel(report);
  analysisGrid.innerHTML = [
    metric("원본 용량", view.originalSizeLabel),
    metric("이미지", String(view.imageCount)),
    metric("BMP 후보", String(view.bmpCount)),
    metric("메타데이터", String(view.metadataImageCount)),
    metric("미사용 리소스", String(view.unusedResourceCount)),
    metric("중복 이미지", String(view.duplicateGroupCount)),
    metric("주의 리소스", String(view.riskyResourceCount)),
    metric("예상 절감", view.estimatedSavingLabel)
  ].join("");

  opportunityList.innerHTML =
    view.topOpportunities.length === 0
      ? "<li class=\"empty\">뚜렷한 최적화 후보가 없습니다.</li>"
      : view.topOpportunities
          .map(
            (item) =>
              `<li><span>${actionLabel(item.action)}</span><strong>${item.savingLabel}</strong><em>${item.count}개</em></li>`
          )
          .join("");

  warningList.innerHTML =
    view.warnings.length === 0
      ? "<li class=\"empty\">현재 표시할 주의사항이 없습니다.</li>"
      : view.warnings.slice(0, 8).map((warning) => `<li>${escapeHtml(warningLabel(warning))}</li>`).join("");
}

function renderResult(report: OptimizationReport, outputPath: string, reportPath?: string): void {
  resultPanel.hidden = false;
  resultSummary.innerHTML = [
    metric("결과 용량", formatBytes(report.optimizedSize ?? report.originalSize)),
    metric("절감 용량", formatBytes(report.savedBytes ?? 0)),
    metric("절감률", `${(report.savedPercent ?? 0).toFixed(2)}%`),
    metric("수행 작업", `${report.actions.applied.length}개`)
  ].join("");
  requireElement("output-path").textContent = outputPath;
  requireElement("report-path").textContent = reportPath ?? "리포트 저장이 꺼져 있습니다.";
  openReportButton.disabled = !reportPath;
}

function renderModeWarning(): void {
  const warning = requireElement("mode-warning");
  warning.textContent =
    state.mode === "aggressive" && state.settings?.showAggressiveWarning !== false
      ? "최대 압축은 이미지 품질 차이가 보일 수 있습니다."
      : state.mode === "balanced"
        ? "균형 모드는 표시 크기를 기준으로 큰 이미지와 BMP를 줄입니다."
        : "안전 모드는 문서 외형 변화 가능성이 낮은 작업만 수행합니다.";
}

function modeLabel(mode: AppState["mode"]): string {
  if (mode === "safe") return "안전";
  if (mode === "balanced") return "균형";
  return "최대 압축";
}

function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    "remove-exif": "이미지 메타데이터 제거",
    "compress-image": "이미지 무손실 최적화",
    "optimize-png": "PNG 무손실 최적화",
    "resize-jpeg": "큰 JPEG 리사이즈",
    "resize-png": "큰 PNG 리사이즈",
    "convert-bmp-to-png": "BMP를 PNG로 변환",
    "remove-unused": "미사용 리소스 제거",
    "minify-xml": "문서 XML 정리",
    "repack-zip": "HWPX 재압축",
    "clean-shape-comment": "이미지 설명 메타데이터 정리",
    "consolidate-duplicate-images": "중복 이미지 참조 정리"
  };
  return labels[action] ?? action;
}

function progressLabel(item: string): string {
  const labels: Record<string, string> = {
    "Reading HWPX package": "HWPX 문서 구조를 읽는 중입니다",
    "Writing optimized document": "최적화된 문서를 저장하는 중입니다",
    "Writing JSON report": "JSON 리포트를 저장하는 중입니다",
    "Verifying optimized document": "결과 문서를 검증하는 중입니다",
    "Optimization complete": "최적화가 완료되었습니다",
    "Optimization cancelled": "최적화가 취소되었습니다"
  };
  if (item.startsWith("Optimizing document in ")) {
    const mode = item.includes("aggressive") ? "최대 압축" : item.includes("balanced") ? "균형" : "안전";
    return `${mode} 모드로 문서를 최적화하는 중입니다`;
  }
  return labels[item] ?? item;
}

function warningLabel(warning: string): string {
  const labels: Array<[RegExp, string]> = [
    [/OLE objects can be user-visible/i, "OLE 객체는 문서에서 보일 수 있어 자동으로 제거하지 않습니다."],
    [/Safe mode did not produce a smaller file/i, "안전 모드에서 더 작은 결과가 나오지 않아 원본 바이트를 유지했습니다."],
    [/Balanced mode did not produce a smaller file/i, "균형 모드에서 더 작은 결과가 나오지 않아 원본 바이트를 유지했습니다."],
    [/Aggressive mode did not produce a smaller file/i, "최대 압축 모드에서 더 작은 결과가 나오지 않아 원본 바이트를 유지했습니다."],
    [/may introduce visible image quality differences/i, "최대 압축은 이미지 품질 차이가 보일 수 있습니다."]
  ];
  return labels.find(([pattern]) => pattern.test(warning))?.[1] ?? warning;
}

function metric(label: string, value: string): string {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function setBusy(message: string): void {
  setStatus(message);
  optimizeButton.disabled = true;
  analyzeButton.disabled = true;
  cancelButton.disabled = false;
}

function setIdle(): void {
  analyzeButton.disabled = !state.filePath;
  optimizeButton.disabled = !state.report;
  cancelButton.disabled = true;
}

function setStatus(message: string): void {
  statusText.textContent = message;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return entities[char] ?? char;
  });
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
