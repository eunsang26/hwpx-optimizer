import type { OptimizationReport } from "@hwpx-optimizer/core";
import { describe, expect, it } from "vitest";
import type { SubmissionPlan } from "../src/shared/submissionPlan.js";
import { resultGuidanceText } from "../src/shared/resultGuidance.js";

function report(overrides: Partial<OptimizationReport> = {}): OptimizationReport {
  return {
    originalSize: 12_000,
    optimizedSize: 9_000,
    savedBytes: 3_000,
    savedPercent: 25,
    categorySizes: { xml: 0, image: 0, font: 0, ole: 0, bindata: 0, other: 0 },
    images: [],
    duplicateImages: [],
    sameVisualDuplicateImages: [],
    nearDuplicateImages: [],
    unusedBinData: [],
    riskyResources: [],
    resourceDiagnostics: [],
    opportunityGroups: [],
    opportunities: [],
    warnings: [],
    actions: { planned: [], applied: [], skipped: [] },
    ...overrides
  };
}

function plan(overrides: Partial<SubmissionPlan> = {}): SubmissionPlan {
  return {
    kind: "automatic",
    mode: "balanced",
    originalSizeLabel: "11.72 KiB",
    expectedSavingBytes: 2_000,
    expectedSavingLabel: "1.95 KiB",
    expectedSizeBytes: 10_000,
    expectedSizeLabel: "9.77 KiB",
    savedPercentLabel: "16.67%",
    targetBytes: 8_000,
    targetLabel: "7.81 KiB",
    targetStatus: "target-missed",
    targetStatusLabel: "더 압축 필요",
    verdict: "need-more",
    verdictLabel: "더 압축 필요",
    verdictDetail: "현재 초과 · 최대 압축 시 통과 가능",
    floorExpectedBytes: 7_500,
    plannedJpegQuality: 88,
    selectedActions: [],
    actionRows: [],
    planNotes: [],
    ...overrides
  };
}

describe("result guidance", () => {
  it("summarizes target miss reasons with actionable Korean guidance", () => {
    expect(
      resultGuidanceText(
        report({
          targetBytes: 8_000,
          targetStatus: "missed",
          targetMissReason: "No quality-preserving optimization candidate reached the target.",
          actions: {
            planned: [],
            applied: [],
            skipped: [{ type: "resize-jpeg", target: "BinData/image1.jpg" }]
          }
        }),
        plan()
      )
    ).toContain("품질 보존 가능한 후보만 적용했습니다");
  });

  it("keeps manual review candidates visible in the result guidance", () => {
    expect(
      resultGuidanceText(
        report({
          targetBytes: 8_000,
          targetStatus: "met",
          nearDuplicateImages: [
            {
              hash: "abc",
              paths: ["a.png", "b.png"],
              count: 2,
              totalBytes: 2_000,
              wastedBytes: 1_000,
              maxDistance: 1,
              reason: "near duplicate"
            }
          ],
          resourceDiagnostics: [
            {
              type: "large-font",
              kind: "font",
              paths: ["BinData/font.ttf"],
              sizeBytes: 1_000,
              reason: "large font"
            }
          ]
        }),
        plan()
      )
    ).toContain("수동 확인 후보 2개는 자동 제거하지 않았습니다");
  });
});
