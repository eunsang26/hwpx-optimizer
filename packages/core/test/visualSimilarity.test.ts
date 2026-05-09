import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  computeAverageHash,
  computeDecodedPixelHash,
  hammingDistance,
  AVERAGE_HASH_BIT_COUNT
} from "../src/visualSimilarity.js";

describe("computeAverageHash", () => {
  it("yields zero distance for identical images", async () => {
    const data = await gradientImage(64, 64);
    const left = await computeAverageHash(data);
    const right = await computeAverageHash(data);
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    expect(hammingDistance(left!, right!)).toBe(0);
  });

  it("yields a small distance for compressed-but-equivalent JPEG vs PNG", async () => {
    const png = await gradientImage(96, 64);
    const jpeg = await sharp(png).jpeg({ quality: 80 }).toBuffer();
    const left = await computeAverageHash(png);
    const right = await computeAverageHash(jpeg);
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    const distance = hammingDistance(left!, right!);
    expect(distance).toBeLessThanOrEqual(8);
  });

  it("yields a large distance for visibly different images", async () => {
    const left = await computeAverageHash(await gradientImage(64, 64));
    const right = await computeAverageHash(await invertedGradientImage(64, 64));
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    expect(hammingDistance(left!, right!)).toBeGreaterThanOrEqual(20);
  });

  it("returns null for non-image buffers without throwing", async () => {
    const result = await computeAverageHash(Buffer.from("not an image"));
    expect(result).toBeNull();
  });

  it("uses a 64-bit hash", () => {
    expect(AVERAGE_HASH_BIT_COUNT).toBe(64);
  });
});

describe("computeDecodedPixelHash", () => {
  it("matches images with identical decoded pixels across lossless formats", async () => {
    const png = await solidImage(32, 24, "#44aa88");
    const bmp = createBmp24(32, 24, [0x44, 0xaa, 0x88]);

    const left = await computeDecodedPixelHash(png);
    const right = await computeDecodedPixelHash(bmp);

    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    expect(right).toEqual(left);
  });

  it("separates images with different decoded pixels", async () => {
    const left = await computeDecodedPixelHash(await solidImage(32, 24, "#44aa88"));
    const right = await computeDecodedPixelHash(await solidImage(32, 24, "#8844aa"));

    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    expect(right).not.toEqual(left);
  });
});

async function gradientImage(width: number, height: number): Promise<Buffer> {
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

async function invertedGradientImage(width: number, height: number): Promise<Buffer> {
  const channels = 3;
  const raw = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * channels;
      const intensity = Math.round(((x + y) / (width + height - 2)) * 255);
      const flipped = 255 - intensity;
      raw[offset] = flipped;
      raw[offset + 1] = flipped;
      raw[offset + 2] = flipped;
    }
  }
  return sharp(raw, { raw: { width, height, channels } }).png().toBuffer();
}

async function solidImage(width: number, height: number, background: string): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background
    }
  })
    .png()
    .toBuffer();
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
