import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { analyzeHwpxBuffer, optimizeHwpxBufferBalanced } from "../src/optimize.js";
import { readHwpxPackage } from "../src/reader.js";
import { createHwpxFixture } from "./fixtures.js";

describe("balanced optimization", () => {
  it("reports dry-run opportunities for oversized JPEG and BMP resources", async () => {
    const jpg = await sharp({
      create: {
        width: 2400,
        height: 1800,
        channels: 3,
        background: "#88aacc"
      }
    })
      .jpeg({ quality: 95 })
      .toBuffer();
    const bmp = createBmp24(1600, 900, [0xee, 0xee, 0xee]);
    const fixture = await createReferencedImageFixture({
      "image1": { path: "BinData/image1.JPG", mediaType: "image/jpg", data: jpg },
      "image2": { path: "BinData/image2.bmp", mediaType: "image/bmp", data: bmp }
    });

    const report = await analyzeHwpxBuffer(fixture);

    expect(report.opportunities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "resize-jpeg", target: "BinData/image1.JPG" }),
        expect.objectContaining({ action: "convert-bmp-to-png", target: "BinData/image2.bmp" })
      ])
    );
    expect(report.opportunities.every((item) => item.estimatedSavingBytes > 0)).toBe(true);
  });

  it("converts BMP to PNG and updates content.hpf manifest references", async () => {
    const bmp = createBmp24(640, 360, [0xcc, 0xcc, 0xcc]);
    const fixture = await createReferencedImageFixture({
      "image1": { path: "BinData/image1.bmp", mediaType: "image/bmp", data: bmp }
    });

    const result = await optimizeHwpxBufferBalanced(fixture);
    const output = await readHwpxPackage(result.output);
    const content = output.entries.find((entry) => entry.path === "Contents/content.hpf")?.data.toString("utf8");

    expect(output.entries.some((entry) => entry.path === "BinData/image1.png")).toBe(true);
    expect(output.entries.some((entry) => entry.path === "BinData/image1.bmp")).toBe(false);
    expect(content).toContain('id="image1"');
    expect(content).toContain('href="BinData/image1.png"');
    expect(content).toContain('media-type="image/png"');
    expect(result.report.actions.applied).toContainEqual(
      expect.objectContaining({ type: "convert-bmp-to-png", target: "BinData/image1.bmp" })
    );
  });
});

async function createReferencedImageFixture(
  images: Record<string, { path: string; mediaType: string; data: Buffer }>
): Promise<Buffer> {
  const items = Object.entries(images)
    .map(([id, image]) => `<opf:item id="${id}" href="${image.path}" media-type="${image.mediaType}" isEmbeded="1"/>`)
    .join("");
  const firstId = Object.keys(images)[0];
  const entries: Record<string, string | Buffer> = {
    "Contents/content.hpf": `<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest><opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>${items}</opf:manifest></opf:package>`,
    "Contents/section0.xml": `<root><hc:img binaryItemIDRef="${firstId}" /></root>`
  };
  for (const image of Object.values(images)) {
    entries[image.path] = image.data;
  }
  return createHwpxFixture({ entries });
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
