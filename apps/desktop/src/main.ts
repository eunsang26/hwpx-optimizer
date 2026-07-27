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
// Watchdog: if the worker hangs (stuck sharp call, infinite loop) the IPC promise
// would otherwise never settle, leaving pendingDocumentOperation stuck so every
// later request is refused. Terminate and reject after this budget instead.
const DOCUMENT_OPERATION_TIMEOUT_MS = 300_000;
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
let settingsSaveQueue: Promise<void> = Promise.resolve();
let smokeDialogFilePaths: string[] | undefined;
// Packaged Windows EXEs treat unknown `--flags` as Chromium switches ("bad option").
// Prefer HWPX_OPT_SMOKE_TEST=1 for packaged smoke; keep argv for Linux `electron` launches.
const isSmokeTest =
  process.argv.includes("--smoke-test") || process.env.HWPX_OPT_SMOKE_TEST === "1";
if (isSmokeTest) {
  app.setPath("userData", join(process.cwd(), ".tmp", "electron-smoke"));
}
if (process.platform === "win32") {
  app.setAppUserModelId("local.hwpxoptimizer.app");
}

async function createWindow(): Promise<BrowserWindow> {
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindowClass({
    width: 960,
    height: 720,
    minWidth: 920,
    minHeight: 700,
    maxWidth: 1360,
    useContentSize: true,
    show: !isSmokeTest,
    title: "HWPX 보고서 용량 최적화",
    icon: join(import.meta.dirname, "app-icon.png"),
    autoHideMenuBar: true,
    backgroundColor: "#e5e9f0",
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
    if (isSmokeTest && smokeDialogFilePaths) {
      for (const filePath of smokeDialogFilePaths) {
        await registerAllowedInputPath(filePath);
      }
      return [...smokeDialogFilePaths];
    }
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
        targetBytes?: number;
        jpegQuality?: number;
      }
    ) => {
      if (pendingDocumentOperation || activeAnalyzeWorker || activeOptimizeWorker) {
        throw new Error("Another optimization is already running.");
      }
      validateOptimizeInput(input);
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
        batchTargetBytes?: number;
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
        batchTargetBytes: input.batchTargetBytes,
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
  await settingsSaveQueue;
  return readSettings();
}

async function readSettings(): Promise<DesktopSettings> {
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

function saveSettings(patch: DesktopSettingsPatch): Promise<DesktopSettings> {
  const task = settingsSaveQueue.then(async () => {
    const current = await readSettings();
    const next = { ...current, ...persistentDesktopSettingsPatch(patch) };
    await mkdir(app.getPath("userData"), { recursive: true });
    await writeFile(settingsPath(), JSON.stringify(next, null, 2));
    return next;
  });
  settingsSaveQueue = task.then(
    () => undefined,
    () => undefined
  );
  return task;
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
  const smokeThirdInputPath = join(smokeDir, "smoke-third.hwpx");
  const smokeFourthInputPath = join(smokeDir, "smoke-fourth.hwpx");
  const smokeSourcePath = process.env.HWPX_OPT_SMOKE_INPUT;
  const smokeMode = parseSmokeMode(process.env.HWPX_OPT_SMOKE_MODE);
  await writeFile(
    smokeInputPath,
    smokeSourcePath ? await readFileFs(resolve(smokeSourcePath)) : await createSmokeHwpxFixture()
  );
  await writeFile(smokeSecondInputPath, await createSmokeHwpxFixture());
  await writeFile(smokeThirdInputPath, await createSmokeHwpxFixture());
  await writeFile(smokeFourthInputPath, await createSmokeHwpxFixture());
  const smokeInputExceedsDefaultTarget = (await stat(smokeInputPath)).size > 40 * 1024 * 1024;
  await registerAllowedInputPath(smokeInputPath);
  await registerAllowedInputPath(smokeSecondInputPath);
  await registerAllowedInputPath(smokeThirdInputPath);
  await registerAllowedInputPath(smokeFourthInputPath);
  await registerAllowedOutputDirectory(smokeDir);
  smokeDialogFilePaths = [smokeInputPath];

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
            settingsSubmissionLimit: document.getElementById("setting-submission-limit")?.value,
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
    settingsSubmissionLimit?: string;
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
    result.settingsSubmissionLimit !== "mb40" ||
    result.settingsOutputButton !== "폴더 선택" ||
    result.settingsOutputResetButton !== "원본 폴더 사용"
  ) {
    throw new Error("Desktop smoke failed: settings output folder controls did not render");
  }

  const concurrentSettings = (await window.webContents.executeJavaScript(`
    (async () => {
      await Promise.all([
        window.hwpxOptimizer.saveSettings({ saveReport: true }),
        window.hwpxOptimizer.saveSettings({ preventOverwrite: false })
      ]);
      const loaded = await window.hwpxOptimizer.loadSettings();
      await window.hwpxOptimizer.saveSettings({ saveReport: false, preventOverwrite: true });
      return {
        saveReport: loaded.saveReport,
        preventOverwrite: loaded.preventOverwrite
      };
    })()
  `)) as { saveReport?: boolean; preventOverwrite?: boolean };
  if (concurrentSettings.saveReport !== true || concurrentSettings.preventOverwrite !== false) {
    throw new Error(
      `Desktop smoke failed: concurrent settings patches lost an update ${JSON.stringify(concurrentSettings)}`
    );
  }

  const layout = (await window.webContents.executeJavaScript(`
    (() => {
      document.getElementById("settings-close-button")?.click();
      document.getElementById("help-button")?.click();
      const workspace = document.getElementById("single-workspace");
      const shell = document.querySelector(".shell");
      const planSidebar = document.getElementById("plan-sidebar");
      const optionsSheet = document.getElementById("detail-options-sheet");
      const summaryPanel = document.querySelector(".summary-panel");
      const emptyReview = document.getElementById("empty-policy-review");
      const helpPanel = document.getElementById("help-panel");
      const workspaceRect = workspace?.getBoundingClientRect();
      const shellRect = shell?.getBoundingClientRect();
      const shellStyle = shell ? getComputedStyle(shell) : undefined;
      const shellContentWidth = shellRect
        ? shellRect.width -
          Number.parseFloat(shellStyle?.paddingLeft ?? "0") -
          Number.parseFloat(shellStyle?.paddingRight ?? "0")
        : 0;
      return {
        planInsideOptions: optionsSheet?.contains(planSidebar) ?? false,
        planHiddenWithOptions: planSidebar?.getClientRects().length === 0,
        singleColumn: getComputedStyle(workspace ?? document.body).gridTemplateColumns.split(" ").length === 1,
        emptySummaryHidden: summaryPanel?.getClientRects().length === 0,
        emptyReviewVisible: (emptyReview?.getBoundingClientRect().width ?? 0) > 0,
        workspaceWidth: workspaceRect?.width ?? 0,
        shellWidth: shellRect?.width ?? 0,
        shellContentWidth,
        workspaceWidthDelta: Math.abs((workspaceRect?.width ?? 0) - shellContentWidth),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        helpOpen: helpPanel?.classList.contains("is-open") ?? false,
        helpTitle: document.getElementById("help-title")?.textContent,
        manualStepCount: document.querySelectorAll(".manual-steps li").length
      };
    })()
  `)) as {
    planInsideOptions?: boolean;
    planHiddenWithOptions?: boolean;
    singleColumn?: boolean;
    emptySummaryHidden?: boolean;
    emptyReviewVisible?: boolean;
    workspaceWidth?: number;
    shellWidth?: number;
    shellContentWidth?: number;
    workspaceWidthDelta?: number;
    viewportWidth?: number;
    viewportHeight?: number;
    helpOpen?: boolean;
    helpTitle?: string;
    manualStepCount?: number;
  };

  if (
    layout.planInsideOptions !== true ||
    layout.planHiddenWithOptions !== true ||
    layout.singleColumn !== true ||
    layout.emptySummaryHidden !== true ||
    layout.emptyReviewVisible !== true ||
    layout.viewportWidth !== 960 ||
    !layout.viewportHeight ||
    layout.viewportHeight < 700 ||
    layout.viewportHeight > 720
  ) {
    throw new Error(
      `Desktop smoke failed: canonical empty layout did not render in the compact default window ${JSON.stringify(layout)}`
    );
  }
  if (
    !layout.shellWidth ||
    !layout.workspaceWidth ||
    (layout.workspaceWidthDelta ?? Number.POSITIVE_INFINITY) > 1
  ) {
    throw new Error(
      `Desktop smoke failed: workspace width ${String(layout.workspaceWidth)} does not fill shell width ${String(layout.shellWidth)}`
    );
  }
  if (layout.helpOpen !== true || layout.helpTitle !== "사용 매뉴얼" || layout.manualStepCount !== 10) {
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
        hasSubmission40Preset: Boolean(document.querySelector("#submission-limit-select option[value='mb40']")),
        batchResultDetailsExists: Boolean(document.getElementById("batch-result-details")),
        cleared: document.body.dataset.dragOver !== "true" && overlay?.hidden === true
      };
    })()
  `)) as {
    active?: boolean;
    overlayVisible?: boolean;
    overlayText?: string;
    statusBannerExists?: boolean;
    hasSubmission40Preset?: boolean;
    batchResultDetailsExists?: boolean;
    cleared?: boolean;
  };

  if (
    dragUi.active !== true ||
    dragUi.overlayVisible !== true ||
    !dragUi.overlayText?.includes("HWPX 파일을 여기에 놓으세요") ||
    dragUi.statusBannerExists !== true ||
    dragUi.hasSubmission40Preset !== true ||
    dragUi.batchResultDetailsExists !== true ||
    dragUi.cleared !== true
  ) {
    throw new Error("Desktop smoke failed: full-window drag overlay did not respond to drag/drop events");
  }

  const selectedUi = (await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      document.getElementById("empty-choose-button")?.click();
      let attempts = 0;
      const poll = () => {
        attempts += 1;
        const selected = document.getElementById("selected-file-card");
        const optimize = document.getElementById("optimize-button");
        const status = document.getElementById("summary-status");
        if (
          document.body.dataset.view === "single" &&
          selected?.hidden === false &&
          optimize?.disabled === false &&
          status?.textContent?.includes("제출")
        ) {
          const policyRect = document.getElementById("policy-toolbar")?.getBoundingClientRect();
          const fileRect = document.querySelector(".file-panel")?.getBoundingClientRect();
          const summaryRect = document.querySelector(".summary-panel")?.getBoundingClientRect();
          const optimizeRect = optimize.getBoundingClientRect();
          const outputRect = document.getElementById("output-button")?.getBoundingClientRect();
          const optionsRect = document.getElementById("toggle-options-button")?.getBoundingClientRect();
          const detailsRect = document.getElementById("analysis-details")?.getBoundingClientRect();
          const workspaceRect = document.getElementById("single-workspace")?.getBoundingClientRect();
          resolve({
            policyBeforeFile: Boolean(policyRect && fileRect && policyRect.top < fileRect.top),
            fileBeforeHero: Boolean(fileRect && summaryRect && fileRect.top < summaryRect.top),
            ctaSingleRow:
              Boolean(outputRect && optionsRect) &&
              Math.abs(
                optimizeRect.top + optimizeRect.height / 2 -
                  ((outputRect?.top ?? 0) + (outputRect?.height ?? 0) / 2)
              ) <= 1 &&
              Math.abs(
                optimizeRect.top + optimizeRect.height / 2 -
                  ((optionsRect?.top ?? 0) + (optionsRect?.height ?? 0) / 2)
              ) <= 1,
            ctaVisible: [
              optimize.getClientRects().length > 0,
              document.getElementById("output-button")?.getClientRects().length > 0,
              document.getElementById("toggle-options-button")?.getClientRects().length > 0
            ],
            reviewVisible: (document.getElementById("review-strip")?.getBoundingClientRect().width ?? 0) > 0,
            emptyReviewHidden: document.getElementById("empty-policy-review")?.getClientRects().length === 0,
            expectedMeta: document.getElementById("summary-verdict")?.textContent,
            heroText: status.textContent,
            optimizeText: optimize.textContent,
            visiblePolicyControls: document.querySelectorAll(
              '#policy-toolbar label:not([hidden]):not(.policy-toolbar-batch)'
            ).length,
            singleBatchPolicyHidden:
              document.querySelector(".policy-toolbar-batch")?.getClientRects().length === 0,
            targetMarkerVisible:
              document.getElementById("target-track-limit")?.getClientRects().length > 0,
            targetLabelVisible:
              document.getElementById("gauge-mid-label")?.getClientRects().length > 0,
            workspaceWidth: workspaceRect?.width ?? 0,
            detailsWidth: detailsRect?.width ?? 0,
            selectedFileName: document.getElementById("selected-file-name")?.textContent
          });
          return;
        }
        if (attempts > 2400) {
          resolve({ timedOut: true });
          return;
        }
        setTimeout(poll, 50);
      };
      poll();
    })
  `)) as {
    timedOut?: boolean;
    policyBeforeFile?: boolean;
    fileBeforeHero?: boolean;
    ctaSingleRow?: boolean;
    ctaVisible?: Array<boolean | undefined>;
    reviewVisible?: boolean;
    emptyReviewHidden?: boolean;
    expectedMeta?: string;
    heroText?: string;
    optimizeText?: string;
    visiblePolicyControls?: number;
    singleBatchPolicyHidden?: boolean;
    targetMarkerVisible?: boolean;
    targetLabelVisible?: boolean;
    workspaceWidth?: number;
    detailsWidth?: number;
    selectedFileName?: string;
  };

  if (
    selectedUi.timedOut ||
    selectedUi.policyBeforeFile !== true ||
    selectedUi.fileBeforeHero !== true ||
    selectedUi.ctaSingleRow !== true ||
    selectedUi.reviewVisible !== true ||
    selectedUi.emptyReviewHidden !== true ||
    !selectedUi.expectedMeta?.includes("예상") ||
    !selectedUi.heroText?.includes("제출") ||
    selectedUi.optimizeText !== "최적화 실행" ||
    selectedUi.visiblePolicyControls !== 2 ||
    selectedUi.singleBatchPolicyHidden !== true ||
    selectedUi.targetMarkerVisible !== smokeInputExceedsDefaultTarget ||
    selectedUi.targetLabelVisible !== smokeInputExceedsDefaultTarget ||
    !selectedUi.selectedFileName?.endsWith(".hwpx") ||
    !selectedUi.workspaceWidth ||
    Math.abs(selectedUi.workspaceWidth - (selectedUi.detailsWidth ?? 0)) > 1
  ) {
    throw new Error(`Desktop smoke failed: canonical selected layout mismatch ${JSON.stringify(selectedUi)}`);
  }

  smokeDialogFilePaths = [smokeInputPath, smokeSecondInputPath];
  const batchUi = (await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      document.getElementById("choose-button")?.click();
      let attempts = 0;
      const poll = () => {
        attempts += 1;
        const rows = Array.from(document.querySelectorAll("#batch-list tr"));
        const optimize = document.getElementById("optimize-button");
        if (
          document.body.dataset.view === "batch" &&
          document.body.dataset.busy !== "analysis" &&
          rows.length === 2 &&
          optimize?.disabled === false
        ) {
          const perFileState = {
            heroMeta: document.getElementById("summary-verdict")?.textContent,
            optimizeText: optimize.textContent,
            qualityTitle: document.getElementById("quality-head-label")?.textContent,
            pendingRemoveActions: document.querySelectorAll('#batch-list [data-action="remove"]').length,
            selectedRows: rows.filter((row) => row.querySelector(".batch-select")?.checked).length
          };

          const judge = document.getElementById("batch-target-mode-select");
          judge.value = "aggregate";
          judge.dispatchEvent(new Event("change", { bubbles: true }));
          const aggregateMeta = document.getElementById("summary-verdict")?.textContent;
          const allocatedRows = Array.from(document.querySelectorAll("#batch-list .name .sub"))
            .filter((item) => item.textContent?.includes("배분 목표")).length;

          const firstCheckbox = document.querySelector("#batch-list .batch-select");
          firstCheckbox.checked = false;
          firstCheckbox.dispatchEvent(new Event("change", { bubbles: true }));
          const firstRow = document.querySelector("#batch-list tr");
          const excludedState = {
            status: firstRow?.querySelector(".status")?.textContent,
            size: firstRow?.querySelector(".batch-size-cell")?.textContent,
            qualityControls: firstRow?.querySelectorAll(".row-q-btn, .batch-quality-input").length,
            selectedLive: document.getElementById("policy-live")?.textContent
          };

          document.getElementById("quality-mode-manual")?.click();
          const manualState = {
            title: document.getElementById("quality-head-label")?.textContent,
            manualVisible: document.getElementById("quality-manual")?.getClientRects().length > 0,
            selectedQualityInputs: Array.from(document.querySelectorAll("#batch-list tr"))
              .filter((row) => row.querySelector(".batch-select")?.checked)
              .filter((row) => row.querySelector(".batch-quality-input")).length,
            excludedQualityInputs: firstRow?.querySelectorAll(".batch-quality-input").length
          };

          document.getElementById("toggle-options-button")?.click();
          const optionsSheet = document.getElementById("detail-options-sheet");
          const optionsState = {
            visible: optionsSheet?.getClientRects().length > 0
          };
          const selectAll = document.getElementById("batch-select-all");
          selectAll.checked = false;
          selectAll.dispatchEvent(new Event("change", { bubbles: true }));
          const selectNoneState = {
            hero: document.getElementById("summary-status")?.textContent,
            optimizeDisabled: document.getElementById("optimize-button")?.disabled,
            excludedRows: Array.from(document.querySelectorAll("#batch-list .status"))
              .filter((item) => item.textContent === "제외").length
          };
          selectAll.checked = true;
          selectAll.dispatchEvent(new Event("change", { bubbles: true }));
          const selectAllState = {
            selectedLive: document.getElementById("policy-live")?.textContent,
            optimizeDisabled: document.getElementById("optimize-button")?.disabled,
            qualityInputs: document.querySelectorAll("#batch-list .batch-quality-input").length
          };
          resolve({
            perFileState,
            aggregateMeta,
            allocatedRows,
            excludedState,
            manualState,
            optionsState,
            selectNoneState,
            selectAllState
          });
          return;
        }
        if (attempts > 2400) {
          resolve({ timedOut: true });
          return;
        }
        setTimeout(poll, 50);
      };
      poll();
    })
  `)) as {
    timedOut?: boolean;
    perFileState?: {
      heroMeta?: string;
      optimizeText?: string;
      qualityTitle?: string;
      pendingRemoveActions?: number;
      selectedRows?: number;
    };
    aggregateMeta?: string;
    allocatedRows?: number;
    excludedState?: {
      status?: string;
      size?: string;
      qualityControls?: number;
      selectedLive?: string;
    };
    manualState?: {
      title?: string;
      manualVisible?: boolean;
      selectedQualityInputs?: number;
      excludedQualityInputs?: number;
    };
    optionsState?: {
      visible?: boolean;
    };
    selectNoneState?: {
      hero?: string;
      optimizeDisabled?: boolean;
      excludedRows?: number;
    };
    selectAllState?: {
      selectedLive?: string;
      optimizeDisabled?: boolean;
      qualityInputs?: number;
    };
  };

  if (
    batchUi.timedOut ||
    !batchUi.perFileState ||
    !batchUi.perFileState.heroMeta?.includes("파일별 기준") ||
    !batchUi.perFileState.heroMeta?.includes("40MB") ||
    batchUi.perFileState.optimizeText !== "선택 파일 일괄 최적화" ||
    batchUi.perFileState.qualityTitle !== "품질 · 파일별 자동" ||
    batchUi.perFileState.pendingRemoveActions !== 0 ||
    batchUi.perFileState.selectedRows !== 2 ||
    !batchUi.aggregateMeta?.includes("선택 합계 배분") ||
    batchUi.allocatedRows !== 2 ||
    batchUi.excludedState?.status !== "제외" ||
    !batchUi.excludedState.size?.includes("—") ||
    batchUi.excludedState.qualityControls !== 0 ||
    !batchUi.excludedState.selectedLive?.includes("선택 1") ||
    batchUi.manualState?.title !== "일괄 품질 (선택 파일)" ||
    batchUi.manualState.manualVisible !== true ||
    batchUi.manualState.selectedQualityInputs !== 1 ||
    batchUi.manualState.excludedQualityInputs !== 0 ||
    batchUi.optionsState?.visible !== true ||
    !batchUi.selectNoneState?.hero?.includes("선택·분석 대기") ||
    batchUi.selectNoneState.optimizeDisabled !== true ||
    batchUi.selectNoneState.excludedRows !== 2 ||
    !batchUi.selectAllState?.selectedLive?.includes("선택 2") ||
    batchUi.selectAllState.optimizeDisabled !== false ||
    batchUi.selectAllState.qualityInputs !== 2
  ) {
    throw new Error(`Desktop smoke failed: canonical batch event flow mismatch ${JSON.stringify(batchUi)}`);
  }

  smokeDialogFilePaths = [smokeInputPath];
  const batchDuplicateAddUi = (await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      document.getElementById("choose-button")?.click();
      let attempts = 0;
      const poll = () => {
        attempts += 1;
        if (document.body.dataset.busy !== "analysis") {
          resolve({
            view: document.body.dataset.view,
            rowCount: document.querySelectorAll("#batch-list tr").length,
            fileMeta: document.getElementById("file-meta")?.textContent
          });
          return;
        }
        if (attempts > 2400) {
          resolve({ timedOut: true });
          return;
        }
        setTimeout(poll, 50);
      };
      setTimeout(poll, 0);
    })
  `)) as {
    timedOut?: boolean;
    view?: string;
    rowCount?: number;
    fileMeta?: string;
  };
  if (
    batchDuplicateAddUi.timedOut ||
    batchDuplicateAddUi.view !== "batch" ||
    batchDuplicateAddUi.rowCount !== 2 ||
    !batchDuplicateAddUi.fileMeta?.includes("2개 파일")
  ) {
    throw new Error(
      `Desktop smoke failed: adding one file to an existing batch replaced the batch ${JSON.stringify(batchDuplicateAddUi)}`
    );
  }

  smokeDialogFilePaths = [smokeThirdInputPath];
  const batchSingleAddUi = (await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const cleanup = document.getElementById("cleanup-document-toggle");
      cleanup.checked = false;
      cleanup.dispatchEvent(new Event("change", { bubbles: true }));
      document.getElementById("choose-button")?.click();
      let attempts = 0;
      const poll = () => {
        attempts += 1;
        const rows = document.querySelectorAll("#batch-list tr");
        if (
          document.body.dataset.view === "batch" &&
          document.body.dataset.busy !== "analysis" &&
          rows.length === 3
        ) {
          resolve({
            view: document.body.dataset.view,
            rowCount: rows.length,
            fileMeta: document.getElementById("file-meta")?.textContent,
            cleanupChecked: cleanup.checked,
            targetMode: document.getElementById("batch-target-mode-select")?.value,
            manualPressed: document.getElementById("quality-mode-manual")?.getAttribute("aria-pressed")
          });
          return;
        }
        if (attempts > 2400) {
          resolve({ timedOut: true });
          return;
        }
        setTimeout(poll, 50);
      };
      poll();
    })
  `)) as {
    timedOut?: boolean;
    view?: string;
    rowCount?: number;
    fileMeta?: string;
    cleanupChecked?: boolean;
    targetMode?: string;
    manualPressed?: string;
  };
  if (
    batchSingleAddUi.timedOut ||
    batchSingleAddUi.view !== "batch" ||
    batchSingleAddUi.rowCount !== 3 ||
    !batchSingleAddUi.fileMeta?.includes("3개 파일") ||
    batchSingleAddUi.cleanupChecked !== false ||
    batchSingleAddUi.targetMode !== "aggregate" ||
    batchSingleAddUi.manualPressed !== "true"
  ) {
    throw new Error(
      `Desktop smoke failed: adding one new file did not preserve the active batch policy ${JSON.stringify(batchSingleAddUi)}`
    );
  }

  const completedBatchUi = (await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      document.getElementById("optimize-button")?.click();
      let attempts = 0;
      const poll = () => {
        attempts += 1;
        if (
          document.body.dataset.batchResult === "visible" &&
          document.body.dataset.busy === ""
        ) {
          resolve({
            doneRows: Array.from(document.querySelectorAll("#batch-list .status"))
              .filter((item) => item.textContent === "완료").length,
            resultVisible: document.getElementById("batch-result-panel")?.getClientRects().length > 0
          });
          return;
        }
        if (attempts > 2400) {
          resolve({ timedOut: true });
          return;
        }
        setTimeout(poll, 50);
      };
      poll();
    })
  `)) as { timedOut?: boolean; doneRows?: number; resultVisible?: boolean };
  if (completedBatchUi.timedOut || completedBatchUi.doneRows !== 3 || completedBatchUi.resultVisible !== true) {
    throw new Error(`Desktop smoke failed: real batch completion flow mismatch ${JSON.stringify(completedBatchUi)}`);
  }

  smokeDialogFilePaths = [smokeFourthInputPath];
  const batchPostResultAddUi = (await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      document.getElementById("choose-button")?.click();
      let attempts = 0;
      const poll = () => {
        attempts += 1;
        const rows = document.querySelectorAll("#batch-list tr");
        if (
          document.body.dataset.view === "batch" &&
          document.body.dataset.busy !== "analysis" &&
          rows.length === 4
        ) {
          resolve({
            batchResult: document.body.dataset.batchResult,
            resultHidden: document.getElementById("batch-result-panel")?.hidden,
            rowCount: rows.length,
            fileMeta: document.getElementById("file-meta")?.textContent
          });
          return;
        }
        if (attempts > 2400) {
          resolve({ timedOut: true });
          return;
        }
        setTimeout(poll, 50);
      };
      poll();
    })
  `)) as {
    timedOut?: boolean;
    batchResult?: string;
    resultHidden?: boolean;
    rowCount?: number;
    fileMeta?: string;
  };
  if (
    batchPostResultAddUi.timedOut ||
    batchPostResultAddUi.batchResult !== "" ||
    batchPostResultAddUi.resultHidden !== true ||
    batchPostResultAddUi.rowCount !== 4 ||
    !batchPostResultAddUi.fileMeta?.includes("4개 파일")
  ) {
    throw new Error(
      `Desktop smoke failed: adding a file after batch completion left stale result UI ${JSON.stringify(batchPostResultAddUi)}`
    );
  }

  window.setContentSize(920, 700);
  const compactBatchUi = (await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const settingsPanel = document.getElementById("settings-panel");
      settingsPanel.style.transition = "none";
      document.getElementById("settings-button")?.click();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const settings = settingsPanel?.getBoundingClientRect();
        const toolbar = document.getElementById("policy-toolbar")?.getBoundingClientRect();
        resolve({
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          settingsLeft: settings?.left,
          settingsRight: settings?.right,
          toolbarLeft: toolbar?.left,
          toolbarRight: toolbar?.right
        });
      }));
    })
  `)) as {
    viewportWidth?: number;
    documentWidth?: number;
    settingsLeft?: number;
    settingsRight?: number;
    toolbarLeft?: number;
    toolbarRight?: number;
  };
  await window.webContents.executeJavaScript(`document.getElementById("settings-close-button")?.click()`);
  window.setContentSize(960, 720);
  if (
    !compactBatchUi.viewportWidth ||
    (compactBatchUi.documentWidth ?? 0) > compactBatchUi.viewportWidth + 1 ||
    (compactBatchUi.settingsLeft ?? -1) < 0 ||
    (compactBatchUi.settingsRight ?? Number.POSITIVE_INFINITY) > compactBatchUi.viewportWidth + 1 ||
    (compactBatchUi.toolbarLeft ?? -1) < 0 ||
    (compactBatchUi.toolbarRight ?? Number.POSITIVE_INFINITY) > compactBatchUi.viewportWidth + 1
  ) {
    throw new Error(`Desktop smoke failed: compact batch layout overflowed ${JSON.stringify(compactBatchUi)}`);
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

  const screenshotPath = process.env.HWPX_OPT_SMOKE_SCREENSHOT;
  if (screenshotPath) {
    await window.webContents.executeJavaScript(`
      (() => {
        for (const id of ["settings-backdrop", "help-backdrop", "drop-overlay", "progress-panel", "status-banner"]) {
          const element = document.getElementById(id);
          if (element) element.hidden = true;
        }
        document.body.dataset.dragOver = "false";
        document.getElementById("drop-zone")?.classList.remove("is-over");
        document.getElementById("settings-panel")?.classList.remove("is-open");
        document.getElementById("help-panel")?.classList.remove("is-open");
      })()
    `);
    const screenshot = await window.webContents.capturePage();
    await writeFile(resolve(screenshotPath), screenshot.toPNG());
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
      input.jpegQuality < 60 ||
      input.jpegQuality > 95)
  ) {
    throw new Error("Invalid optimize request: jpegQuality must be an integer between 60 and 95.");
  }
  if (input.outputMode !== undefined && input.outputMode !== "single" && input.outputMode !== "batch") {
    throw new Error("Invalid optimize request: outputMode must be 'single' or 'batch'.");
  }
}

function runAnalyzeWorker(filePath: string): Promise<DesktopAnalysisResult> {
  const worker = ensureDocumentWorker();
  activeAnalyzeWorker = worker;
  return postWorkerRequest<DesktopAnalysisResult>({ type: "analyze", filePath }, undefined, {
    timeoutMs: DOCUMENT_OPERATION_TIMEOUT_MS
  }).finally(() => {
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
    targetBytes?: number;
    jpegQuality?: number;
    settings: DesktopSettings;
  },
  onProgress: (progress: { percent: number; item: string }) => void
): Promise<DesktopOptimizeResult> {
  const worker = ensureDocumentWorker();
  activeOptimizeWorker = worker;
  return postWorkerRequest<DesktopOptimizeResult>({ type: "optimize", input }, onProgress, {
    timeoutMs: DOCUMENT_OPERATION_TIMEOUT_MS
  })
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
  onProgress?: (progress: { percent: number; item: string }) => void,
  options: { timeoutMs?: number } = {}
): Promise<T> {
  const worker = ensureDocumentWorker();
  const id = nextWorkerRequestId;
  nextWorkerRequestId += 1;
  return new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    pendingWorkerRequests.set(id, {
      resolve: (value) => {
        if (timer) clearTimeout(timer);
        resolve(value as T);
      },
      reject: (reason) => {
        if (timer) clearTimeout(timer);
        reject(reason);
      },
      onProgress
    });
    if (options.timeoutMs && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        if (!pendingWorkerRequests.has(id)) return;
        pendingWorkerRequests.delete(id);
        reject(new Error("문서 작업이 시간 내에 완료되지 않아 중단했습니다."));
        // Terminating triggers the worker "exit" handler, which rejects any
        // other pending requests and clears the busy flags.
        void worker.terminate();
      }, options.timeoutMs);
    }
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
        targetBytes?: number;
        jpegQuality?: number;
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
        targetBytes?: number;
        jpegQuality?: number;
        settings: DesktopSettings;
      };
    };

type DocumentWorkerMessage =
  | { id: number; type: "warm-complete" }
  | { id: number; type: "progress"; percent: number; item: string }
  | { id: number; type: "complete"; result: DesktopAnalysisResult | DesktopOptimizeResult }
  | { id: number; type: "error"; message: string };
