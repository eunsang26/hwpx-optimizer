const { contextBridge, ipcRenderer, webUtils } = require("electron");

const api = {
  selectHwpx: () => ipcRenderer.invoke("dialog:select-hwpx"),
  selectHwpxMany: () => ipcRenderer.invoke("dialog:select-hwpx-many"),
  selectHwpxFolder: () => ipcRenderer.invoke("dialog:select-hwpx-folder"),
  selectDirectory: () => ipcRenderer.invoke("dialog:select-directory"),
  registerDroppedHwpxFiles: (files) => {
    const paths = Array.from(files)
      .map((file) => pathForDroppedFile(file))
      .filter((path) => path.length > 0);
    return ipcRenderer.invoke("hwpx:register-dropped-paths", paths);
  },
  loadSettings: () => ipcRenderer.invoke("settings:load"),
  saveSettings: (patch) => ipcRenderer.invoke("settings:save", patch),
  analyze: (filePath) => ipcRenderer.invoke("hwpx:analyze", filePath),
  optimize: (input) => ipcRenderer.invoke("hwpx:optimize", input),
  cancelAnalyze: () => ipcRenderer.invoke("hwpx:cancel-analyze"),
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

function pathForDroppedFile(file) {
  if (!file) return "";
  try {
    return webUtils.getPathForFile(file) ?? "";
  } catch {
    return "";
  }
}
