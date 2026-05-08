const { contextBridge, ipcRenderer, webUtils } = require("electron");

const api = {
  selectHwpx: () => ipcRenderer.invoke("dialog:select-hwpx"),
  selectHwpxMany: () => ipcRenderer.invoke("dialog:select-hwpx-many"),
  selectHwpxFolder: () => ipcRenderer.invoke("dialog:select-hwpx-folder"),
  selectDirectory: () => ipcRenderer.invoke("dialog:select-directory"),
  getPathForFile: (file) => {
    if (!file || typeof webUtils?.getPathForFile !== "function") return "";
    try {
      return webUtils.getPathForFile(file) ?? "";
    } catch {
      return "";
    }
  },
  loadSettings: () => ipcRenderer.invoke("settings:load"),
  saveSettings: (patch) => ipcRenderer.invoke("settings:save", patch),
  analyze: (filePath) => ipcRenderer.invoke("hwpx:analyze", filePath),
  optimize: (input) => ipcRenderer.invoke("hwpx:optimize", input),
  cancelOptimize: () => ipcRenderer.invoke("hwpx:cancel-optimize"),
  onOptimizeProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("hwpx:optimize-progress", listener);
    return () => ipcRenderer.off("hwpx:optimize-progress", listener);
  },
  verify: (filePath) => ipcRenderer.invoke("hwpx:verify", filePath),
  previewImageDiffs: (input) => ipcRenderer.invoke("hwpx:image-preview", input),
  showItem: (filePath) => ipcRenderer.invoke("shell:show-item", filePath),
  openPath: (filePath) => ipcRenderer.invoke("shell:open-path", filePath)
};

contextBridge.exposeInMainWorld("hwpxOptimizer", api);
