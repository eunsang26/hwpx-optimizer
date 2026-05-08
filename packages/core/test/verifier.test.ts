import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { verifyHwpxOutput } from "../src/verifier.js";
import { createHwpxFixture } from "./fixtures.js";

describe("verifyHwpxOutput", () => {
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
});

async function createReferencedImageFixture(path: string, image: Buffer): Promise<Buffer> {
  return createHwpxFixture({
    entries: {
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
