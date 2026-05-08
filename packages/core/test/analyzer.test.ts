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

  it("reports dimensions for uncompressed 24-bit BMP images", async () => {
    const fixture = await createHwpxFixture({
      entries: {
        "Contents/section0.xml": "<root />",
        "BinData/image1.bmp": createBmp24(7, 5)
      }
    });

    const pkg = await readHwpxPackage(fixture);
    const analysis = await analyzeHwpxPackage(pkg);

    expect(analysis.images).toMatchObject([{ path: "BinData/image1.bmp", format: "bmp", width: 7, height: 5 }]);
  });
});

function createBmp24(width: number, height: number): Buffer {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelDataSize = rowSize * height;
  const fileSize = 54 + pixelDataSize;
  const buffer = Buffer.alloc(fileSize);
  buffer.write("BM", 0, "ascii");
  buffer.writeUInt32LE(fileSize, 2);
  buffer.writeUInt32LE(54, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(pixelDataSize, 34);
  return buffer;
}
