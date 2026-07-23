import sharp from "sharp";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { analyzeHwpxPackage } from "../src/analyzer.js";
import { computeSsim } from "../src/imagePreview.js";
import { readHwpxPackage } from "../src/reader.js";
import { verifyHwpxOutput } from "../src/verifier.js";
import { createHwpxFixture } from "./fixtures.js";

describe("verifyHwpxOutput", () => {
  it("computes SSIM for identical images", async () => {
    const image = await createPng(64, 64);

    await expect(computeSsim(image, image)).resolves.toBe(1);
  });

  it("rejects outputs without required HWPX package files", async () => {
    const output = await createHwpxFixture({
      includeRequiredFiles: false,
      entries: {
        "BinData/used.bin": Buffer.from("used")
      }
    });

    await expect(verifyHwpxOutput(output)).rejects.toThrow(/missing required files/i);
  });

  it("rejects HWPX packages whose mimetype entry is compressed", async () => {
    const zip = new JSZip();
    zip.file("mimetype", "application/hwp+zip");
    zip.file("Contents/content.hpf", '<opf:package xmlns:opf="http://www.idpf.org/2007/opf" />');
    zip.file("Contents/section0.xml", "<root />");
    const output = Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));

    await expect(verifyHwpxOutput(output)).rejects.toThrow(/mimetype entry must be stored without compression/);
  });

  it("rejects malformed XML entries", async () => {
    const output = await createHwpxFixture({
      entries: {
        "Contents/section0.xml": "<root><a></root>"
      }
    });

    await expect(verifyHwpxOutput(output)).rejects.toThrow(/XML is not well-formed/);
  });

  it("parses the serialized output even when original analysis is supplied", async () => {
    const original = await createHwpxFixture({
      entries: {
        "Contents/section0.xml": "<root />"
      }
    });
    const originalPackage = await readHwpxPackage(original);
    const originalAnalysis = await analyzeHwpxPackage(originalPackage);

    await expect(
      verifyHwpxOutput(Buffer.from("not a zip"), {
        original,
        mode: "safe",
        originalPackage,
        originalAnalysis
      })
    ).rejects.toThrow(/does not start with a ZIP local file header/);
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

  it("rejects advanced-mode outputs that collapse referenced image dimensions", async () => {
    const originalImage = await createJpeg(120, 80);
    const collapsedImage = await createJpeg(120, 1);
    const original = await createReferencedImageFixture("BinData/image1.jpg", originalImage);
    const output = await createReferencedImageFixture("BinData/image1.jpg", collapsedImage);

    await expect(verifyHwpxOutput(output, { original, mode: "balanced" })).rejects.toThrow(
      /balanced mode image aspect ratio changed/
    );
  });

  it("allows balanced-mode outputs that convert referenced BMPs to PNG", async () => {
    const original = await createReferencedImageFixture("BinData/image1.bmp", createBmp24(120, 80));
    const output = await createReferencedImageFixture("BinData/image1.png", await createPng(120, 80));

    await expect(verifyHwpxOutput(output, { original, mode: "balanced" })).resolves.toBeUndefined();
  });

  it("rejects balanced-mode outputs whose PSNR collapses below the minimum", async () => {
    const original = await createReferencedImageFixture("BinData/image1.png", await createGradientPng(96, 64));
    const output = await createReferencedImageFixture("BinData/image1.png", await createInvertedGradientPng(96, 64));

    await expect(verifyHwpxOutput(output, { original, mode: "balanced" })).rejects.toThrow(
      /image quality too low/
    );
  });

  it("includes dimensions, format, and EXIF orientation in the PSNR rejection message", async () => {
    const original = await createReferencedImageFixture("BinData/image1.png", await createGradientPng(96, 64));
    const output = await createReferencedImageFixture("BinData/image1.png", await createInvertedGradientPng(96, 64));

    await expect(verifyHwpxOutput(output, { original, mode: "balanced" })).rejects.toThrow(
      /96×64 png ori=1 → 96×64 png ori=1/
    );
  });

  it("includes SSIM in image quality rejection messages", async () => {
    const original = await createReferencedImageFixture("BinData/image1.png", await createGradientPng(96, 64));
    const output = await createReferencedImageFixture("BinData/image1.png", await createInvertedGradientPng(96, 64));

    await expect(verifyHwpxOutput(output, { original, mode: "balanced" })).rejects.toThrow(/SSIM/);
  });

  it("rejects changed advanced-mode images when visual quality cannot be measured", async () => {
    const original = await createReferencedImageFixture("BinData/image1.jpg", Buffer.from("not a decodable jpeg"));
    const output = await createReferencedImageFixture("BinData/image1.jpg", Buffer.from("changed but still not decodable"));

    await expect(verifyHwpxOutput(output, { original, mode: "balanced" })).rejects.toThrow(
      /image quality could not be measured/
    );
  });

  it("allows aggressive-mode outputs that stay above the PSNR minimum", async () => {
    const gradient = await createGradientPng(192, 128);
    const originalJpeg = await sharp(gradient).jpeg({ quality: 95 }).toBuffer();
    const recompressed = await sharp(gradient).jpeg({ quality: 60 }).toBuffer();
    const original = await createReferencedImageFixture("BinData/image1.jpg", originalJpeg);
    const output = await createReferencedImageFixture("BinData/image1.jpg", recompressed);

    await expect(verifyHwpxOutput(output, { original, mode: "aggressive" })).resolves.toBeUndefined();
  });

  it("throws when only one of `original` and `mode` is provided", async () => {
    const output = await createReferencedImageFixture("BinData/image1.jpg", await createJpeg(80, 60));
    await expect(verifyHwpxOutput(output, { original: output })).rejects.toThrow(
      /requires both .*original.* and .*mode/i
    );
    await expect(verifyHwpxOutput(output, { mode: "safe" })).rejects.toThrow(
      /requires both .*original.* and .*mode/i
    );
  });
});

async function createGradientPng(width: number, height: number): Promise<Buffer> {
  const channels = 3;
  const raw = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * channels;
      const intensity = Math.round(((x + y) / (width + height - 2)) * 255);
      raw[offset] = intensity;
      raw[offset + 1] = intensity;
      raw[offset + 2] = intensity;
    }
  }
  return sharp(raw, { raw: { width, height, channels } }).png().toBuffer();
}

async function createInvertedGradientPng(width: number, height: number): Promise<Buffer> {
  const channels = 3;
  const raw = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * channels;
      const intensity = 255 - Math.round(((x + y) / (width + height - 2)) * 255);
      raw[offset] = intensity;
      raw[offset + 1] = intensity;
      raw[offset + 2] = intensity;
    }
  }
  return sharp(raw, { raw: { width, height, channels } }).png().toBuffer();
}

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
