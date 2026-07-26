import { describe, expect, it } from "vitest";
import { projectPackageSizeFromOpportunities } from "../src/projectPackageSize.js";
import type { HwpxPackage, OptimizationOpportunity } from "../src/types.js";

describe("projectPackageSizeFromOpportunities", () => {
  it("projects ZIP bytes from entry after-sizes instead of subtracting savings from the package", () => {
    const pkg: HwpxPackage = {
      entries: [
        { path: "Contents/section0.xml", data: Buffer.alloc(1_000_000), size: 1_000_000, kind: "xml" },
        { path: "BinData/a.bmp", data: Buffer.alloc(10_000_000), size: 10_000_000, kind: "image" },
        { path: "BinData/b.jpg", data: Buffer.alloc(5_000_000), size: 5_000_000, kind: "image" }
      ]
    };
    const opportunities: OptimizationOpportunity[] = [
      {
        id: "convert-bmp-to-png:BinData/a.bmp",
        label: "Convert BMP to PNG",
        action: "convert-bmp-to-png",
        target: "BinData/a.bmp",
        beforeSize: 10_000_000,
        afterSize: 1_000_000,
        estimatedSavingBytes: 9_000_000,
        confidence: "exact",
        risk: "medium",
        visualImpact: "low",
        defaultEnabledIn: ["balanced", "aggressive"]
      },
      {
        id: "resize-jpeg:BinData/b.jpg",
        label: "Resize JPEG",
        action: "resize-jpeg",
        target: "BinData/b.jpg",
        beforeSize: 5_000_000,
        afterSize: 400_000,
        estimatedSavingBytes: 4_600_000,
        confidence: "exact",
        risk: "medium",
        visualImpact: "medium",
        defaultEnabledIn: ["balanced", "aggressive"]
      }
    ];

    const projected = projectPackageSizeFromOpportunities(pkg, opportunities);
    // Naive package-minus-entry-savings under-shoots once compressibility changes.
    const naivePackageMinusSavings = 12_000_000 - 13_600_000;
    expect(naivePackageMinusSavings).toBeLessThan(projected);
    expect(projected).toBeGreaterThan(1_000_000);
    expect(projected).toBeLessThan(3_000_000);
  });

  it("uses a lower PNG pack factor for palette output", () => {
    const pkg: HwpxPackage = {
      entries: [{ path: "BinData/a.png", data: Buffer.alloc(2_000_000), size: 2_000_000, kind: "image" }]
    };
    const opportunities: OptimizationOpportunity[] = [
      {
        id: "resize-png:BinData/a.png",
        label: "Resize PNG",
        action: "resize-png",
        target: "BinData/a.png",
        beforeSize: 2_000_000,
        afterSize: 1_000_000,
        estimatedSavingBytes: 1_000_000,
        confidence: "exact",
        risk: "medium",
        visualImpact: "low",
        defaultEnabledIn: ["aggressive"]
      }
    ];
    const balanced = projectPackageSizeFromOpportunities(pkg, opportunities);
    const aggressive = projectPackageSizeFromOpportunities(pkg, opportunities, { palettePng: true });
    expect(aggressive).toBeLessThan(balanced);
  });
});
