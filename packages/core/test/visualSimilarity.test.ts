import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  computeAverageHash,
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
