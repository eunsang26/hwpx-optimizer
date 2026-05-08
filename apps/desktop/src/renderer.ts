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
};

const state: AppState = { mode: "safe" };

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
const analysisGrid = requireElement("analysis-grid");
const opportunityList = requireElement("opportunity-list");
const warningList = requireElement("warning-list");
const statusText = requireElement("status-text");
const modeInputs = Array.from(document.querySelectorAll<HTMLInputElement>("input[name='mode']"));
const openFileButton = requireButton("open-file-button");
const openFolderButton = requireButton("open-folder-button");

void init();

async function init(): Promise<void> {
  const settings = await window.hwpxOptimizer.loadSettings();
  state.mode = settings.defaultMode ?? "safe";
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
      setStatus(`Output folder: ${selected}`);
    }
  });

  optimizeButton.addEventListener("click", optimizeCurrentFile);
  settingsButton.addEventListener("click", () => settingsPanel.classList.toggle("is-open"));
  openFileButton.addEventListener("click", () => state.result && window.hwpxOptimizer.openPath(state.result.outputPath));
  openFolderButton.addEventListener("click", () => state.result && window.hwpxOptimizer.showItem(state.result.outputPath));

  for (const input of modeInputs) {
    input.addEventListener("change", () => {
      state.mode = input.value as AppState["mode"];
      void window.hwpxOptimizer.saveSettings({ defaultMode: state.mode });
      renderModeWarning();
    });
  }

  dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZone.classList.add("is-over");
  });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("is-over"));
  dropZone.addEventListener("drop", async (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-over");
    const file = event.dataTransfer?.files.item(0);
    const path = (file as (File & { path?: string }) | null)?.path;
    if (path?.toLowerCase().endsWith(".hwpx")) {
      await loadFile(path);
    } else {
      setStatus("Select an HWPX file.");
    }
  });

  renderModeWarning();
}

async function loadFile(path: string): Promise<void> {
  state.filePath = path;
  state.report = undefined;
  state.result = undefined;
  resultPanel.hidden = true;
  fileName.textContent = path.split(/[\\/]/).pop() ?? path;
  fileMeta.textContent = path;
  analyzeButton.disabled = false;
  optimizeButton.disabled = true;
  await analyzeFile(path);
}

async function analyzeFile(path: string): Promise<void> {
  try {
    setBusy("Analyzing document...");
    const response = await window.hwpxOptimizer.analyze(path);
    state.report = response.report;
    renderAnalysis(response.report);
    optimizeButton.disabled = false;
    setStatus("Analysis ready.");
  } catch (error) {
    setStatus(errorMessage(error));
  } finally {
    setIdle();
  }
}

async function optimizeCurrentFile(): Promise<void> {
  if (!state.filePath || !state.report) return;
  try {
    setBusy(`Optimizing in ${state.mode} mode...`);
    const response = await window.hwpxOptimizer.optimize({
      filePath: state.filePath,
      mode: state.mode,
      outputDirectory: state.outputDirectory
    });
    state.result = response;
    renderResult(response.report, response.outputPath, response.reportPath);
    setStatus("Optimization complete.");
  } catch (error) {
    setStatus(errorMessage(error));
  } finally {
    setIdle();
  }
}

function renderAnalysis(report: OptimizationReport): void {
  const view = createAnalysisViewModel(report);
  analysisGrid.innerHTML = [
    metric("Original", view.originalSizeLabel),
    metric("Images", String(view.imageCount)),
    metric("BMP", String(view.bmpCount)),
    metric("Metadata", String(view.metadataImageCount)),
    metric("Unused", String(view.unusedResourceCount)),
    metric("Duplicates", String(view.duplicateGroupCount)),
    metric("Risk", String(view.riskyResourceCount)),
    metric("Potential", view.estimatedSavingLabel)
  ].join("");

  opportunityList.innerHTML =
    view.topOpportunities.length === 0
      ? "<li>No optimization opportunities detected.</li>"
      : view.topOpportunities
          .map((item) => `<li><span>${item.action}</span><strong>${item.savingLabel}</strong><em>${item.count}</em></li>`)
          .join("");

  warningList.innerHTML =
    view.warnings.length === 0
      ? "<li>No warnings.</li>"
      : view.warnings.slice(0, 8).map((warning) => `<li>${escapeHtml(warning)}</li>`).join("");
}

function renderResult(report: OptimizationReport, outputPath: string, reportPath?: string): void {
  resultPanel.hidden = false;
  resultSummary.innerHTML = [
    metric("Output", formatBytes(report.optimizedSize ?? report.originalSize)),
    metric("Saved", formatBytes(report.savedBytes ?? 0)),
    metric("Rate", `${(report.savedPercent ?? 0).toFixed(2)}%`),
    metric("Actions", String(report.actions.applied.length))
  ].join("");
  requireElement("output-path").textContent = outputPath;
  requireElement("report-path").textContent = reportPath ?? "Report disabled";
}

function renderModeWarning(): void {
  const warning = requireElement("mode-warning");
  warning.textContent =
    state.mode === "aggressive"
      ? "Aggressive mode may introduce visible image quality differences."
      : state.mode === "balanced"
        ? "Balanced mode can convert or resize images when the document display size allows it."
        : "Safe mode avoids visible-layout changes.";
}

function metric(label: string, value: string): string {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function setBusy(message: string): void {
  setStatus(message);
  optimizeButton.disabled = true;
  analyzeButton.disabled = true;
}

function setIdle(): void {
  analyzeButton.disabled = !state.filePath;
  optimizeButton.disabled = !state.report;
}

function setStatus(message: string): void {
  statusText.textContent = message;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
