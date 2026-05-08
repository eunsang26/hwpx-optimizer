import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import type { OpenDialogOptions } from "electron";
import { mkdir, readFile as readFileFs, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { defaultDesktopSettings, previewImageDiffs, verifyDesktopFile } from "./main/desktopService.js";
import type { DesktopAnalysisResult, DesktopOptimizeResult } from "./main/desktopService.js";
import type { DesktopSettings, OptimizationMode } from "./main/desktopService.js";

let mainWindow: BrowserWindow | null = null;
let activeOptimizeWorker: Worker | null = null;
const isSmokeTest = process.argv.includes("--smoke-test");
if (isSmokeTest) {
  app.setPath("userData", join(process.cwd(), ".tmp", "electron-smoke"));
}

async function createWindow(): Promise<BrowserWindow> {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 920,
    minHeight: 640,
    show: !isSmokeTest,
    title: "HWPX 문서 최적화",
    webPreferences: {
      preload: join(import.meta.dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  await mainWindow.loadFile(join(import.meta.dirname, "index.html"));
  return mainWindow;
}

app.whenReady()
  .then(async () => {
    registerIpc();
    const window = await createWindow();

    if (isSmokeTest) {
      await runSmokeAssertions(window);
      app.quit();
      return;
    }

    app.on("activate", async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
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
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle("dialog:select-hwpx-many", async () => {
    const options: OpenDialogOptions = {
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "HWPX 문서", extensions: ["hwpx"] }]
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths;
  });

  ipcMain.handle("dialog:select-hwpx-folder", async () => {
    const options: OpenDialogOptions = { properties: ["openDirectory"] };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    const directory = result.filePaths[0];
    const entries = await readdir(directory, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && /\.hwpx$/i.test(entry.name))
      .map((entry) => join(directory, entry.name))
      .sort();
    return { directory, files };
  });

  ipcMain.handle("dialog:select-directory", async () => {
    const options: OpenDialogOptions = {
      properties: ["openDirectory"]
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle("settings:load", loadSettings);
  ipcMain.handle("settings:save", async (_event, patch: Partial<DesktopSettings>) => saveSettings(patch));

  ipcMain.handle("hwpx:analyze", async (_event, filePath: string) => runAnalyzeWorker(filePath));

  ipcMain.handle(
    "hwpx:optimize",
    async (
      _event,
      input: { filePath: string; mode: OptimizationMode; outputDirectory?: string; actions?: string[] }
    ) => {
      if (activeOptimizeWorker) {
        throw new Error("Another optimization is already running.");
      }
      const settings = await loadSettings();
      return runOptimizeWorker({ ...input, settings }, (progress) => {
        mainWindow?.webContents.send("hwpx:optimize-progress", progress);
      });
    }
  );

  ipcMain.handle("hwpx:cancel-optimize", async () => {
    const worker = activeOptimizeWorker;
    if (!worker) return { cancelled: false };
    await worker.terminate();
    mainWindow?.webContents.send("hwpx:optimize-progress", { percent: 0, item: "Optimization cancelled" });
    return { cancelled: true };
  });

  ipcMain.handle("hwpx:verify", async (_event, filePath: string) => verifyDesktopFile(filePath));

  ipcMain.handle(
    "hwpx:image-preview",
    async (_event, input: { originalPath: string; optimizedPath: string; maxItems?: number }) =>
      previewImageDiffs(input.originalPath, input.optimizedPath, { maxItems: input.maxItems })
  );

  ipcMain.handle("shell:show-item", async (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
  });

  ipcMain.handle("shell:open-path", async (_event, filePath: string) => shell.openPath(filePath));
}

async function loadSettings(): Promise<DesktopSettings> {
  try {
    const raw = await readFileFs(settingsPath(), "utf8");
    return { ...defaultDesktopSettings, ...JSON.parse(raw) };
  } catch {
    return defaultDesktopSettings;
  }
}

async function saveSettings(patch: Partial<DesktopSettings>): Promise<DesktopSettings> {
  const current = await loadSettings();
  const next = { ...current, ...patch };
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(settingsPath(), JSON.stringify(next, null, 2));
  return next;
}

function settingsPath(): string {
  return join(app.getPath("userData"), "settings.json");
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
    appReady?: string;
    preloadApi?: string;
    settingsOpen?: boolean;
    settingsOutputButton?: string;
    settingsOutputResetButton?: string;
  };

  if (result.title !== "HWPX 문서 최적화") {
    throw new Error(`Desktop smoke failed: unexpected title ${String(result.title)}`);
  }
  if (result.fileName !== "HWPX 파일을 여기에 끌어다 놓으세요") {
    throw new Error(`Desktop smoke failed: renderer did not load expected start view`);
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
        progressCount: progress.length
      };
    })()
  `)) as {
    originalSize?: number;
    outputPath?: string;
    reportPath?: string;
    verified?: boolean;
    progressCount?: number;
  };

  if (!workflow.originalSize || workflow.originalSize <= 0) {
    throw new Error("Desktop smoke failed: analysis did not return a document size");
  }
  if (!workflow.outputPath?.endsWith(".optimized.hwpx")) {
    throw new Error(`Desktop smoke failed: unexpected output path ${String(workflow.outputPath)}`);
  }
  if (!workflow.reportPath?.endsWith(".report.json")) {
    throw new Error(`Desktop smoke failed: report path was not returned`);
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
