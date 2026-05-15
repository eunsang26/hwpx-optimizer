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

  it("links images to their document display size", async () => {
    const png = await sharp({
      create: {
        width: 1200,
        height: 900,
        channels: 3,
        background: "#ffffff"
      }
    })
      .png()
      .toBuffer();
    const fixture = await createHwpxFixture({
      entries: {
        "Contents/content.hpf": `<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest><opf:item id="image1" href="BinData/image1.png" media-type="image/png" isEmbeded="1"/></opf:manifest></opf:package>`,
        "Contents/section0.xml": `<root><hp:pic><hp:curSz width="8000" height="4000"/><hc:img binaryItemIDRef="image1"/><hp:sz width="7200" height="3600" widthRelTo="ABSOLUTE" heightRelTo="ABSOLUTE"/></hp:pic></root>`,
        "BinData/image1.png": png
      }
    });

    const pkg = await readHwpxPackage(fixture);
    const analysis = await analyzeHwpxPackage(pkg);

    expect(analysis.images).toMatchObject([
      {
        path: "BinData/image1.png",
        width: 1200,
        height: 900,
        displayRefs: [
          {
            sourceXml: "Contents/section0.xml",
            binaryItemIDRef: "image1",
            widthHwpUnit: 7200,
            heightHwpUnit: 3600,
            widthPx96: 96,
            heightPx96: 48
          }
        ],
        largestDisplay: {
          widthHwpUnit: 7200,
          heightHwpUnit: 3600,
          widthPx96: 96,
          heightPx96: 48,
          recommendedWidthPx: 192,
          recommendedHeightPx: 96,
          sourceXml: "Contents/section0.xml"
        }
      }
    ]);
    expect(analysis.images[0]?.oversizeRatio).toBeCloseTo(9.375, 3);
  });

  it("summarizes duplicate images, unused BinData, category sizes, and risky resources", async () => {
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
    const fixture = await createHwpxFixture({
      entries: {
        "Contents/section0.xml": '<root><img href="BinData/image1.png" /></root>',
        "BinData/image1.png": png,
        "BinData/image2.png": png,
        "BinData/unused.bin": Buffer.from("unused"),
        "Object/embedded.ole": Buffer.from("ole"),
        "Fonts/document.ttf": Buffer.from("font")
      }
    });

    const pkg = await readHwpxPackage(fixture);
    const analysis = await analyzeHwpxPackage(pkg);

    expect(analysis.categorySizes.image).toBe(png.byteLength * 2);
    expect(analysis.categorySizes.bindata).toBe(Buffer.byteLength("unused"));
    expect(analysis.duplicateImages).toEqual([
      expect.objectContaining({
        paths: ["BinData/image1.png", "BinData/image2.png"],
        count: 2,
        wastedBytes: png.byteLength
      })
    ]);
    expect(analysis.unusedBinData).toEqual([
      expect.objectContaining({ path: "BinData/image2.png", kind: "image" }),
      expect.objectContaining({ path: "BinData/unused.bin", kind: "bindata" })
    ]);
    expect(analysis.riskyResources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "Object/embedded.ole", kind: "ole" }),
        expect.objectContaining({ path: "Fonts/document.ttf", kind: "font" })
      ])
    );
  });

  it("reports same-visual duplicate images across lossless encodings", async () => {
    const png = await sharp({
      create: {
        width: 16,
        height: 10,
        channels: 3,
        background: "#000000"
      }
    })
      .png()
      .toBuffer();
    const bmp = createBmp24(16, 10);
    const fixture = await createHwpxFixture({
      entries: {
        "Contents/section0.xml": '<root><img href="BinData/image1.png" /><img href="BinData/image2.bmp" /></root>',
        "BinData/image1.png": png,
        "BinData/image2.bmp": bmp
      }
    });

    const pkg = await readHwpxPackage(fixture);
    const analysis = await analyzeHwpxPackage(pkg);

    expect(analysis.duplicateImages).toEqual([]);
    expect(analysis.sameVisualDuplicateImages).toEqual([
      expect.objectContaining({
        paths: ["BinData/image1.png", "BinData/image2.bmp"],
        count: 2,
        totalBytes: png.byteLength + bmp.byteLength,
        wastedBytes: bmp.byteLength
      })
    ]);
  });

  it("can skip near-duplicate diagnostics for latency-sensitive callers", async () => {
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
    const fixture = await createHwpxFixture({
      entries: {
        "BinData/image1.png": base,
        "BinData/image2.jpg": similar
      }
    });

    const pkg = await readHwpxPackage(fixture);
    const defaultAnalysis = await analyzeHwpxPackage(pkg);
    const analysis = await analyzeHwpxPackage(pkg, { includeNearDuplicateImages: false });

    expect(defaultAnalysis.nearDuplicateImages).toEqual([
      expect.objectContaining({ paths: ["BinData/image1.png", "BinData/image2.jpg"], count: 2 })
    ]);
    expect(analysis.nearDuplicateImages).toEqual([]);
  });

  it("can skip visual duplicate diagnostics for quick desktop analysis", async () => {
    const png = await sharp({
      create: {
        width: 16,
        height: 10,
        channels: 3,
        background: "#000000"
      }
    })
      .png()
      .toBuffer();
    const bmp = createBmp24(16, 10);
    const fixture = await createHwpxFixture({
      entries: {
        "Contents/section0.xml": '<root><img href="BinData/image1.png" /><img href="BinData/image2.bmp" /></root>',
        "BinData/image1.png": png,
        "BinData/image2.bmp": bmp
      }
    });

    const pkg = await readHwpxPackage(fixture);
    const analysis = await analyzeHwpxPackage(pkg, {
      includeSameVisualDuplicateImages: false,
      includeNearDuplicateImages: false
    });

    expect(analysis.sameVisualDuplicateImages).toEqual([]);
    expect(analysis.nearDuplicateImages).toEqual([]);
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
