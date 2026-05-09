import { describe, expect, it } from "vitest";
import { createActionToggles, createAnalysisViewModel } from "../src/shared/viewModel.js";
import type { OptimizationReport } from "@hwpx-optimizer/core";

describe("desktop view model", () => {
  it("summarizes analysis results for the desktop analysis screen", () => {
    const view = createAnalysisViewModel(reportFixture);

    expect(view).toEqual({
      originalSizeLabel: "10.00 MiB",
      imageCount: 3,
      bmpCount: 1,
      metadataImageCount: 1,
      unusedResourceCount: 2,
      duplicateGroupCount: 1,
      riskyResourceCount: 1,
      estimatedSavingLabel: "3.00 MiB",
      topOpportunities: [
        { action: "resize-jpeg", count: 2, savingLabel: "2.00 MiB", risk: "medium" },
        { action: "optimize-png", count: 1, savingLabel: "1.00 MiB", risk: "safe" }
      ],
      categoryBreakdown: [
        { kind: "image", bytes: 200, ratio: 200 / 300, label: "이미지" },
        { kind: "xml", bytes: 100, ratio: 100 / 300, label: "문서 XML" }
      ],
      warnings: ["OLE objects can be user-visible."]
    });
  });

  it("creates action toggles with defaults driven by the selected mode", () => {
    const safeToggles = createActionToggles(reportFixture, "safe");
    const balancedToggles = createActionToggles(reportFixture, "balanced");
    const aggressiveToggles = createActionToggles(reportFixture, "aggressive");

    expect(safeToggles.map((toggle) => toggle.action)).toEqual(["resize-jpeg", "optimize-png"]);
    expect(safeToggles.find((toggle) => toggle.action === "resize-jpeg")?.defaultEnabledForMode).toBe(false);
    expect(safeToggles.find((toggle) => toggle.action === "optimize-png")?.defaultEnabledForMode).toBe(false);

    expect(balancedToggles.every((toggle) => toggle.defaultEnabledForMode)).toBe(true);
    expect(aggressiveToggles.every((toggle) => toggle.defaultEnabledForMode)).toBe(true);
    expect(balancedToggles[0]?.label).toBe("큰 JPEG 리사이즈");
    expect(balancedToggles[1]?.label).toBe("PNG 무손실 최적화");
  });
});

const reportFixture: OptimizationReport = {
  originalSize: 10 * 1024 * 1024,
  categorySizes: {
    xml: 100,
    image: 200,
    font: 0,
    ole: 0,
    bindata: 0,
    other: 0
  },
  images: [
    {
      path: "BinData/a.jpg",
      size: 100,
      format: "jpeg",
      hasMetadata: true,
      isBmpCandidate: false,
      displayRefs: []
    },
    {
      path: "BinData/b.bmp",
      size: 100,
      format: "bmp",
      hasMetadata: false,
      isBmpCandidate: true,
      displayRefs: []
    },
    {
      path: "BinData/c.png",
      size: 100,
      format: "png",
      hasMetadata: false,
      isBmpCandidate: false,
      displayRefs: []
    }
  ],
  duplicateImages: [{ hash: "abc", paths: ["a", "b"], count: 2, totalBytes: 200, wastedBytes: 100 }],
  sameVisualDuplicateImages: [],
  unusedBinData: [
    { path: "BinData/unused1.bin", kind: "bindata", size: 1 },
    { path: "BinData/unused2.bin", kind: "bindata", size: 1 }
  ],
  riskyResources: [{ path: "Object/a.ole", kind: "ole", size: 1, reason: "OLE objects can be user-visible." }],
  actions: { planned: [], applied: [], skipped: [] },
  opportunities: [],
  opportunityGroups: [
    {
      action: "resize-jpeg",
      label: "Resize",
      count: 2,
      estimatedSavingBytes: 2 * 1024 * 1024,
      beforeSize: 4,
      afterSize: 2,
      confidence: "exact",
      risk: "medium",
      visualImpact: "medium",
      defaultEnabledIn: ["balanced", "aggressive"],
      targets: ["a", "b"]
    },
    {
      action: "optimize-png",
      label: "PNG",
      count: 1,
      estimatedSavingBytes: 1024 * 1024,
      beforeSize: 2,
      afterSize: 1,
      confidence: "exact",
      risk: "safe",
      visualImpact: "none",
      defaultEnabledIn: ["balanced", "aggressive"],
      targets: ["c"]
    }
  ],
  warnings: []
};
