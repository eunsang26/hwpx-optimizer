import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type OptimizationMode = "safe" | "balanced" | "aggressive";
// Keep in sync with apps/desktop/src/main/desktopService.ts (DesktopSettings)
// and apps/desktop/src/shared/submissionPlan.ts (SubmissionLimit).
type SubmissionLimitId = "none" | "mb5" | "mb10" | "mb20" | "mb30" | "mb41" | "mb50" | "mb100" | "custom";
type PreservationPreference = "preserve" | "recommended" | "size";
type BatchTargetMode = "aggregate" | "per-file";

type DesktopSettings = {
  settingsVersion?: number;
  defaultMode: OptimizationMode;
  saveNextToOriginal: boolean;
  saveReport: boolean;
  preventOverwrite: boolean;
  showAggressiveWarning: boolean;
  submissionLimit: { id: SubmissionLimitId; customBytes?: number };
  preservationPreference: PreservationPreference;
  batchTargetMode: BatchTargetMode;
};

type OptimizeInput = {
  filePath: string;
  mode: OptimizationMode;
  outputDirectory?: string;
  outputMode?: "single" | "batch";
  actions?: string[];
  targetBytes?: number;
};

type ProgressCallback = (progress: { percent: number; item: string }) => void;

void listen("hwpx:tauri-dropped-files", () => {
  window.dispatchEvent(new CustomEvent("hwpx-tauri-dropped-files"));
});

const api = {
  health: () => invoke("sidecar_health"),
  selectHwpx: (): Promise<string | null> => invoke("select_hwpx"),
  selectHwpxMany: (): Promise<string[] | null> => invoke("select_hwpx_many"),
  selectHwpxFolder: (): Promise<{ directory: string; files: string[] } | null> => invoke("select_hwpx_folder"),
  selectDirectory: (): Promise<string | null> => invoke("select_directory"),
  registerDroppedHwpxFiles: async (): Promise<string[]> => invoke("consume_dropped_hwpx_files"),
  loadSettings: (): Promise<DesktopSettings> => invoke("load_settings"),
  saveSettings: (patch: Record<string, unknown>): Promise<DesktopSettings> => invoke("save_settings", { patch }),
  analyze: (filePath: string) => invoke("analyze_hwpx", { filePath }),
  optimize: (input: OptimizeInput) => invoke("optimize_hwpx", { input }),
  cancelAnalyze: () => invoke("cancel_analyze"),
  cancelOptimize: () => invoke("cancel_optimize"),
  onOptimizeProgress: (callback: ProgressCallback): (() => void) => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void listen("hwpx:optimize-progress", (event) => {
      callback(event.payload as { percent: number; item: string });
    }).then((nextUnlisten) => {
      if (active) {
        unlisten = nextUnlisten;
      } else {
        nextUnlisten();
      }
    });
    return () => {
      active = false;
      unlisten?.();
    };
  },
  verify: (filePath: string) => invoke("verify_hwpx", { filePath }),
  saveBatchReport: (input: Record<string, unknown>): Promise<{ reportPath: string }> =>
    invoke("save_batch_report", { input }),
  previewImageDiffs: (input: { originalPath: string; optimizedPath: string; maxItems?: number; maxInputBytes?: number }) =>
    invoke("preview_image_diffs", { input }),
  showItem: (filePath: string) => invoke("show_item", { filePath }),
  openPath: (filePath: string) => invoke("open_path", { filePath })
};

window.hwpxOptimizer = api;

declare global {
  interface Window {
    hwpxOptimizer: typeof api;
  }
}
