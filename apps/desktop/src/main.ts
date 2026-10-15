import type { BrowserWindow as BrowserWindowInstance, OpenDialogOptions } from "electron";
import type { DesktopImagePreviewInput } from "./shared/imagePreview.js";
type BrowserWindow = BrowserWindowInstance;
type ElectronApi = typeof import("electron");

const electronApi = (globalThis as { __hwpxOptimizerElectron?: ElectronApi }).__hwpxOptimizerElectron;
if (!electronApi) {
  throw new Error("Electron API bridge was not initialized.");
}

const { app, BrowserWindow: BrowserWindowClass, dialog, ipcMain, shell, session, Menu } = electronApi;
if (app.isPackaged && process.platform !== "win32") {
  throw new Error("HWPX Optimizer packaged desktop builds support Windows only.");
}
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DesktopDocumentController } from "./main/documentController.js";
import type { DesktopOptimizeRequest, DesktopBatchReportRequest } from "./main/documentController.js";
import { DesktopSettingsStore } from "./main/settingsStore.js";
import type { DesktopSettingsPatch } from "./main/desktopService.js";
import { DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT } from "./shared/windowConfig.js";

let mainWindow: BrowserWindow | null = null;
const documents = new DesktopDocumentController(loadSettings);
const permissions = documents.permissions;
let quitAfterOperations = false;
const settingsStore = new DesktopSettingsStore(() => join(app.getPath("userData"), "settings.json"));
// Packaged Windows EXEs treat unknown `--flags` as Chromium switches ("bad option").
// Prefer HWPX_OPT_SMOKE_TEST=1 for packaged smoke; keep argv for Linux `electron` launches.
const isSmokeTest =
  process.argv.includes("--smoke-test") || process.env.HWPX_OPT_SMOKE_TEST === "1";
const smoke = isSmokeTest
  ? (await import("./main/smoke/runtime.js")).createDesktopSmokeRuntime(app, session) : undefined;
if (process.platform === "win32") {
  app.setAppUserModelId("local.hwpxoptimizer.app");
}

async function createWindow(): Promise<BrowserWindow> {
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindowClass({
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
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

  smoke?.observeWindow(mainWindow);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event: Electron.Event) => {
    event.preventDefault();
  });

  await mainWindow.loadURL(pathToFileURL(join(import.meta.dirname, "index.html")).href);
  return mainWindow;
}

app.whenReady()
  .then(async () => {
    blockExternalNetworkRequests();
    await smoke?.prepareSession();
    if (process.env.HWPX_OPT_EXPECT_PACKAGED === "1" && !app.isPackaged) throw new Error("Expected an actual packaged desktop executable.");
    registerIpc();
    const window = await createWindow();
    if (!isSmokeTest) void documents.warm();

    if (smoke) {
      await smoke.run(window, documents);
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
  app.quit();
});

app.on("before-quit", (event) => {
  if (documents.busy || settingsStore.busy) {
    event.preventDefault();
    if (!quitAfterOperations) {
      quitAfterOperations = true;
      void documents.close().finally(() => settingsStore.close()).finally(() => app.quit());
    }
    return;
  }
  void documents.close();
  void settingsStore.close();
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
    if (selected) await permissions.registerInput(selected);
    return selected;
  });

  ipcMain.handle("dialog:select-hwpx-many", async () => {
    if (smoke?.selection.paths) {
      for (const filePath of smoke.selection.paths) {
        await permissions.registerInput(filePath);
      }
      if (smoke.selection.delivery) smoke.selection.delivery.consumed = true;
      return [...smoke.selection.paths];
    }
    const options: OpenDialogOptions = {
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "HWPX 문서", extensions: ["hwpx"] }]
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    if (result.canceled) return null;
    for (const filePath of result.filePaths) {
      await permissions.registerInput(filePath);
    }
    return result.filePaths;
  });

  ipcMain.handle("dialog:select-hwpx-folder", async () => {
    const options: OpenDialogOptions = { properties: ["openDirectory"] };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    const directory = result.filePaths[0];
    await permissions.registerOutputDirectory(directory);
    const entries = await readdir(directory, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && /\.hwpx$/i.test(entry.name))
      .map((entry) => join(directory, entry.name))
      .sort();
    for (const filePath of files) {
      await permissions.registerInput(filePath);
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
    if (selected) await permissions.registerOutputDirectory(selected);
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
      registered.push(await permissions.registerInput(filePath));
    }
    return registered;
  });

  ipcMain.handle("hwpx:analyze", (_event, filePath: string, options?: { analysisMode?: "quick" | "deep" }) =>
    documents.analyze(filePath, options));
  ipcMain.handle("hwpx:optimize", (_event, input: DesktopOptimizeRequest) => documents.optimize(input, progress => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("hwpx:optimize-progress", progress);
  }));
  ipcMain.handle("hwpx:cancel-optimize", () => documents.cancel("optimize"));
  ipcMain.handle("hwpx:cancel-analyze", () => documents.cancel("analyze"));
  ipcMain.handle("hwpx:verify", (_event, filePath: string) => documents.verify(filePath));
  ipcMain.handle("hwpx:save-batch-report", (_event, input: DesktopBatchReportRequest) => documents.saveBatchReport(input));
  ipcMain.handle("hwpx:image-preview", (_event, input: DesktopImagePreviewInput) => documents.preview(input));

  ipcMain.handle("shell:show-item", async (_event, filePath: string) => {
    shell.showItemInFolder(await permissions.requireGenerated(filePath));
  });

  ipcMain.handle("shell:open-path", async (_event, filePath: string) => shell.openPath(await permissions.requireGenerated(filePath)));
}

function loadSettings() { return settingsStore.load(); }
function saveSettings(patch: DesktopSettingsPatch) { return settingsStore.save(patch); }

function blockExternalNetworkRequests(): void {
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
    (details, callback) => {
      smoke?.requestBlocked(details.url);
      callback({ cancel: true });
    }
  );
}
