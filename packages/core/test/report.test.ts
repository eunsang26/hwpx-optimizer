import { describe, expect, it } from "vitest";
import { createAnalysisReport } from "../src/report.js";
import type { OptimizationOpportunity, PackageAnalysis } from "../src/types.js";

describe("optimization reports", () => {
  it("groups opportunities by action and sorts the largest savings first", () => {
    const report = createAnalysisReport(analysisFixture, 10_000, [
      opportunity({
        action: "clean-shape-comment",
        target: "Contents/section0.xml",
        estimatedSavingBytes: 100,
        beforeSize: 1_000,
        afterSize: 900,
        risk: "safe",
        visualImpact: "none",
        defaultEnabledIn: ["balanced", "aggressive"]
      }),
      opportunity({
        action: "convert-bmp-to-png",
        target: "BinData/image1.bmp",
        estimatedSavingBytes: 2_000,
        beforeSize: 3_000,
        afterSize: 1_000,
        risk: "medium",
        visualImpact: "low",
        defaultEnabledIn: ["balanced", "aggressive"]
      }),
      opportunity({
        action: "convert-bmp-to-png",
        target: "BinData/image2.bmp",
        estimatedSavingBytes: 4_000,
        beforeSize: 6_000,
        afterSize: 2_000,
        risk: "medium",
        visualImpact: "medium",
        defaultEnabledIn: ["balanced", "aggressive"]
      })
    ]);

    expect(report.opportunityGroups).toEqual([
      {
        action: "convert-bmp-to-png",
        label: "Convert BMP to PNG",
        count: 2,
        estimatedSavingBytes: 6_000,
        beforeSize: 9_000,
        afterSize: 3_000,
        confidence: "exact",
        risk: "medium",
        visualImpact: "medium",
        defaultEnabledIn: ["balanced", "aggressive"],
        targets: ["BinData/image1.bmp", "BinData/image2.bmp"]
      },
      {
        action: "clean-shape-comment",
        label: "Clean image shape comments",
        count: 1,
        estimatedSavingBytes: 100,
        beforeSize: 1_000,
        afterSize: 900,
        confidence: "exact",
        risk: "safe",
        visualImpact: "none",
        defaultEnabledIn: ["balanced", "aggressive"],
        targets: ["Contents/section0.xml"]
      }
    ]);
  });
});

const analysisFixture: PackageAnalysis = {
  totalSize: 10_000,
  entriesByKind: {
    xml: 1,
    image: 0,
    font: 0,
    ole: 0,
    bindata: 0,
    other: 0
  },
  images: []
};

function opportunity(input: Partial<OptimizationOpportunity> & Pick<OptimizationOpportunity, "action" | "target">): OptimizationOpportunity {
  const beforeSize = input.beforeSize ?? 1_000;
  const afterSize = input.afterSize ?? 500;
  return {
    id: `${input.action}:${input.target}`,
    label: input.label ?? labelForAction(input.action),
    action: input.action,
    target: input.target,
    estimatedSavingBytes: input.estimatedSavingBytes ?? beforeSize - afterSize,
    beforeSize,
    afterSize,
    confidence: input.confidence ?? "exact",
    risk: input.risk ?? "safe",
    visualImpact: input.visualImpact ?? "none",
    defaultEnabledIn: input.defaultEnabledIn ?? ["balanced"]
  };
}

function labelForAction(action: OptimizationOpportunity["action"]): string {
  if (action === "convert-bmp-to-png") return "Convert BMP to PNG";
  if (action === "clean-shape-comment") return "Clean image shape comments";
  return action;
}
