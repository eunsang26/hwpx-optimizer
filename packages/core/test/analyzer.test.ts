import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { analyzeHwpxPackage } from "../src/analyzer.js";
import { readHwpxPackage } from "../src/reader.js";
import { createHwpxFixture } from "./fixtures.js";

describe("analyzeHwpxPackage", () => {
  it("reports image dimensions and BMP candidates", async () => {
    const png = await sharp({
      create: {
        width: 12,
        height: 8,
        channels: 3,
        background: "#ffffff"
      }
    })
      .png()
      .toBuffer();
    const bmpLike = Buffer.from("BMfake");
    const fixture = await createHwpxFixture({
      entries: {
        "Contents/section0.xml": "<root />",
        "BinData/image1.png": png,
        "BinData/image2.bmp": bmpLike
      }
    });

    const pkg = await readHwpxPackage(fixture);
    const analysis = await analyzeHwpxPackage(pkg);

    expect(analysis.totalSize).toBeGreaterThan(0);
    expect(analysis.images).toMatchObject([
      { path: "BinData/image1.png", format: "png", width: 12, height: 8 },
      { path: "BinData/image2.bmp", format: "bmp", isBmpCandidate: true }
    ]);
  });
});
