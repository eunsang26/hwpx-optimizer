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
    expect(plan.actionRows.map((row) => [row.priority, row.action, row.savingLabel])).toEqual([
      [1, "consolidate-duplicate-images", "3.00 MiB"],
      [2, "strip-metadata", "500.0 KiB"],
      [3, "clean-shape-comment", "500.0 KiB"],
      [4, "resize-jpeg", "8.00 MiB"]
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

  it("keeps automatic plan kind when action overrides match defaults", () => {
    const plan = createSubmissionPlan({
      report: reportFixture,
      limit: { id: "mb20" },
      preservation: "recommended",
      actionOverrides: { "resize-jpeg": true }
    });

    expect(plan.kind).toBe("automatic");
    expect(plan.selectedActions).toContain("resize-jpeg");
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

  it("does not mark the target met when the displayed expected size misses it", () => {
    const plan = createSubmissionPlan({
      report: {
        ...reportFixture,
        originalSize: 20.1 * MIB,
        opportunityGroups: [
          {
            action: "strip-metadata",
            label: "Strip metadata",
            count: 1,
            estimatedSavingBytes: 100 * KIB,
            beforeSize: MIB,
            afterSize: MIB - 100 * KIB,
            confidence: "estimated",
            risk: "safe",
            visualImpact: "none",
            defaultEnabledIn: ["balanced", "aggressive"],
            targets: ["BinData/a.jpg"]
          }
        ]
      },
      limit: { id: "mb20" },
      preservation: "recommended",
      actionOverrides: {}
    });

    expect(plan.expectedSavingLabel).toBe("0 B");
    expect(plan.expectedSizeLabel).toBe("20.10 MiB");
    expect(plan.targetStatus).toBe("target-missed");
    expect(plan.targetStatusLabel).toBe("목표 미달 가능");
  });

  it("renders individual priority rows instead of hiding work inside broad buckets", () => {
    const plan = createSubmissionPlan({
      report: {
        ...reportFixture,
        opportunityGroups: [
          {
            action: "resize-jpeg",
            label: "Resize JPEG",
            count: 2,
            estimatedSavingBytes: 2 * MIB,
            beforeSize: 4 * MIB,
            afterSize: 2 * MIB,
            confidence: "estimated",
            risk: "medium",
            visualImpact: "medium",
            defaultEnabledIn: ["balanced", "aggressive"],
            targets: ["BinData/a.jpg", "BinData/b.jpg"]
          },
          {
            action: "resize-png",
            label: "Resize PNG",
            count: 1,
            estimatedSavingBytes: MIB,
            beforeSize: 2 * MIB,
            afterSize: MIB,
            confidence: "estimated",
            risk: "medium",
            visualImpact: "medium",
            defaultEnabledIn: ["aggressive"],
            targets: ["BinData/c.png"]
          }
        ]
      },
      limit: { id: "mb20" },
      preservation: "recommended",
      actionOverrides: { "resize-png": true }
    });

    expect(plan.actionRows).toHaveLength(2);
    expect(plan.actionRows.map((row) => row.action)).toEqual(["resize-jpeg", "resize-png"]);
    expect(plan.actionRows[0]).toEqual(
      expect.objectContaining({
        priority: 1,
        label: "큰 JPEG 리사이즈",
        count: 2,
        checked: true,
        savingBytes: 2 * MIB,
        savingLabel: "2.00 MiB"
      })
    );
    expect(plan.selectedActions).toEqual(["resize-jpeg", "resize-png"]);
  });

  it("keeps unchecked priority row savings visible while excluding them from the live total", () => {
    const plan = createSubmissionPlan({
      report: {
        ...reportFixture,
        opportunityGroups: [
          {
            action: "resize-jpeg",
            label: "Resize JPEG",
            count: 2,
            estimatedSavingBytes: 2 * MIB,
            beforeSize: 4 * MIB,
            afterSize: 2 * MIB,
            confidence: "estimated",
            risk: "medium",
            visualImpact: "medium",
            defaultEnabledIn: ["balanced", "aggressive"],
            targets: ["BinData/a.jpg", "BinData/b.jpg"]
          },
          {
            action: "resize-png",
            label: "Resize PNG",
            count: 1,
            estimatedSavingBytes: MIB,
            beforeSize: 2 * MIB,
            afterSize: MIB,
            confidence: "estimated",
            risk: "medium",
            visualImpact: "medium",
            defaultEnabledIn: ["aggressive"],
            targets: ["BinData/c.png"]
          }
        ]
      },
      limit: { id: "mb20" },
      preservation: "recommended",
      actionOverrides: {}
    });

    expect(plan.actionRows).toHaveLength(2);
    expect(plan.actionRows[0]).toEqual(
      expect.objectContaining({
        action: "resize-jpeg",
        checked: true,
        selectedActions: ["resize-jpeg"],
        savingBytes: 2 * MIB,
        savingLabel: "2.00 MiB"
      })
    );
    expect(plan.actionRows[1]).toEqual(
      expect.objectContaining({
        action: "resize-png",
        checked: false,
        selectedActions: [],
        savingBytes: MIB,
        savingLabel: "1.00 MiB"
      })
    );
    expect(plan.expectedSavingBytes).toBe(2 * MIB);
    expect(plan.selectedActions).toEqual(["resize-jpeg"]);
  });

  it("orders priority rows deterministically when input opportunities are not sorted", () => {
    const plan = createSubmissionPlan({
      report: {
        ...reportFixture,
        opportunityGroups: [
          {
            action: "resize-png",
            label: "Resize PNG",
            count: 1,
            estimatedSavingBytes: MIB,
            beforeSize: 2 * MIB,
            afterSize: MIB,
            confidence: "estimated",
            risk: "medium",
            visualImpact: "medium",
            defaultEnabledIn: ["aggressive"],
            targets: ["BinData/c.png"]
          },
          {
            action: "resize-jpeg",
            label: "Resize JPEG",
            count: 2,
            estimatedSavingBytes: 2 * MIB,
            beforeSize: 4 * MIB,
            afterSize: 2 * MIB,
            confidence: "estimated",
            risk: "medium",
            visualImpact: "medium",
            defaultEnabledIn: ["balanced", "aggressive"],
            targets: ["BinData/a.jpg", "BinData/b.jpg"]
          }
        ]
      },
      limit: { id: "mb20" },
      preservation: "recommended",
      actionOverrides: {}
    });

    expect(plan.actionRows.map((row) => row.action)).toEqual(["resize-jpeg", "resize-png"]);
    expect(plan.selectedActions).toEqual(["resize-jpeg"]);
  });

  it("uses user-facing labels for the automatic priority table", () => {
    const plan = createSubmissionPlan({
      report: reportFixture,
      limit: { id: "mb20" },
      preservation: "recommended",
      actionOverrides: {}
    });

    expect(plan.actionRows.map((row) => row.label)).toEqual([
      "중복 이미지 참조 정리",
      "불필요한 이미지 정보 제거",
      "작성자·편집 흔적 정리",
      "큰 JPEG 리사이즈"
    ]);
    expect(plan.actionRows.map((row) => row.savingLabel)).toEqual(["3.00 MiB", "500.0 KiB", "500.0 KiB", "8.00 MiB"]);
  });

  it("does not double-count overlapping targets when estimating whether the target will pass", () => {
    const plan = createSubmissionPlan({
      report: {
        ...reportFixture,
        originalSize: 20 * MIB,
        opportunityGroups: [
          {
            action: "resize-jpeg",
            label: "Resize JPEG",
            count: 1,
            estimatedSavingBytes: 10 * MIB,
            beforeSize: 15 * MIB,
            afterSize: 5 * MIB,
            confidence: "estimated",
            risk: "medium",
            visualImpact: "medium",
            defaultEnabledIn: ["balanced", "aggressive"],
            targets: ["BinData/a.jpg"]
          },
          {
            action: "strip-metadata",
            label: "Strip metadata",
            count: 1,
            estimatedSavingBytes: 9 * MIB,
            beforeSize: 10 * MIB,
            afterSize: MIB,
            confidence: "estimated",
            risk: "safe",
            visualImpact: "none",
            defaultEnabledIn: ["balanced", "aggressive"],
            targets: ["BinData/a.jpg"]
          }
        ]
      },
      limit: { id: "custom", customBytes: 5 * MIB },
      preservation: "recommended",
      actionOverrides: {}
    });

    expect(plan.expectedSavingBytes).toBe(10 * MIB);
    expect(plan.expectedSizeLabel).toBe("10.00 MiB");
    expect(plan.targetStatus).toBe("target-missed");
  });

  it("surfaces target-aware and review-only diagnostics in the automatic plan", () => {
    const plan = createSubmissionPlan({
      report: {
        ...reportFixture,
        nearDuplicateImages: [
          {
            hash: "near",
            paths: ["BinData/a.jpg", "BinData/b.jpg"],
            count: 2,
            totalBytes: 2 * MIB,
            wastedBytes: MIB,
            maxDistance: 4,
            reason: "Images have similar average hashes and should be reviewed before manual consolidation."
          }
        ],
        resourceDiagnostics: [
          {
            type: "large-ole",
            kind: "ole",
            paths: ["BinData/embedded.ole"],
            sizeBytes: 6 * MIB,
            reason: "Large OLE or attachment resource contributes materially to document size."
          }
        ]
      },
      limit: { id: "mb10" },
      preservation: "recommended",
      actionOverrides: {}
    });

    expect(plan.planNotes).toEqual([
      expect.objectContaining({
        kind: "target",
        label: "목표 용량 기반 추가 압축",
        detail: expect.stringContaining("JPEG 품질")
      }),
      expect.objectContaining({
        kind: "quality",
        label: "이미지 품질 자동 검증",
        detail: expect.stringContaining("PSNR/SSIM")
      }),
      expect.objectContaining({
        kind: "review",
        label: "유사 이미지 확인 필요",
        detail: expect.stringContaining("자동 병합하지 않음")
      }),
      expect.objectContaining({
        kind: "review",
        label: "폰트/OLE 용량 확인",
        detail: expect.stringContaining("자동 제거하지 않음")
      })
    ]);
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
  nearDuplicateImages: [],
  unusedBinData: [],
  riskyResources: [],
  resourceDiagnostics: [],
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
