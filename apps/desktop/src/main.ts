import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import type { OpenDialogOptions } from "electron";
import { mkdir, readFile as readFileFs, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import {
  analyzeDesktopFile,
  defaultDesktopSettings,
  verifyDesktopFile
} from "./main/desktopService.js";
import type { DesktopOptimizeResult } from "./main/desktopService.js";
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
    title: "HWPX Optimizer",
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
    process.exitCode = 1;
    app.quit();
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

function registerIpc(): void {
  ipcMain.handle("dialog:select-hwpx", async () => {
    const options: OpenDialogOptions = {
      properties: ["openFile"],
      filters: [{ name: "HWPX documents", extensions: ["hwpx"] }]
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0] ?? null;
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

  ipcMain.handle("hwpx:analyze", async (_event, filePath: string) => analyzeDesktopFile(filePath));

  ipcMain.handle(
    "hwpx:optimize",
    async (_event, input: { filePath: string; mode: OptimizationMode; outputDirectory?: string }) => {
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
    if (!activeOptimizeWorker) return { cancelled: false };
    await activeOptimizeWorker.terminate();
    activeOptimizeWorker = null;
    mainWindow?.webContents.send("hwpx:optimize-progress", { percent: 0, item: "Optimization cancelled" });
    return { cancelled: true };
  });

  ipcMain.handle("hwpx:verify", async (_event, filePath: string) => verifyDesktopFile(filePath));

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
  const result = (await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      let attempts = 0;
      const poll = () => {
        attempts += 1;
        if (document.body.dataset.appReady === "true" || attempts > 50) {
          resolve({
            title: document.title,
            fileName: document.getElementById("file-name")?.textContent,
            appReady: document.body.dataset.appReady,
            preloadApi: document.body.dataset.preloadApi
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
  };

  if (result.title !== "HWPX Optimizer") {
    throw new Error(`Desktop smoke failed: unexpected title ${String(result.title)}`);
  }
  if (result.fileName !== "Drop an HWPX file") {
    throw new Error(`Desktop smoke failed: renderer did not load expected start view`);
  }
  if (result.appReady !== "true" || result.preloadApi !== "ready") {
    throw new Error(`Desktop smoke failed: renderer/preload init did not complete`);
  }
}

function runOptimizeWorker(
  input: { filePath: string; mode: OptimizationMode; outputDirectory?: string; settings: DesktopSettings },
  onProgress: (progress: { percent: number; item: string }) => void
): Promise<DesktopOptimizeResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(join(import.meta.dirname, "main", "optimizeWorker.js"), { workerData: input });
    activeOptimizeWorker = worker;

    worker.on("message", (message: WorkerMessage) => {
      if (message.type === "progress") {
        onProgress({ percent: message.percent, item: message.item });
      } else if (message.type === "complete") {
        activeOptimizeWorker = null;
        onProgress({ percent: 100, item: "Optimization complete" });
        resolve(message.result);
      } else if (message.type === "error") {
        activeOptimizeWorker = null;
        reject(new Error(message.message));
      }
    });
    worker.on("error", (error) => {
      activeOptimizeWorker = null;
      reject(error);
    });
    worker.on("exit", (code) => {
      if (activeOptimizeWorker === worker) {
        activeOptimizeWorker = null;
        if (code !== 0) reject(new Error("Optimization cancelled."));
      }
    });
  });
}

type WorkerMessage =
  | { type: "progress"; percent: number; item: string }
  | { type: "complete"; result: DesktopOptimizeResult }
  | { type: "error"; message: string };
