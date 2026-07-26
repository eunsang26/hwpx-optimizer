import { describe, expect, it } from "vitest";
import { createAnalysisReport, createOptimizationReport } from "../src/report.js";
import type { OptimizationOpportunity, PackageAnalysis } from "../src/types.js";

describe("optimization reports", () => {
  it("projects target status and carries diagnostic candidate fields", () => {
    const report = createAnalysisReport(
      {
        ...analysisFixture,
        nearDuplicateImages: [
          {
            hash: "near",
            paths: ["BinData/a.jpg", "BinData/c.jpg"],
            count: 2,
            totalBytes: 300,
            wastedBytes: 120,
            maxDistance: 4,
            reason: "Images have similar average hashes and should be reviewed before manual consolidation."
          }
        ],
        resourceDiagnostics: [
          {
            type: "large-font",
            kind: "font",
            paths: ["BinData/font.ttf"],
            sizeBytes: 2_000_000,
            reason: "Embedded font is large; review whether it is required."
          }
        ]
      },
      10_000,
      [
        opportunity({
          action: "strip-metadata",
          target: "BinData/a.jpg",
          estimatedSavingBytes: 2_000,
          beforeSize: 3_000,
          afterSize: 1_000
        })
      ],
      { targetBytes: 8_500 }
    );

    expect(report.targetBytes).toBe(8_500);
    expect(report.targetStatus).toBe("met");
    expect(report.targetMissReason).toBeUndefined();
    expect(report.nearDuplicateImages).toHaveLength(1);
    expect(report.resourceDiagnostics).toHaveLength(1);
  });

  it("marks already-under only when the optimized output also stays under the target", () => {
    const under = createOptimizationReport({
      analysis: analysisFixture,
      originalSize: 8_000,
      optimizedSize: 7_500,
      planned: [],
      applied: [],
      skipped: [],
      targetBytes: 10_000
    });
    expect(under.targetStatus).toBe("already-under-target");

    const grewPastTarget = createOptimizationReport({
      analysis: analysisFixture,
      originalSize: 8_000,
      optimizedSize: 12_000,
      planned: [],
      applied: [],
      skipped: [],
      targetBytes: 10_000,
      targetMissReason: "Candidate grew past the submission target."
    });
    expect(grewPastTarget.targetStatus).toBe("missed");
    expect(grewPastTarget.targetMissReason).toContain("grew past");
  });

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
    expect(report.categorySizes).toEqual(analysisFixture.categorySizes);
    expect(report.duplicateImages).toEqual(analysisFixture.duplicateImages);
    expect(report.sameVisualDuplicateImages).toEqual(analysisFixture.sameVisualDuplicateImages);
    expect(report.unusedBinData).toEqual(analysisFixture.unusedBinData);
    expect(report.riskyResources).toEqual(analysisFixture.riskyResources);
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
  categorySizes: {
    xml: 10_000,
    image: 0,
    font: 0,
    ole: 0,
    bindata: 0,
    other: 0
  },
  images: [],
  duplicateImages: [
    {
      hash: "abc",
      paths: ["BinData/a.png", "BinData/b.png"],
      count: 2,
      totalBytes: 200,
      wastedBytes: 100
    }
  ],
  sameVisualDuplicateImages: [],
  unusedBinData: [{ path: "BinData/unused.bin", kind: "bindata", size: 50 }],
  riskyResources: [{ path: "Object/embedded.ole", kind: "ole", size: 10, reason: "OLE object" }]
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
