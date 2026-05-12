import type { HwpxOptimizerApi } from "./preload.js";

type DesktopSettings = {
  defaultMode: "safe" | "balanced" | "aggressive";
  saveNextToOriginal: boolean;
  saveReport: boolean;
  preventOverwrite: boolean;
  showAggressiveWarning: boolean;
  submissionLimit: { id: "none" | "mb10" | "mb20" | "mb50" | "custom"; customBytes?: number };
  preservationPreference: "preserve" | "recommended" | "size";
};

const originalSize = 89.72 * 1024 * 1024;
const optimizedSize = 4.72 * 1024 * 1024;
const savedBytes = originalSize - optimizedSize;
const previewPath = "sample2.hwpx";
const progressListeners = new Set<(progress: { percent: number; item: string }) => void>();

let settings: DesktopSettings = {
  defaultMode: "safe",
  saveNextToOriginal: true,
  saveReport: false,
  preventOverwrite: true,
  showAggressiveWarning: true,
  submissionLimit: { id: "mb20" },
  preservationPreference: "recommended"
};

const sampleReport = {
  originalSize,
  optimizedSize,
  savedBytes,
  savedPercent: (savedBytes / originalSize) * 100,
  categorySizes: {
    image: 113.39 * 1024 * 1024,
    xml: 898.6 * 1024,
    font: 0,
    ole: 0,
    bindata: 0,
    other: 2.9 * 1024
  },
  images: [
    ...Array.from({ length: 18 }, (_, index) => ({
      path: `BinData/bmp-${index + 1}.bmp`,
      size: 3.2 * 1024 * 1024,
      format: "bmp",
      width: 2400,
      height: 1800,
      hasMetadata: false,
      isBmpCandidate: true,
      displayRefs: []
    })),
    ...Array.from({ length: 6 }, (_, index) => ({
      path: `BinData/photo-${index + 1}.jpg`,
      size: 7.1 * 1024 * 1024,
      format: "jpeg",
      width: 3200,
      height: 2400,
      hasMetadata: true,
      isBmpCandidate: false,
      displayRefs: []
    })),
    ...Array.from({ length: 5 }, (_, index) => ({
      path: `BinData/image-${index + 1}.png`,
      size: 800 * 1024,
      format: "png",
      width: 1800,
      height: 1200,
      hasMetadata: index < 2,
      isBmpCandidate: false,
      displayRefs: []
    }))
  ],
  duplicateImages: [],
  sameVisualDuplicateImages: [],
  unusedBinData: [],
  riskyResources: [],
  actions: {
    planned: [],
    applied: [],
    skipped: []
  },
  opportunities: [],
  opportunityGroups: [
    {
      action: "convert-bmp-to-png",
      label: "BMP를 PNG로 변환",
      count: 18,
      estimatedSavingBytes: 58.85 * 1024 * 1024,
      beforeSize: 60 * 1024 * 1024,
      afterSize: 1.15 * 1024 * 1024,
      confidence: "estimated",
      risk: "medium",
      visualImpact: "low",
      defaultEnabledIn: ["balanced", "aggressive"],
      targets: ["BinData/bmp-1.bmp"]
    },
    {
      action: "resize-jpeg",
      label: "큰 JPEG 리사이즈",
      count: 6,
      estimatedSavingBytes: 42.62 * 1024 * 1024,
      beforeSize: 45 * 1024 * 1024,
      afterSize: 2.38 * 1024 * 1024,
      confidence: "estimated",
      risk: "medium",
      visualImpact: "low",
      defaultEnabledIn: ["balanced", "aggressive"],
      targets: ["BinData/photo-1.jpg"]
    },
    {
      action: "strip-metadata",
      label: "이미지 설명 메타데이터 정리",
      count: 7,
      estimatedSavingBytes: 113.3 * 1024,
      beforeSize: 160 * 1024,
      afterSize: 46.7 * 1024,
      confidence: "estimated",
      risk: "safe",
      visualImpact: "none",
      defaultEnabledIn: ["safe", "balanced", "aggressive"],
      targets: ["BinData/photo-1.jpg"]
    },
    {
      action: "clean-shape-comment",
      label: "작성자·편집 흔적 정리",
      count: 5,
      estimatedSavingBytes: 6.1 * 1024,
      beforeSize: 12 * 1024,
      afterSize: 5.9 * 1024,
      confidence: "estimated",
      risk: "safe",
      visualImpact: "none",
      defaultEnabledIn: ["safe", "balanced", "aggressive"],
      targets: ["Contents/section0.xml"]
    }
  ],
  warnings: ["BMP 이미지 18개 발견 — 균형/최대 압축 모드에서 PNG로 변환하면 크기를 줄일 수 있습니다."]
};

const api: HwpxOptimizerApi = {
  selectHwpx: async () => previewPath,
  selectHwpxMany: async () => [previewPath, "sample3.hwpx"],
  selectHwpxFolder: async () => ({ directory: "preview-folder", files: [previewPath, "sample3.hwpx"] }),
  selectDirectory: async () => "preview-output",
  getPathForFile: () => previewPath,
  registerDroppedHwpxFiles: async (files) =>
    Array.from(files).map(
      (file, index) => (file as File & { path?: string }).path ?? (index === 0 ? previewPath : "sample3.hwpx")
    ),
  loadSettings: async () => settings,
  saveSettings: async (patch) => {
    settings = { ...settings, ...patch };
    return settings;
  },
  analyze: async (filePath) => delay({ filePath, report: sampleReport }, 350),
  optimize: async (input) => {
    emitProgress(12, "Reading HWPX package");
    await wait(180);
    emitProgress(48, `Optimizing document in ${input.mode} mode`);
    await wait(260);
    emitProgress(82, "Verifying optimized package");
    await wait(220);
    emitProgress(100, "Done");
    return {
      outputPath: `preview-output/${input.filePath.replace(/\.hwpx$/u, ".optimized.hwpx")}`,
      reportPath: settings.saveReport ? "preview-output/sample2.report.json" : undefined,
      report: sampleReport
    };
  },
  cancelAnalyze: async () => undefined,
  cancelOptimize: async () => undefined,
  onOptimizeProgress: (callback) => {
    progressListeners.add(callback);
    return () => progressListeners.delete(callback);
  },
  verify: async () => ({ ok: true, report: sampleReport }),
  previewImageDiffs: async () => [],
  showItem: async () => undefined,
  openPath: async () => undefined
};

if (!window.hwpxOptimizer) {
  window.hwpxOptimizer = api;
}

function emitProgress(percent: number, item: string): void {
  for (const listener of progressListeners) listener({ percent, item });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function delay<T>(value: T, ms: number): Promise<T> {
  await wait(ms);
  return value;
}
