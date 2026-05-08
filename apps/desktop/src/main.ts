import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import type { OpenDialogOptions } from "electron";
import { mkdir, readFile as readFileFs, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  analyzeDesktopFile,
  defaultDesktopSettings,
  optimizeDesktopFile,
  verifyDesktopFile
} from "./main/desktopService.js";
import type { DesktopSettings, OptimizationMode } from "./main/desktopService.js";

let mainWindow: BrowserWindow | null = null;

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 920,
    minHeight: 640,
    title: "HWPX Optimizer",
    webPreferences: {
      preload: join(import.meta.dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  await mainWindow.loadFile(join(import.meta.dirname, "index.html"));
}

app.whenReady().then(async () => {
  registerIpc();
  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
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
      const settings = await loadSettings();
      return optimizeDesktopFile({ ...input, settings });
    }
  );

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
