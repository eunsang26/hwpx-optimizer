import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { optimizeHwpxBufferBalanced, optimizeHwpxBufferSafe } from "../src/optimize.js";
import { readHwpxPackage } from "../src/reader.js";
import { createHwpxFixture } from "./fixtures.js";

/**
 * Hard size gate for decode-once: package bytes and transformed image bytes must
 * not grow vs the frozen baseline captured after the PNG/BMP capacity work.
 * Re-measure and update only when an intentional capacity change ships.
 */
// Frozen after decode-once wiring (2026-07-24). Bump only with intentional capacity changes.
const BASELINE = {
  balancedPackageBytes: 1735,
  balancedImageBytes: 1394,
  safePackageBytes: 2400
};

describe("decode-once size non-regression", () => {
  it("does not grow balanced package or image bytes vs baseline", async () => {
    const fixture = await createMixedFixture();
    const result = await optimizeHwpxBufferBalanced(fixture, { allowLarger: true });
    const output = await readHwpxPackage(result.output);
    const imageBytes = output.entries
      .filter((entry) => entry.kind === "image")
      .reduce((sum, entry) => sum + entry.size, 0);

    expect(result.output.byteLength).toBeLessThanOrEqual(BASELINE.balancedPackageBytes);
    expect(imageBytes).toBeLessThanOrEqual(BASELINE.balancedImageBytes);
    expect(result.output.byteLength).toBeLessThan(fixture.byteLength);
  });

  it("does not grow safe package bytes vs baseline", async () => {
    const fixture = await createMixedFixture();
    const result = await optimizeHwpxBufferSafe(fixture);
    expect(result.output.byteLength).toBeLessThanOrEqual(BASELINE.safePackageBytes);
  });
});

async function createMixedFixture(): Promise<Buffer> {
  const jpeg = await sharp({
    create: { width: 800, height: 600, channels: 3, background: "#446688" }
  })
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();
  const png = await sharp({
    create: { width: 400, height: 300, channels: 3, background: "#88aa44" }
  })
    .png({ compressionLevel: 3 })
    .toBuffer();
  const bmp = createBmp24(320, 240, [0xaa, 0xbb, 0xcc]);
  const jpegDup = Buffer.from(jpeg);

  return createHwpxFixture({
    entries: {
      "Contents/content.hpf": [
        '<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest>',
        '<opf:item id="image1" href="BinData/image1.jpg" media-type="image/jpeg"/>',
        '<opf:item id="image2" href="BinData/image2.png" media-type="image/png"/>',
        '<opf:item id="image3" href="BinData/image3.bmp" media-type="image/bmp"/>',
        '<opf:item id="image4" href="BinData/image4.jpg" media-type="image/jpeg"/>',
        "</opf:manifest></opf:package>"
      ].join(""),
      "Contents/section0.xml": [
        "<root>",
        '<hp:pic><hp:sz width="7200" height="5400"/><hc:img binaryItemIDRef="image1"/></hp:pic>',
        '<hp:pic><hp:sz width="3600" height="2700"/><hc:img binaryItemIDRef="image2"/></hp:pic>',
        '<hp:pic><hc:img binaryItemIDRef="image3"/></hp:pic>',
        '<hp:pic><hp:sz width="7200" height="5400"/><hc:img binaryItemIDRef="image4"/></hp:pic>',
        "</root>"
      ].join(""),
      "BinData/image1.jpg": jpeg,
      "BinData/image2.png": png,
      "BinData/image3.bmp": bmp,
      "BinData/image4.jpg": jpegDup
    }
  });
}

function createBmp24(width: number, height: number, rgb: [number, number, number]): Buffer {
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
  for (let y = 0; y < height; y += 1) {
    const row = 54 + y * rowSize;
    for (let x = 0; x < width; x += 1) {
      const offset = row + x * 3;
      buffer[offset] = rgb[2];
      buffer[offset + 1] = rgb[1];
      buffer[offset + 2] = rgb[0];
    }
  }
  return buffer;
}
