import type { BrowserWindow as BrowserWindowInstance, OpenDialogOptions } from "electron";
type BrowserWindow = BrowserWindowInstance;
type ElectronApi = typeof import("electron");

const electronApi = (globalThis as { __hwpxOptimizerElectron?: ElectronApi }).__hwpxOptimizerElectron;
if (!electronApi) {
  throw new Error("Electron API bridge was not initialized.");
}

const { app, BrowserWindow: BrowserWindowClass, dialog, ipcMain, shell, session, Menu } = electronApi;
import { mkdir, readFile as readFileFs, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import {
  normalizeDesktopSettings,
  persistentDesktopSettingsPatch,
  previewImageDiffs,
  verifyDesktopFile,
  writeDesktopBatchReport
} from "./main/desktopService.js";
import type { DesktopAnalysisResult, DesktopOptimizeResult } from "./main/desktopService.js";
import type { DesktopSettings, DesktopSettingsPatch, OptimizationMode } from "./main/desktopService.js";

let mainWindow: BrowserWindow | null = null;
let documentWorker: Worker | null = null;
let activeAnalyzeWorker: Worker | null = null;
let activeOptimizeWorker: Worker | null = null;
let pendingDocumentOperation: "analyze" | "optimize" | null = null;
let nextWorkerRequestId = 1;
const pendingWorkerRequests = new Map<
  number,
  {
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
    onProgress?: (progress: { percent: number; item: string }) => void;
  }
>();
const allowedInputPaths = new Set<string>();
const allowedOutputDirectories = new Set<string>();
const allowedGeneratedPaths = new Set<string>();
const isSmokeTest = process.argv.includes("--smoke-test");
if (isSmokeTest) {
  app.setPath("userData", join(process.cwd(), ".tmp", "electron-smoke"));
}
if (process.platform === "win32") {
  app.setAppUserModelId("local.hwpxoptimizer.app");
}

async function createWindow(): Promise<BrowserWindow> {
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindowClass({
    width: 1120,
    height: 820,
    minWidth: 960,
    minHeight: 720,
    useContentSize: true,
    show: !isSmokeTest,
    title: "HWPX 보고서 용량 최적화",
    icon: join(import.meta.dirname, "app-icon.png"),
    autoHideMenuBar: true,
    backgroundColor: "#f6f8fb",
    webPreferences: {
      preload: join(import.meta.dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event: Electron.Event) => {
    event.preventDefault();
  });

  await mainWindow.loadFile(join(import.meta.dirname, "index.html"));
  return mainWindow;
}

app.whenReady()
  .then(async () => {
    blockExternalNetworkRequests();
    registerIpc();
    const window = await createWindow();
    if (!isSmokeTest) void warmDocumentWorker();

    if (isSmokeTest) {
      await runSmokeAssertions(window);
      app.quit();
      return;
    }

    app.on("activate", async () => {
      if (BrowserWindowClass.getAllWindows().length === 0) {
        await createWindow();
      }
    });
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    app.exit(1);
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  void documentWorker?.terminate();
  documentWorker = null;
});

function registerIpc(): void {
  ipcMain.handle("dialog:select-hwpx", async () => {
    const options: OpenDialogOptions = {
      properties: ["openFile"],
      filters: [{ name: "HWPX 문서", extensions: ["hwpx"] }]
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    if (result.canceled) return null;
    const selected = result.filePaths[0] ?? null;
    if (selected) await registerAllowedInputPath(selected);
    return selected;
  });

  ipcMain.handle("dialog:select-hwpx-many", async () => {
    const options: OpenDialogOptions = {
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "HWPX 문서", extensions: ["hwpx"] }]
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    if (result.canceled) return null;
    for (const filePath of result.filePaths) {
      await registerAllowedInputPath(filePath);
    }
    return result.filePaths;
  });

  ipcMain.handle("dialog:select-hwpx-folder", async () => {
    const options: OpenDialogOptions = { properties: ["openDirectory"] };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    const directory = result.filePaths[0];
    await registerAllowedOutputDirectory(directory);
    const entries = await readdir(directory, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && /\.hwpx$/i.test(entry.name))
      .map((entry) => join(directory, entry.name))
      .sort();
    for (const filePath of files) {
      await registerAllowedInputPath(filePath);
    }
    return { directory, files };
  });

  ipcMain.handle("dialog:select-directory", async () => {
    const options: OpenDialogOptions = {
      properties: ["openDirectory"]
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    if (result.canceled) return null;
    const selected = result.filePaths[0] ?? null;
    if (selected) await registerAllowedOutputDirectory(selected);
    return selected;
  });

  ipcMain.handle("settings:load", loadSettings);
  ipcMain.handle("settings:save", async (_event, patch: DesktopSettingsPatch) => saveSettings(patch));

  ipcMain.handle("hwpx:register-dropped-paths", async (_event, paths: unknown) => {
    if (!Array.isArray(paths)) {
      throw new Error("드롭한 파일 경로가 올바르지 않습니다.");
    }
    const registered: string[] = [];
    for (const filePath of paths) {
      if (typeof filePath !== "string") continue;
      registered.push(await registerAllowedInputPath(filePath));
    }
    return registered;
  });

  ipcMain.handle("hwpx:analyze", async (_event, filePath: string) => {
    if (pendingDocumentOperation || activeAnalyzeWorker || activeOptimizeWorker) {
      throw new Error("Another analysis is already running.");
    }
    pendingDocumentOperation = "analyze";
    try {
      const allowedPath = await requireAllowedInputPath(filePath);
      return await runAnalyzeWorker(allowedPath);
    } finally {
      if (pendingDocumentOperation === "analyze") pendingDocumentOperation = null;
    }
  });

  ipcMain.handle(
    "hwpx:optimize",
    async (
      _event,
      input: {
        filePath: string;
        mode: OptimizationMode;
        outputDirectory?: string;
        outputMode?: "single" | "batch";
        actions?: string[];
      }
    ) => {
      if (pendingDocumentOperation || activeAnalyzeWorker || activeOptimizeWorker) {
        throw new Error("Another optimization is already running.");
      }
      pendingDocumentOperation = "optimize";
      try {
        const filePath = await requireAllowedInputPath(input.filePath);
        const outputDirectory = input.outputDirectory
          ? await requireAllowedOutputDirectory(input.outputDirectory)
          : undefined;
        const settings = await loadSettings();
        const effectiveSettings = outputDirectory ? { ...settings, saveNextToOriginal: false } : settings;
        const result = await runOptimizeWorker({ ...input, filePath, outputDirectory, settings: effectiveSettings }, (progress) => {
          mainWindow?.webContents.send("hwpx:optimize-progress", progress);
        });
        await registerGeneratedPath(result.outputPath);
        if (result.reportPath) await registerGeneratedPath(result.reportPath);
        return result;
      } finally {
        if (pendingDocumentOperation === "optimize") pendingDocumentOperation = null;
      }
    }
  );

  ipcMain.handle("hwpx:cancel-optimize", async () => {
    const worker = activeOptimizeWorker;
    if (!worker) return { cancelled: false };
    await worker.terminate();
    mainWindow?.webContents.send("hwpx:optimize-progress", { percent: 0, item: "Optimization cancelled" });
    return { cancelled: true };
  });

  ipcMain.handle("hwpx:cancel-analyze", async () => {
    const worker = activeAnalyzeWorker;
    if (!worker) return { cancelled: false };
    await worker.terminate();
    return { cancelled: true };
  });

  ipcMain.handle("hwpx:verify", async (_event, filePath: string) => verifyDesktopFile(await requireKnownDocumentPath(filePath)));

  ipcMain.handle(
    "hwpx:save-batch-report",
    async (
      _event,
      input: {
        firstInputPath: string;
        outputDirectory?: string;
        mode: OptimizationMode;
        items: Array<{
          input: string;
          status: "done" | "failed" | "cancelled";
          output?: string;
          report?: string;
          error?: string;
          originalSize?: number;
          optimizedSize?: number;
          savedBytes?: number;
          savedPercent?: number;
        }>;
      }
    ) => {
      const firstInputPath = await requireAllowedInputPath(input.firstInputPath);
      const outputDirectory = input.outputDirectory
        ? await requireAllowedOutputDirectory(input.outputDirectory)
        : dirname(firstInputPath);
      const settings = await loadSettings();
      const items = [];
      for (const item of input.items) {
        const output = item.output ? await requireGeneratedPath(item.output) : undefined;
        const report = item.report ? await requireGeneratedPath(item.report) : undefined;
        items.push({ ...item, output, report });
      }
      const result = await writeDesktopBatchReport({
        reportDirectory: join(outputDirectory, "output"),
        mode: input.mode,
        settings,
        items
      });
      await registerGeneratedPath(result.reportPath);
      return result;
    }
  );

  ipcMain.handle(
    "hwpx:image-preview",
    async (_event, input: { originalPath: string; optimizedPath: string; maxItems?: number; maxInputBytes?: number }) =>
      previewImageDiffs(await requireAllowedInputPath(input.originalPath), await requireGeneratedPath(input.optimizedPath), {
        maxItems: input.maxItems,
        maxInputBytes: input.maxInputBytes
      })
  );

  ipcMain.handle("shell:show-item", async (_event, filePath: string) => {
    shell.showItemInFolder(await requireGeneratedPath(filePath));
  });

  ipcMain.handle("shell:open-path", async (_event, filePath: string) => shell.openPath(await requireGeneratedPath(filePath)));
}

async function loadSettings(): Promise<DesktopSettings> {
  try {
    const raw = await readFileFs(settingsPath(), "utf8");
    const parsed = JSON.parse(raw) as DesktopSettingsPatch;
    return normalizeDesktopSettings({
      ...persistentDesktopSettingsPatch(parsed),
      settingsVersion: typeof parsed.settingsVersion === "number" ? parsed.settingsVersion : undefined
    });
  } catch {
    return normalizeDesktopSettings(undefined);
  }
}

async function saveSettings(patch: DesktopSettingsPatch): Promise<DesktopSettings> {
  const current = await loadSettings();
  const next = { ...current, ...persistentDesktopSettingsPatch(patch) };
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(settingsPath(), JSON.stringify(next, null, 2));
  return next;
}

function settingsPath(): string {
  return join(app.getPath("userData"), "settings.json");
}

function blockExternalNetworkRequests(): void {
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
    (_details, callback) => callback({ cancel: true })
  );
}

async function registerAllowedInputPath(filePath: string): Promise<string> {
  const normalized = await normalizeExistingFilePath(filePath);
  if (!/\.hwpx$/i.test(normalized)) {
    throw new Error("HWPX 파일만 선택할 수 있습니다.");
  }
  allowedInputPaths.add(normalized);
  allowedOutputDirectories.add(await normalizeExistingDirectoryPath(dirname(normalized)));
  return normalized;
}

async function registerAllowedOutputDirectory(directoryPath: string): Promise<string> {
  const normalized = await normalizeExistingDirectoryPath(directoryPath);
  allowedOutputDirectories.add(normalized);
  return normalized;
}

async function registerGeneratedPath(filePath: string): Promise<string> {
  const normalized = await normalizeExistingFilePath(filePath);
  allowedGeneratedPaths.add(normalized);
  return normalized;
}

async function requireAllowedInputPath(filePath: string): Promise<string> {
  const normalized = await normalizeExistingFilePath(filePath);
  if (!allowedInputPaths.has(normalized)) throw new Error("선택된 HWPX 파일만 처리할 수 있습니다.");
  return normalized;
}

async function requireAllowedOutputDirectory(directoryPath: string): Promise<string> {
  const normalized = await normalizeExistingDirectoryPath(directoryPath);
  if (!allowedOutputDirectories.has(normalized)) throw new Error("선택된 저장 위치만 사용할 수 있습니다.");
  return normalized;
}

async function requireGeneratedPath(filePath: string): Promise<string> {
  const normalized = await normalizeExistingFilePath(filePath);
  if (!allowedGeneratedPaths.has(normalized)) throw new Error("이번 실행에서 생성된 결과 파일만 열 수 있습니다.");
  return normalized;
}

async function requireKnownDocumentPath(filePath: string): Promise<string> {
  const normalized = await normalizeExistingFilePath(filePath);
  if (!allowedInputPaths.has(normalized) && !allowedGeneratedPaths.has(normalized)) {
    throw new Error("이번 실행에서 선택 또는 생성된 문서만 검증할 수 있습니다.");
  }
  return normalized;
}

async function normalizeExistingFilePath(filePath: string): Promise<string> {
  if (typeof filePath !== "string" || filePath.trim().length === 0) {
    throw new Error("유효한 파일 경로가 아닙니다.");
  }
  const normalized = await realpath(resolve(filePath));
  const info = await stat(normalized);
  if (!info.isFile()) throw new Error("유효한 파일 경로가 아닙니다.");
  return normalized;
}

async function normalizeExistingDirectoryPath(directoryPath: string): Promise<string> {
  if (typeof directoryPath !== "string" || directoryPath.trim().length === 0) {
    throw new Error("유효한 폴더 경로가 아닙니다.");
  }
  const normalized = await realpath(resolve(directoryPath));
  const info = await stat(normalized);
  if (!info.isDirectory()) throw new Error("유효한 폴더 경로가 아닙니다.");
  return normalized;
}

async function runSmokeAssertions(window: BrowserWindow): Promise<void> {
  const smokeDir = join(app.getPath("userData"), "smoke-workspace");
  await rm(smokeDir, { recursive: true, force: true });
  await mkdir(smokeDir, { recursive: true });
  const smokeInputPath = join(smokeDir, "smoke.hwpx");
  const smokeSecondInputPath = join(smokeDir, "smoke-second.hwpx");
  const smokeSourcePath = process.env.HWPX_OPT_SMOKE_INPUT;
  const smokeMode = parseSmokeMode(process.env.HWPX_OPT_SMOKE_MODE);
  await writeFile(
    smokeInputPath,
    smokeSourcePath ? await readFileFs(resolve(smokeSourcePath)) : await createSmokeHwpxFixture()
  );
  await writeFile(smokeSecondInputPath, await createSmokeHwpxFixture());
  await registerAllowedInputPath(smokeInputPath);
  await registerAllowedInputPath(smokeSecondInputPath);
  await registerAllowedOutputDirectory(smokeDir);

  const result = (await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      let attempts = 0;
      const poll = () => {
        attempts += 1;
        if (document.body.dataset.appReady === "true" || attempts > 50) {
          document.getElementById("settings-button")?.click();
          resolve({
            title: document.title,
            fileName: document.getElementById("file-name")?.textContent,
            safetyText: document.getElementById("safety-text")?.textContent,
            appReady: document.body.dataset.appReady,
            preloadApi: document.body.dataset.preloadApi,
            settingsOpen: document.getElementById("settings-panel")?.classList.contains("is-open"),
            settingsOutputButton: document.getElementById("setting-output-button")?.textContent,
            settingsOutputResetButton: document.getElementById("setting-output-reset-button")?.textContent
          });
          return;
        }
        setTimeout(poll, 50);
      };
      poll();
    })
  `)) as {
    title?: string;
    fileName?: string;
    safetyText?: string;
    appReady?: string;
    preloadApi?: string;
    settingsOpen?: boolean;
    settingsOutputButton?: string;
    settingsOutputResetButton?: string;
  };

  if (result.title !== "HWPX 보고서 용량 최적화") {
    throw new Error(`Desktop smoke failed: unexpected title ${String(result.title)}`);
  }
  if (result.fileName !== "HWPX 파일 가져오기") {
    throw new Error(`Desktop smoke failed: renderer did not load expected start view`);
  }
  if (!result.safetyText?.includes("보안 문서")) {
    throw new Error(`Desktop smoke failed: local security policy text is missing`);
  }
  if (result.appReady !== "true" || result.preloadApi !== "ready") {
    throw new Error(`Desktop smoke failed: renderer/preload init did not complete`);
  }
  if (
    result.settingsOpen !== true ||
    result.settingsOutputButton !== "폴더 선택" ||
    result.settingsOutputResetButton !== "원본 폴더 사용"
  ) {
    throw new Error("Desktop smoke failed: settings output folder controls did not render");
  }

  const layout = (await window.webContents.executeJavaScript(`
    (() => {
      document.getElementById("settings-close-button")?.click();
      document.getElementById("help-button")?.click();
      const workspace = document.getElementById("single-workspace");
      const details = document.getElementById("analysis-details");
      const safeLine = document.querySelector(".safe-line");
      const helpPanel = document.getElementById("help-panel");
      const detailsWidth = details?.getBoundingClientRect().width ?? 0;
      const safeLineWidth = safeLine?.getBoundingClientRect().width ?? 0;
      return {
        detailsInsideWorkspace: workspace?.contains(details) ?? false,
        detailsWidth,
        safeLineWidth,
        widthDelta: Math.abs(detailsWidth - safeLineWidth),
        helpOpen: helpPanel?.classList.contains("is-open") ?? false,
        helpTitle: document.getElementById("help-title")?.textContent,
        manualStepCount: document.querySelectorAll(".manual-steps li").length
      };
    })()
  `)) as {
    detailsInsideWorkspace?: boolean;
    detailsWidth?: number;
    safeLineWidth?: number;
    widthDelta?: number;
    helpOpen?: boolean;
    helpTitle?: string;
    manualStepCount?: number;
  };

  if (layout.detailsInsideWorkspace !== true) {
    throw new Error("Desktop smoke failed: analysis details are outside the primary workspace");
  }
  if (!layout.detailsWidth || !layout.safeLineWidth || (layout.widthDelta ?? Number.POSITIVE_INFINITY) > 1) {
    throw new Error(
      `Desktop smoke failed: analysis details width ${String(layout.detailsWidth)} does not match workspace width ${String(layout.safeLineWidth)}`
    );
  }
  if (layout.helpOpen !== true || layout.helpTitle !== "사용 매뉴얼" || layout.manualStepCount !== 9) {
    throw new Error("Desktop smoke failed: manual-style help panel did not render");
  }

  const dragUi = (await window.webContents.executeJavaScript(`
    (() => {
      document.getElementById("help-close-button")?.click();
      const dragEnter = new DragEvent("dragenter", { bubbles: true, cancelable: true });
      document.dispatchEvent(dragEnter);
      const overlay = document.getElementById("drop-overlay");
      const active = document.body.dataset.dragOver === "true";
      const overlayVisible = overlay?.hidden === false;
      const overlayText = overlay?.textContent ?? "";
      const drop = new DragEvent("drop", { bubbles: true, cancelable: true });
      document.dispatchEvent(drop);
      return {
        active,
        overlayVisible,
        overlayText,
        statusBannerExists: Boolean(document.getElementById("status-banner")),
        hasSubmission41Preset: Boolean(document.querySelector("#submission-limit-select option[value='mb41']")),
        batchResultDetailsExists: Boolean(document.getElementById("batch-result-details")),
        cleared: document.body.dataset.dragOver !== "true" && overlay?.hidden === true
      };
    })()
  `)) as {
    active?: boolean;
    overlayVisible?: boolean;
    overlayText?: string;
    statusBannerExists?: boolean;
    hasSubmission41Preset?: boolean;
    batchResultDetailsExists?: boolean;
    cleared?: boolean;
  };

  if (
    dragUi.active !== true ||
    dragUi.overlayVisible !== true ||
    !dragUi.overlayText?.includes("HWPX 파일을 여기에 놓으세요") ||
    dragUi.statusBannerExists !== true ||
    dragUi.hasSubmission41Preset !== true ||
    dragUi.batchResultDetailsExists !== true ||
    dragUi.cleared !== true
  ) {
    throw new Error("Desktop smoke failed: full-window drag overlay did not respond to drag/drop events");
  }

  const workflow = (await window.webContents.executeJavaScript(`
    (async () => {
      const progress = [];
      const unsubscribe = window.hwpxOptimizer.onOptimizeProgress((item) => progress.push(item));
      const saved = await window.hwpxOptimizer.saveSettings({ outputDirectory: ${JSON.stringify(smokeDir)} });
      const analysis = await window.hwpxOptimizer.analyze(${JSON.stringify(smokeInputPath)});
      const result = await window.hwpxOptimizer.optimize({
        filePath: ${JSON.stringify(smokeInputPath)},
        mode: ${JSON.stringify(smokeMode)},
        outputDirectory: ${JSON.stringify(smokeDir)}
      });
      const verification = await window.hwpxOptimizer.verify(result.outputPath);
      unsubscribe();
      return {
        originalSize: analysis.report.originalSize,
        outputPath: result.outputPath,
        reportPath: result.reportPath,
        verified: verification.ok,
        progressCount: progress.length,
        savedOutputDirectory: saved.outputDirectory
      };
    })()
  `)) as {
    originalSize?: number;
    outputPath?: string;
    reportPath?: string;
    verified?: boolean;
    progressCount?: number;
    savedOutputDirectory?: string;
  };

  if (!workflow.originalSize || workflow.originalSize <= 0) {
    throw new Error("Desktop smoke failed: analysis did not return a document size");
  }
  if (!workflow.outputPath?.endsWith("_optimized.hwpx")) {
    throw new Error(`Desktop smoke failed: unexpected output path ${String(workflow.outputPath)}`);
  }
  if (workflow.reportPath !== undefined) {
    throw new Error(`Desktop smoke failed: report path was returned with default report saving disabled`);
  }
  if (workflow.savedOutputDirectory !== undefined) {
    throw new Error("Desktop smoke failed: output directory was persisted in settings");
  }
  if (workflow.verified !== true) {
    throw new Error("Desktop smoke failed: optimized output did not verify");
  }
  if (!workflow.progressCount || workflow.progressCount < 1) {
    throw new Error("Desktop smoke failed: no optimization progress was emitted");
  }

  const spoofedDropRegistration = (await window.webContents.executeJavaScript(`
    window.hwpxOptimizer.registerDroppedHwpxFiles([
      { name: "spoof.hwpx", path: ${JSON.stringify(smokeInputPath)} }
    ])
  `)) as string[];

  if (spoofedDropRegistration.length !== 0) {
    throw new Error("Desktop smoke failed: spoofed dropped-file path was registered");
  }
}

function parseSmokeMode(value: string | undefined): OptimizationMode {
  if (value === "safe" || value === "balanced" || value === "aggressive") return value;
  return "safe";
}

async function createSmokeHwpxFixture(): Promise<Buffer> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file("Contents/content.hpf", '<opf:package xmlns:opf="http://www.idpf.org/2007/opf" />');
  zip.file("Contents/section0.xml", '<root><img href="BinData/used.bin" /></root>');
  zip.file("BinData/used.bin", "used");
  zip.file("BinData/unused.bin", "unused");
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}

function runAnalyzeWorker(filePath: string): Promise<DesktopAnalysisResult> {
  const worker = ensureDocumentWorker();
  activeAnalyzeWorker = worker;
  return postWorkerRequest<DesktopAnalysisResult>({ type: "analyze", filePath }).finally(() => {
    if (activeAnalyzeWorker === worker) activeAnalyzeWorker = null;
  });
}

function runOptimizeWorker(
  input: {
    filePath: string;
    mode: OptimizationMode;
    outputDirectory?: string;
    outputMode?: "single" | "batch";
    actions?: string[];
    settings: DesktopSettings;
  },
  onProgress: (progress: { percent: number; item: string }) => void
): Promise<DesktopOptimizeResult> {
  const worker = ensureDocumentWorker();
  activeOptimizeWorker = worker;
  return postWorkerRequest<DesktopOptimizeResult>({ type: "optimize", input }, onProgress)
    .then((result) => {
      onProgress({ percent: 100, item: "Optimization complete" });
      return result;
    })
    .finally(() => {
      if (activeOptimizeWorker === worker) activeOptimizeWorker = null;
    });
}

async function warmDocumentWorker(): Promise<void> {
  try {
    await postWorkerRequest({ type: "warm" });
  } catch {
    // Warm-up is opportunistic; the next real request will recreate the worker.
  }
}

function ensureDocumentWorker(): Worker {
  if (documentWorker) return documentWorker;
  const worker = new Worker(join(import.meta.dirname, "main", "documentWorker.js"));
  documentWorker = worker;
  worker.on("message", (message: DocumentWorkerMessage) => {
    const pending = pendingWorkerRequests.get(message.id);
    if (!pending) return;
    if (message.type === "progress") {
      pending.onProgress?.({ percent: message.percent, item: message.item });
      return;
    }
    pendingWorkerRequests.delete(message.id);
    if (message.type === "error") {
      pending.reject(new Error(message.message));
      return;
    }
    pending.resolve(message.type === "warm-complete" ? { ok: true } : message.result);
  });
  worker.on("error", (error) => rejectPendingWorkerRequests(error));
  worker.on("exit", (code) => {
    if (documentWorker === worker) documentWorker = null;
    const error = code === 0 ? new Error("Document worker exited unexpectedly.") : new Error("Operation cancelled.");
    rejectPendingWorkerRequests(error);
  });
  return worker;
}

function postWorkerRequest<T = { ok: true }>(
  request: DocumentWorkerRequestInput,
  onProgress?: (progress: { percent: number; item: string }) => void
): Promise<T> {
  const worker = ensureDocumentWorker();
  const id = nextWorkerRequestId;
  nextWorkerRequestId += 1;
  return new Promise<T>((resolve, reject) => {
    pendingWorkerRequests.set(id, {
      resolve: (value) => resolve(value as T),
      reject,
      onProgress
    });
    worker.postMessage({ id, ...request });
  });
}

function rejectPendingWorkerRequests(error: Error): void {
  for (const pending of pendingWorkerRequests.values()) {
    pending.reject(error);
  }
  pendingWorkerRequests.clear();
  pendingDocumentOperation = null;
  activeAnalyzeWorker = null;
  activeOptimizeWorker = null;
}

type DocumentWorkerRequest =
  | { id: number; type: "warm" }
  | { id: number; type: "analyze"; filePath: string }
  | {
      id: number;
      type: "optimize";
      input: {
        filePath: string;
        mode: OptimizationMode;
        outputDirectory?: string;
        outputMode?: "single" | "batch";
        actions?: string[];
        settings: DesktopSettings;
      };
    };

type DocumentWorkerRequestInput =
  | { type: "warm" }
  | { type: "analyze"; filePath: string }
  | {
      type: "optimize";
      input: {
        filePath: string;
        mode: OptimizationMode;
        outputDirectory?: string;
        outputMode?: "single" | "batch";
        actions?: string[];
        settings: DesktopSettings;
      };
    };

type DocumentWorkerMessage =
  | { id: number; type: "warm-complete" }
  | { id: number; type: "progress"; percent: number; item: string }
  | { id: number; type: "complete"; result: DesktopAnalysisResult | DesktopOptimizeResult }
  | { id: number; type: "error"; message: string };
