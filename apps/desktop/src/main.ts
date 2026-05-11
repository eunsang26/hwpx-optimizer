import type { BrowserWindow as BrowserWindowInstance, OpenDialogOptions } from "electron";
type BrowserWindow = BrowserWindowInstance;
type ElectronApi = typeof import("electron");

const electronApi = (globalThis as { __hwpxOptimizerElectron?: ElectronApi }).__hwpxOptimizerElectron;
if (!electronApi) {
  throw new Error("Electron API bridge was not initialized.");
}

const { app, BrowserWindow: BrowserWindowClass, dialog, ipcMain, shell, session } = electronApi;
import { mkdir, readFile as readFileFs, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import {
  defaultDesktopSettings,
  persistentDesktopSettingsPatch,
  previewImageDiffs,
  verifyDesktopFile
} from "./main/desktopService.js";
import type { DesktopAnalysisResult, DesktopOptimizeResult } from "./main/desktopService.js";
import type { DesktopSettings, DesktopSettingsPatch, OptimizationMode } from "./main/desktopService.js";

let mainWindow: BrowserWindow | null = null;
let activeOptimizeWorker: Worker | null = null;
const allowedInputPaths = new Set<string>();
const allowedOutputDirectories = new Set<string>();
const allowedGeneratedPaths = new Set<string>();
const isSmokeTest = process.argv.includes("--smoke-test");
if (isSmokeTest) {
  app.setPath("userData", join(process.cwd(), ".tmp", "electron-smoke"));
}

async function createWindow(): Promise<BrowserWindow> {
  mainWindow = new BrowserWindowClass({
    width: 1180,
    height: 780,
    minWidth: 920,
    minHeight: 640,
    show: !isSmokeTest,
    title: "HWPX 보고서 용량 최적화",
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

  ipcMain.handle("hwpx:analyze", async (_event, filePath: string) => {
    const allowedPath = await registerAllowedInputPath(filePath);
    return runAnalyzeWorker(allowedPath);
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
      if (activeOptimizeWorker) {
        throw new Error("Another optimization is already running.");
      }
      const filePath = await requireAllowedInputPath(input.filePath);
      const outputDirectory = input.outputDirectory
        ? await requireAllowedOutputDirectory(input.outputDirectory)
        : undefined;
      const settings = await loadSettings();
      const result = await runOptimizeWorker({ ...input, filePath, outputDirectory, settings }, (progress) => {
        mainWindow?.webContents.send("hwpx:optimize-progress", progress);
      });
      await registerGeneratedPath(result.outputPath);
      if (result.reportPath) await registerGeneratedPath(result.reportPath);
      return result;
    }
  );

  ipcMain.handle("hwpx:cancel-optimize", async () => {
    const worker = activeOptimizeWorker;
    if (!worker) return { cancelled: false };
    await worker.terminate();
    mainWindow?.webContents.send("hwpx:optimize-progress", { percent: 0, item: "Optimization cancelled" });
    return { cancelled: true };
  });

  ipcMain.handle("hwpx:verify", async (_event, filePath: string) => verifyDesktopFile(await requireKnownDocumentPath(filePath)));

  ipcMain.handle(
    "hwpx:image-preview",
    async (_event, input: { originalPath: string; optimizedPath: string; maxItems?: number }) =>
      previewImageDiffs(await requireAllowedInputPath(input.originalPath), await requireGeneratedPath(input.optimizedPath), {
        maxItems: input.maxItems
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
    return { ...defaultDesktopSettings, ...persistentDesktopSettingsPatch(JSON.parse(raw) as DesktopSettingsPatch) };
  } catch {
    return defaultDesktopSettings;
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
  const smokeSourcePath = process.env.HWPX_OPT_SMOKE_INPUT;
  const smokeMode = parseSmokeMode(process.env.HWPX_OPT_SMOKE_MODE);
  await writeFile(
    smokeInputPath,
    smokeSourcePath ? await readFileFs(resolve(smokeSourcePath)) : await createSmokeHwpxFixture()
  );

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
  if (result.fileName !== "HWPX 파일을 끌어오거나 선택하세요") {
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
  return new Promise((resolve, reject) => {
    const worker = new Worker(join(import.meta.dirname, "main", "analyzeWorker.js"), { workerData: filePath });

    worker.on("message", (message: AnalyzeWorkerMessage) => {
      if (message.type === "complete") {
        resolve(message.result);
      } else if (message.type === "error") {
        reject(new Error(message.message));
      }
    });
    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code !== 0) reject(new Error("Analysis worker exited unexpectedly."));
    });
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
  return new Promise((resolve, reject) => {
    const worker = new Worker(join(import.meta.dirname, "main", "optimizeWorker.js"), { workerData: input });
    activeOptimizeWorker = worker;
    let settled = false;
    const settle = (action: () => void) => {
      if (settled) return;
      settled = true;
      if (activeOptimizeWorker === worker) activeOptimizeWorker = null;
      action();
    };

    worker.on("message", (message: WorkerMessage) => {
      if (message.type === "progress") {
        onProgress({ percent: message.percent, item: message.item });
      } else if (message.type === "complete") {
        onProgress({ percent: 100, item: "Optimization complete" });
        settle(() => resolve(message.result));
      } else if (message.type === "error") {
        settle(() => reject(new Error(message.message)));
      }
    });
    worker.on("error", (error) => {
      settle(() => reject(error));
    });
    worker.on("exit", (code) => {
      settle(() => {
        if (code === 0) reject(new Error("Optimization worker exited unexpectedly."));
        else reject(new Error("Optimization cancelled."));
      });
    });
  });
}

type WorkerMessage =
  | { type: "progress"; percent: number; item: string }
  | { type: "complete"; result: DesktopOptimizeResult }
  | { type: "error"; message: string };

type AnalyzeWorkerMessage =
  | { type: "complete"; result: DesktopAnalysisResult }
  | { type: "error"; message: string };
