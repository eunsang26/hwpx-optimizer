import { contextBridge, ipcRenderer } from "electron";

const api = {
  selectHwpx: (): Promise<string | null> => ipcRenderer.invoke("dialog:select-hwpx"),
  selectDirectory: (): Promise<string | null> => ipcRenderer.invoke("dialog:select-directory"),
  loadSettings: () => ipcRenderer.invoke("settings:load"),
  saveSettings: (patch: Record<string, unknown>) => ipcRenderer.invoke("settings:save", patch),
  analyze: (filePath: string) => ipcRenderer.invoke("hwpx:analyze", filePath),
  optimize: (input: { filePath: string; mode: "safe" | "balanced" | "aggressive"; outputDirectory?: string }) =>
    ipcRenderer.invoke("hwpx:optimize", input),
  verify: (filePath: string) => ipcRenderer.invoke("hwpx:verify", filePath),
  showItem: (filePath: string) => ipcRenderer.invoke("shell:show-item", filePath),
  openPath: (filePath: string) => ipcRenderer.invoke("shell:open-path", filePath)
};

contextBridge.exposeInMainWorld("hwpxOptimizer", api);

export type HwpxOptimizerApi = typeof api;
