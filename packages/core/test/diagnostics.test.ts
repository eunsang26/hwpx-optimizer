import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { analyzeHwpxBuffer } from "../src/optimize.js";
import { detectEstimatedOptimizationOpportunities } from "../src/opportunities.js";
import { readHwpxPackage } from "../src/reader.js";
import { aggressiveImageProfile, balancedImageProfile } from "../src/opportunities.js";
import { createHwpxFixture } from "./fixtures.js";

describe("analysis diagnostics", () => {
  it("reports near-duplicate images without turning them into consolidation actions", async () => {
    const raw = Buffer.alloc(96 * 96 * 3);
    for (let y = 0; y < 96; y += 1) {
      for (let x = 0; x < 96; x += 1) {
        const offset = (y * 96 + x) * 3;
        raw[offset] = (x * 2) % 256;
        raw[offset + 1] = (y * 2) % 256;
        raw[offset + 2] = 128;
      }
    }
    const base = await sharp(raw, { raw: { width: 96, height: 96, channels: 3 } })
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

    const report = await analyzeHwpxBuffer(input, { analysisMode: "deep" });

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

  it("does not report unrelated flat-color images as near-duplicates", async () => {
    const red = await sharp({
      create: { width: 96, height: 96, channels: 3, background: "#ff0000" }
    })
      .png()
      .toBuffer();
    const blue = await sharp({
      create: { width: 96, height: 96, channels: 3, background: "#0000ff" }
    })
      .png()
      .toBuffer();
    const input = await createHwpxFixture({
      entries: {
        "BinData/red.png": red,
        "BinData/blue.png": blue
      }
    });

    const report = await analyzeHwpxBuffer(input, { analysisMode: "deep" });

    expect(report.nearDuplicateImages).toEqual([]);
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
      create: { width: 256, height: 256, channels: 3, background: "#aa7733" }
    })
      .png({ compressionLevel: 0 })
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

  it("does not spend PNG optimization work on tiny files", async () => {
    const pkg = await readHwpxPackage(
      await createHwpxFixture({
        entries: {
          "BinData/tiny.png": Buffer.from([0x89, 0x50, 0x4e, 0x47])
        }
      })
    );

    const opportunities = await detectEstimatedOptimizationOpportunities(pkg, balancedImageProfile);

    expect(opportunities).not.toContainEqual(expect.objectContaining({ action: "optimize-png", target: "BinData/tiny.png" }));
  });
});
