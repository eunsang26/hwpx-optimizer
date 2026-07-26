import { describe, expect, it } from "vitest";
import type { OptimizationReport } from "@hwpx-optimizer/core";
import {
  createSubmissionPlan,
  modeForPreservation,
  preservationForMode,
  resolveSubmissionLimitBytes
} from "../src/shared/submissionPlan.js";

const MIB = 1024 * 1024;
const KIB = 1024;

describe("submission optimization plan", () => {
  it("maps preservation preferences to optimization modes", () => {
    expect(modeForPreservation("preserve")).toBe("safe");
    expect(modeForPreservation("recommended")).toBe("balanced");
    expect(modeForPreservation("size")).toBe("aggressive");
    expect(preservationForMode("safe")).toBe("preserve");
    expect(preservationForMode("balanced")).toBe("recommended");
    expect(preservationForMode("aggressive")).toBe("size");
  });

  it("resolves submission limits to bytes", () => {
    expect(resolveSubmissionLimitBytes({ id: "none" })).toBeUndefined();
    expect(resolveSubmissionLimitBytes({ id: "mb5" })).toBe(5 * MIB);
    expect(resolveSubmissionLimitBytes({ id: "mb10" })).toBe(10 * MIB);
    expect(resolveSubmissionLimitBytes({ id: "mb20" })).toBe(20 * MIB);
    expect(resolveSubmissionLimitBytes({ id: "mb30" })).toBe(30 * MIB);
    expect(resolveSubmissionLimitBytes({ id: "mb40" })).toBe(40 * MIB);
    expect(resolveSubmissionLimitBytes({ id: "mb41" })).toBe(41 * MIB);
    expect(resolveSubmissionLimitBytes({ id: "mb50" })).toBe(50 * MIB);
    expect(resolveSubmissionLimitBytes({ id: "mb100" })).toBe(100 * MIB);
    expect(resolveSubmissionLimitBytes({ id: "custom", customBytes: 12_345 })).toBe(12_345);
  });

  it("estimates aggressive auto plans at the quality floor", () => {
    const recommended = createSubmissionPlan({
      report: reportFixture,
      limit: { id: "mb20" },
      preservation: "recommended",
      actionOverrides: {}
    });
    const aggressive = createSubmissionPlan({
      report: reportFixture,
      limit: { id: "mb20" },
      preservation: "size",
      actionOverrides: {}
    });
    expect(aggressive.plannedJpegQuality).toBe(60);
    expect(aggressive.expectedSizeBytes).toBeLessThan(recommended.expectedSizeBytes);
    expect(aggressive.floorExpectedBytes).toBe(aggressive.expectedSizeBytes);
  });

  it("re-estimates expected size and verdict for manual JPEG quality", () => {
    const auto = createSubmissionPlan({
      report: reportFixture,
      limit: { id: "mb10" },
      preservation: "recommended",
      actionOverrides: {}
    });
    const manual = createSubmissionPlan({
      report: reportFixture,
      limit: { id: "mb10" },
      preservation: "recommended",
      actionOverrides: {},
      jpegQuality: 60
    });
    expect(manual.plannedJpegQuality).toBe(60);
    expect(manual.expectedSizeBytes).toBeLessThanOrEqual(auto.expectedSizeBytes);
  });

  it("plans balanced auto quality via target-fit search instead of a fixed 88", () => {
    const loose = createSubmissionPlan({
      report: reportFixture,
      limit: { id: "mb40" },
      preservation: "recommended",
      actionOverrides: {}
    });
    const tight = createSubmissionPlan({
      report: reportFixture,
      limit: { id: "mb10" },
      preservation: "recommended",
      actionOverrides: {}
    });
    expect(loose.plannedJpegQuality).toBeGreaterThanOrEqual(88);
    expect(tight.plannedJpegQuality).toBeLessThan(loose.plannedJpegQuality!);
    expect(tight.expectedSizeBytes).toBeLessThan(loose.expectedSizeBytes);
  });

  it("ignores manual jpeg quality in aggressive/size mode", () => {
    const plan = createSubmissionPlan({
      report: reportFixture,
      limit: { id: "mb20" },
      preservation: "size",
      actionOverrides: {},
      jpegQuality: 90
    });
    expect(plan.plannedJpegQuality).toBe(60);
    expect(plan.expectedSizeBytes).toBe(plan.floorExpectedBytes);
  });

  it("creates an automatic submission plan from report opportunities", () => {
    const plan = createSubmissionPlan({
      report: reportFixture,
      limit: { id: "none" },
      preservation: "recommended",
      actionOverrides: {}
    });

    expect(plan.kind).toBe("automatic");
    expect(plan.mode).toBe("balanced");
    // Baseline is padded toward real encodes, so claimed savings are <= raw opportunity sum.
    expect(plan.expectedSavingBytes).toBeLessThanOrEqual(11 * MIB);
    expect(plan.expectedSizeBytes).toBeGreaterThanOrEqual(17 * MIB);
    expect(plan.plannedJpegQuality).toBe(88);
    expect(plan.targetStatus).toBe("no-target");
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
    expect(plan.plannedJpegQuality).toBeDefined();
    expect(plan.expectedSizeBytes).toBeLessThanOrEqual(28 * MIB);
    expect(["제출 가능", "더 압축 필요", "기준 미달"]).toContain(plan.targetStatusLabel);
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
    expect(plan.targetStatusLabel).toBe("제출 가능");
    expect(plan.verdict).toBe("pass");
  });

  it("marks hard-miss when even the floor estimate stays over the target", () => {
    const plan = createSubmissionPlan({
      report: {
        ...reportFixture,
        originalSize: 80 * MIB,
        optimizedSize: undefined,
        aggressiveProjectedOptimizedSize: undefined,
        opportunityGroups: [
          {
            action: "strip-metadata",
            label: "Strip metadata",
            count: 1,
            estimatedSavingBytes: 200 * KIB,
            beforeSize: MIB,
            afterSize: MIB - 200 * KIB,
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

    expect(plan.plannedJpegQuality).toBe(60);
    expect(plan.verdict).toBe("hard-miss");
    expect(plan.targetStatus).toBe("target-missed");
    expect(plan.targetStatusLabel).toBe("기준 미달");
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
      limit: { id: "none" },
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
    // Live total uses only checked rows (resize-jpeg); pad may reduce claimed package savings.
    expect(plan.expectedSavingBytes).toBeGreaterThan(0);
    expect(plan.expectedSavingBytes).toBeLessThanOrEqual(2 * MIB);
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
      "EXIF 제외 이미지 정보 제거",
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
        optimizedSize: undefined,
        aggressiveProjectedOptimizedSize: undefined,
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
      limit: { id: "none" },
      preservation: "recommended",
      actionOverrides: {}
    });

    // Overlapping BinData/a.jpg opportunities must not sum to 19 MiB — max per target wins.
    expect(plan.expectedSavingBytes).toBeLessThanOrEqual(10 * MIB);
    expect(plan.expectedSavingBytes).toBeGreaterThan(5 * MIB);
    expect(plan.expectedSizeBytes).toBeGreaterThanOrEqual(10 * MIB);
    expect(plan.targetStatus).toBe("no-target");
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

    expect(plan.planNotes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "target",
          label: "목표 용량에 맞춘 품질 탐색",
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
      ])
    );
  });
});

const reportFixture: OptimizationReport = {
  originalSize: 28 * MIB,
  optimizedSize: 17 * MIB,
  aggressiveProjectedOptimizedSize: 6 * MIB,
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
