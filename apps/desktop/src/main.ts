import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import type { OpenDialogOptions } from "electron";
import { existsSync } from "node:fs";
import { mkdir, readFile, readFile as readFileFs, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import {
  analyzeHwpxBuffer,
  optimizeHwpxBufferAggressive,
  optimizeHwpxBufferBalanced,
  optimizeHwpxBufferSafe,
  verifyHwpxOutput
} from "@hwpx-optimizer/core";
import type { OptimizationReport } from "@hwpx-optimizer/core";

type OptimizationMode = "safe" | "balanced" | "aggressive";

type DesktopSettings = {
  defaultMode: OptimizationMode;
  saveNextToOriginal: boolean;
  saveReport: boolean;
  preventOverwrite: boolean;
  showAggressiveWarning: boolean;
  outputDirectory?: string;
};

const defaultSettings: DesktopSettings = {
  defaultMode: "safe",
  saveNextToOriginal: true,
  saveReport: true,
  preventOverwrite: true,
  showAggressiveWarning: true
};

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

  ipcMain.handle("hwpx:analyze", async (_event, filePath: string) => {
    const report = await analyzeHwpxBuffer(await readFile(filePath));
    return { filePath, report };
  });

  ipcMain.handle(
    "hwpx:optimize",
    async (_event, input: { filePath: string; mode: OptimizationMode; outputDirectory?: string }) => {
      const settings = await loadSettings();
      const source = await readFile(input.filePath);
      const result = await optimizeByMode(source, input.mode);
      const outputPath = nextOutputPath(input.filePath, input.outputDirectory ?? settings.outputDirectory, settings);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, result.output);

      let reportPath: string | undefined;
      if (settings.saveReport) {
        reportPath = `${outputPath}.report.json`;
        await writeFile(reportPath, JSON.stringify(result.report, null, 2));
      }

      await verifyHwpxOutput(result.output);
      return { outputPath, reportPath, report: result.report };
    }
  );

  ipcMain.handle("hwpx:verify", async (_event, filePath: string) => {
    await verifyHwpxOutput(await readFile(filePath));
    return { ok: true };
  });

  ipcMain.handle("shell:show-item", async (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
  });

  ipcMain.handle("shell:open-path", async (_event, filePath: string) => shell.openPath(filePath));
}

async function optimizeByMode(
  input: Buffer,
  mode: OptimizationMode
): Promise<{ output: Buffer; report: OptimizationReport }> {
  if (mode === "safe") return optimizeHwpxBufferSafe(input);
  if (mode === "aggressive") return optimizeHwpxBufferAggressive(input);
  return optimizeHwpxBufferBalanced(input);
}

function nextOutputPath(filePath: string, outputDirectory: string | undefined, settings: DesktopSettings): string {
  const parsedExt = extname(filePath);
  const base = basename(filePath, parsedExt);
  const dir = settings.saveNextToOriginal || !outputDirectory ? dirname(filePath) : outputDirectory;
  const first = join(dir, `${base}.optimized.hwpx`);
  if (!settings.preventOverwrite || !existsSync(first)) return first;

  for (let index = 2; index < 1000; index += 1) {
    const candidate = join(dir, `${base}.optimized-${index}.hwpx`);
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error("Could not create a non-overwriting output path.");
}

async function loadSettings(): Promise<DesktopSettings> {
  try {
    const raw = await readFileFs(settingsPath(), "utf8");
    return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    return defaultSettings;
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
