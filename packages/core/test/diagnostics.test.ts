import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { analyzeHwpxBuffer } from "../src/optimize.js";
import { detectEstimatedOptimizationOpportunities } from "../src/opportunities.js";
import { readHwpxPackage } from "../src/reader.js";
import { aggressiveImageProfile, balancedImageProfile } from "../src/opportunities.js";
import { createHwpxFixture } from "./fixtures.js";

describe("analysis diagnostics", () => {
  it("reports near-duplicate images without turning them into consolidation actions", async () => {
    const base = await sharp({
      create: { width: 96, height: 96, channels: 3, background: "#6688aa" }
    })
      .png()
      .toBuffer();
    const similar = await sharp(base).modulate({ brightness: 1.03 }).jpeg({ quality: 92 }).toBuffer();
    const input = await createHwpxFixture({
      entries: {
        "Contents/content.hpf": `<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest><opf:item id="image1" href="BinData/a.png" media-type="image/png"/><opf:item id="image2" href="BinData/b.jpg" media-type="image/jpeg"/></opf:manifest></opf:package>`,
        "Contents/section0.xml": `<root><hc:img binaryItemIDRef="image1" /><hc:img binaryItemIDRef="image2" /></root>`,
        "BinData/a.png": base,
        "BinData/b.jpg": similar
      }
    });

    const report = await analyzeHwpxBuffer(input);

    expect(report.nearDuplicateImages).toEqual([
      expect.objectContaining({
        paths: ["BinData/a.png", "BinData/b.jpg"],
        count: 2
      })
    ]);
    expect(report.opportunities).not.toContainEqual(
      expect.objectContaining({ action: "consolidate-duplicate-images", target: "BinData/b.jpg" })
    );
  });

  it("reports large and byte-identical font/OLE resource diagnostics without actions", async () => {
    const font = Buffer.alloc(1_200_000, 7);
    const input = await createHwpxFixture({
      entries: {
        "BinData/font1.ttf": font,
        "BinData/font2.ttf": font,
        "BinData/embedded.ole": Buffer.alloc(6_000_000, 1)
      }
    });

    const report = await analyzeHwpxBuffer(input);

    expect(report.resourceDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "large-font", kind: "font" }),
        expect.objectContaining({ type: "duplicate-font", kind: "font" }),
        expect.objectContaining({ type: "large-ole", kind: "ole" })
      ])
    );
    expect(report.opportunities).not.toContainEqual(expect.objectContaining({ target: "BinData/font1.ttf" }));
    expect(report.opportunities).not.toContainEqual(expect.objectContaining({ target: "BinData/embedded.ole" }));
  });
});

describe("PNG candidate profiles", () => {
  it("keeps PNG palette optimization aggressive-only", async () => {
    const png = await sharp({
      create: { width: 80, height: 80, channels: 3, background: "#aa7733" }
    })
      .png()
      .toBuffer();
    const pkg = await readHwpxPackage(
      await createHwpxFixture({
        entries: {
          "BinData/image.png": png
        }
      })
    );

    const balanced = await detectEstimatedOptimizationOpportunities(pkg, balancedImageProfile);
    const aggressive = await detectEstimatedOptimizationOpportunities(pkg, aggressiveImageProfile);

    expect(balanced.find((item) => item.action === "optimize-png")?.visualImpact).toBe("none");
    expect(aggressive.find((item) => item.action === "optimize-png")?.visualImpact).toBe("low");
  });
});
