import { contextBridge, ipcRenderer, webUtils } from "electron";

const api = {
  selectHwpx: (): Promise<string | null> => ipcRenderer.invoke("dialog:select-hwpx"),
  selectHwpxMany: (): Promise<string[] | null> => ipcRenderer.invoke("dialog:select-hwpx-many"),
  selectHwpxFolder: (): Promise<{ directory: string; files: string[] } | null> =>
    ipcRenderer.invoke("dialog:select-hwpx-folder"),
  selectDirectory: (): Promise<string | null> => ipcRenderer.invoke("dialog:select-directory"),
  registerDroppedHwpxFiles: (files: File[] | FileList): Promise<string[]> => {
    const paths = Array.from(files)
      .map((file) => pathForDroppedFile(file))
      .filter((path) => path.length > 0);
    return ipcRenderer.invoke("hwpx:register-dropped-paths", paths);
  },
  loadSettings: () => ipcRenderer.invoke("settings:load"),
  saveSettings: (patch: Record<string, unknown>) => ipcRenderer.invoke("settings:save", patch),
  analyze: (filePath: string) => ipcRenderer.invoke("hwpx:analyze", filePath),
  optimize: (input: {
    filePath: string;
    mode: "safe" | "balanced" | "aggressive";
    outputDirectory?: string;
    outputMode?: "single" | "batch";
    actions?: string[];
  }) => ipcRenderer.invoke("hwpx:optimize", input),
  cancelAnalyze: () => ipcRenderer.invoke("hwpx:cancel-analyze"),
  cancelOptimize: () => ipcRenderer.invoke("hwpx:cancel-optimize"),
  onOptimizeProgress: (callback: (progress: { percent: number; item: string }) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: { percent: number; item: string }) => callback(progress);
    ipcRenderer.on("hwpx:optimize-progress", listener);
    return () => ipcRenderer.off("hwpx:optimize-progress", listener);
  },
  verify: (filePath: string) => ipcRenderer.invoke("hwpx:verify", filePath),
  previewImageDiffs: (input: { originalPath: string; optimizedPath: string; maxItems?: number; maxInputBytes?: number }) =>
    ipcRenderer.invoke("hwpx:image-preview", input),
  showItem: (filePath: string) => ipcRenderer.invoke("shell:show-item", filePath),
  openPath: (filePath: string) => ipcRenderer.invoke("shell:open-path", filePath)
};

contextBridge.exposeInMainWorld("hwpxOptimizer", api);

export type HwpxOptimizerApi = typeof api;

function pathForDroppedFile(file: File): string {
  if (!file) return "";
  try {
    return webUtils.getPathForFile(file) ?? "";
  } catch {
    return "";
  }
}
