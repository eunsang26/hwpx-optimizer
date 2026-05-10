import { describe, expect, it } from "vitest";
import type { OptimizationReport } from "@hwpx-optimizer/core";
import {
  createSubmissionPlan,
  modeForPreservation,
  resolveSubmissionLimitBytes
} from "../src/shared/submissionPlan.js";

const MIB = 1024 * 1024;
const KIB = 1024;

describe("submission optimization plan", () => {
  it("maps preservation preferences to optimization modes", () => {
    expect(modeForPreservation("preserve")).toBe("safe");
    expect(modeForPreservation("recommended")).toBe("balanced");
    expect(modeForPreservation("size")).toBe("aggressive");
  });

  it("resolves submission limits to bytes", () => {
    expect(resolveSubmissionLimitBytes({ id: "none" })).toBeUndefined();
    expect(resolveSubmissionLimitBytes({ id: "mb10" })).toBe(10 * MIB);
    expect(resolveSubmissionLimitBytes({ id: "mb20" })).toBe(20 * MIB);
    expect(resolveSubmissionLimitBytes({ id: "mb50" })).toBe(50 * MIB);
    expect(resolveSubmissionLimitBytes({ id: "custom", customBytes: 12_345 })).toBe(12_345);
  });

  it("creates an automatic submission plan from report opportunities", () => {
    const plan = createSubmissionPlan({
      report: reportFixture,
      limit: { id: "mb20" },
      preservation: "recommended",
      actionOverrides: {}
    });

    expect(plan.kind).toBe("automatic");
    expect(plan.mode).toBe("balanced");
    expect(plan.expectedSavingLabel).toBe("11.00 MiB");
    expect(plan.expectedSizeLabel).toBe("17.00 MiB");
    expect(plan.targetStatus).toBe("target-met");
    expect(plan.targetStatusLabel).toBe("목표 달성 가능");
    expect(plan.actionRows.every((row) => row.checked)).toBe(true);
    expect(plan.actionRows.map((row) => row.savingLabel)).toEqual([
      "8.00 MiB",
      "3.00 MiB",
      "500.0 KiB",
      "500.0 KiB"
    ]);
  });

  it("creates a custom submission plan when action overrides change defaults", () => {
    const plan = createSubmissionPlan({
      report: reportFixture,
      limit: { id: "mb10" },
      preservation: "recommended",
      actionOverrides: { "resize-jpeg": false }
    });

    expect(plan.kind).toBe("custom");
    expect(plan.selectedActions).toEqual([
      "consolidate-duplicate-images",
      "strip-metadata",
      "clean-shape-comment"
    ]);
    expect(plan.expectedSizeLabel).toBe("25.00 MiB");
    expect(plan.targetStatus).toBe("target-missed");
    expect(plan.targetStatusLabel).toBe("목표 미달 가능");
  });

  it("marks plans that are already under the target", () => {
    const plan = createSubmissionPlan({
      report: { ...reportFixture, originalSize: 8 * MIB },
      limit: { id: "mb20" },
      preservation: "recommended",
      actionOverrides: {}
    });

    expect(plan.targetStatus).toBe("already-under-target");
    expect(plan.targetStatusLabel).toBe("이미 목표 이하");
  });
});

const reportFixture: OptimizationReport = {
  originalSize: 28 * MIB,
  categorySizes: {
    xml: 100,
    image: 200,
    font: 0,
    ole: 0,
    bindata: 0,
    other: 0
  },
  images: [],
  duplicateImages: [],
  sameVisualDuplicateImages: [],
  unusedBinData: [],
  riskyResources: [],
  actions: { planned: [], applied: [], skipped: [] },
  opportunities: [],
  opportunityGroups: [
    {
      action: "resize-jpeg",
      label: "Resize JPEG",
      count: 2,
      estimatedSavingBytes: 8 * MIB,
      beforeSize: 16 * MIB,
      afterSize: 8 * MIB,
      confidence: "estimated",
      risk: "medium",
      visualImpact: "medium",
      defaultEnabledIn: ["balanced", "aggressive"],
      targets: ["BinData/a.jpg", "BinData/b.jpg"]
    },
    {
      action: "consolidate-duplicate-images",
      label: "Consolidate duplicates",
      count: 1,
      estimatedSavingBytes: 3 * MIB,
      beforeSize: 6 * MIB,
      afterSize: 3 * MIB,
      confidence: "exact",
      risk: "safe",
      visualImpact: "none",
      defaultEnabledIn: ["balanced", "aggressive"],
      targets: ["BinData/c.png"]
    },
    {
      action: "strip-metadata",
      label: "Strip metadata",
      count: 2,
      estimatedSavingBytes: 500 * KIB,
      beforeSize: MIB,
      afterSize: MIB - 500 * KIB,
      confidence: "estimated",
      risk: "safe",
      visualImpact: "none",
      defaultEnabledIn: ["balanced", "aggressive"],
      targets: ["BinData/a.jpg", "BinData/d.png"]
    },
    {
      action: "clean-shape-comment",
      label: "Clean comments",
      count: 1,
      estimatedSavingBytes: 500 * KIB,
      beforeSize: MIB,
      afterSize: MIB - 500 * KIB,
      confidence: "estimated",
      risk: "safe",
      visualImpact: "none",
      defaultEnabledIn: ["balanced", "aggressive"],
      targets: ["Contents/section0.xml"]
    }
  ],
  warnings: []
};
