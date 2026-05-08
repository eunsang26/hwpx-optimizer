import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { verifyHwpxOutput } from "../src/verifier.js";
import { createHwpxFixture } from "./fixtures.js";

describe("verifyHwpxOutput", () => {
  it("rejects outputs without required HWPX package files", async () => {
    const output = await createHwpxFixture({
      includeRequiredFiles: false,
      entries: {
        "BinData/used.bin": Buffer.from("used")
      }
    });

    await expect(verifyHwpxOutput(output)).rejects.toThrow(/missing required files/i);
  });

  it("rejects safe-mode outputs that change image dimensions", async () => {
    const originalImage = await createJpeg(120, 80);
    const resizedImage = await createJpeg(60, 40);
    const original = await createReferencedImageFixture("BinData/image1.jpg", originalImage);
    const output = await createReferencedImageFixture("BinData/image1.jpg", resizedImage);

    await expect(verifyHwpxOutput(output, { original, mode: "safe" })).rejects.toThrow(
      /safe mode image dimensions changed/
    );
  });

  it("rejects safe-mode outputs that change image format", async () => {
    const originalImage = await createJpeg(120, 80);
    const pngImage = await sharp({
      create: {
        width: 120,
        height: 80,
        channels: 3,
        background: "#33aa77"
      }
    })
      .png()
      .toBuffer();
    const original = await createReferencedImageFixture("BinData/image1.jpg", originalImage);
    const output = await createReferencedImageFixture("BinData/image1.jpg", pngImage);

    await expect(verifyHwpxOutput(output, { original, mode: "safe" })).rejects.toThrow(/safe mode image format changed/);
  });

  it("rejects balanced-mode outputs that convert referenced JPEGs to PNG", async () => {
    const originalImage = await createJpeg(120, 80);
    const pngImage = await createPng(120, 80);
    const original = await createReferencedImageFixture("BinData/image1.jpg", originalImage);
    const output = await createReferencedImageFixture("BinData/image1.png", pngImage);

    await expect(verifyHwpxOutput(output, { original, mode: "balanced" })).rejects.toThrow(
      /balanced mode image conversion is not allowed/
    );
  });

  it("rejects aggressive-mode outputs that enlarge referenced images", async () => {
    const originalImage = await createJpeg(120, 80);
    const enlargedImage = await createJpeg(240, 160);
    const original = await createReferencedImageFixture("BinData/image1.jpg", originalImage);
    const output = await createReferencedImageFixture("BinData/image1.jpg", enlargedImage);

    await expect(verifyHwpxOutput(output, { original, mode: "aggressive" })).rejects.toThrow(
      /aggressive mode image dimensions enlarged/
    );
  });

  it("allows balanced-mode outputs that convert referenced BMPs to PNG", async () => {
    const original = await createReferencedImageFixture("BinData/image1.bmp", createBmp24(120, 80));
    const output = await createReferencedImageFixture("BinData/image1.png", await createPng(120, 80));

    await expect(verifyHwpxOutput(output, { original, mode: "balanced" })).resolves.toBeUndefined();
  });
});

async function createReferencedImageFixture(path: string, image: Buffer): Promise<Buffer> {
  return createHwpxFixture({
    entries: {
      "Contents/content.hpf": `<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest><opf:item id="image1" href="${path}" media-type="image/${path.split(".").pop()?.toLowerCase() ?? "unknown"}"/></opf:manifest></opf:package>`,
      "Contents/section0.xml": `<root><img href="${path}" /></root>`,
      [path]: image
    }
  });
}

async function createJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: "#88aacc"
    }
  })
    .jpeg({ quality: 95 })
    .toBuffer();
}

async function createPng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: "#33aa77"
    }
  })
    .png()
    .toBuffer();
}

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
  for (let y = 0; y < height; y += 1) {
    const row = 54 + y * rowSize;
    for (let x = 0; x < width; x += 1) {
      const offset = row + x * 3;
      buffer[offset] = 0x77;
      buffer[offset + 1] = 0xaa;
      buffer[offset + 2] = 0x33;
    }
  }
  return buffer;
}
