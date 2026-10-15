import { SHARP_INPUT_OPTIONS } from "./resourceLimits.js";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { readImageMetadata } from "./imageMetadata.js";
import { getDecodedImage } from "./decodedImage.js";

const HASH_SIZE = 8;
const HASH_PIXELS = HASH_SIZE * HASH_SIZE;

export type AverageHash = {
  bits: Uint8Array;
  mean: number;
  standardDeviation: number;
};

export type DecodedPixelHash = {
  width: number;
  height: number;
  channels: number;
  hash: string;
};

/**
 * Computes an 8x8 grayscale average hash (aHash). NOT a DCT-based pHash.
 *
 * Pipeline: removeAlpha → grayscale → resize to 8x8 (lanczos3) → bit_i = pixel_i >= mean ? 1 : 0.
 *
 * Use cases that fit aHash:
 *   - cheap near-duplicate candidate listing
 *   - fingerprinting for cache keys
 *
 * Use cases that DO NOT fit aHash (have stronger metrics elsewhere):
 *   - quality drift after compression  → use computePsnr (imagePreview.ts)
 *   - byte-identical duplicate detection → use SHA-256 (analyzer.ts)
 *   - flip/rotate detection             → compare candidate transforms explicitly
 *
 * The HWPX optimizer does not currently use this function in any release path.
 * It is retained as a building block for future near-duplicate candidate reports.
 */
export async function computeAverageHash(data: Buffer): Promise<AverageHash | null> {
  try {
    if ((await readImageMetadata("", data)).preservationReason) return null;
    const raw = await sharp(data, SHARP_INPUT_OPTIONS)
      .removeAlpha()
      .grayscale()
      .resize(HASH_SIZE, HASH_SIZE, { fit: "fill", kernel: "lanczos3" })
      .raw()
      .toBuffer();
    if (raw.length < HASH_PIXELS) return null;

    let total = 0;
    for (let index = 0; index < HASH_PIXELS; index += 1) total += raw[index]!;
    const mean = total / HASH_PIXELS;

    let variance = 0;
    const bits = new Uint8Array(HASH_PIXELS);
    for (let index = 0; index < HASH_PIXELS; index += 1) {
      const value = raw[index]!;
      const delta = value - mean;
      variance += delta * delta;
      bits[index] = value >= mean ? 1 : 0;
    }
    return { bits, mean, standardDeviation: Math.sqrt(variance / HASH_PIXELS) };
  } catch {
    return null;
  }
}

export function hammingDistance(left: AverageHash, right: AverageHash): number {
  let distance = 0;
  for (let index = 0; index < HASH_PIXELS; index += 1) {
    if (left.bits[index] !== right.bits[index]) distance += 1;
  }
  return distance;
}

export async function computeDecodedPixelHash(data: Buffer): Promise<DecodedPixelHash | null> {
  const decoded = await getDecodedImage(data, { rotate: true });
  if (!decoded) return null;
  return hashDecodedPixels({
    data: decoded.data,
    width: decoded.width,
    height: decoded.height,
    channels: decoded.channels
  });
}

function hashDecodedPixels(input: { data: Buffer; width: number; height: number; channels: number }): DecodedPixelHash {
  // Fully opaque RGBA and RGB render identically. Canonicalize just the hash,
  // retaining RGBA in the decode cache used by image transformations.
  let opaque = input.channels === 4;
  for (let offset = 3; opaque && offset < input.data.length; offset += 4) {
    if (input.data[offset] !== 255) opaque = false;
  }
  const channels = opaque ? 3 : input.channels;
  const descriptor = `${input.width}x${input.height}x${channels}`;
  const digest = createHash("sha256").update(descriptor).update("\0");
  if (opaque) {
    const chunk = Buffer.alloc(12_288);
    let used = 0;
    for (let offset = 0; offset < input.data.length; offset += 4) {
      chunk[used++] = input.data[offset]!;
      chunk[used++] = input.data[offset + 1]!;
      chunk[used++] = input.data[offset + 2]!;
      if (used === chunk.length) { digest.update(chunk); used = 0; }
    }
    if (used) digest.update(chunk.subarray(0, used));
  } else digest.update(input.data);
  const hash = digest.digest("hex");
  return {
    width: input.width,
    height: input.height,
    channels,
    hash
  };
}

export const AVERAGE_HASH_BIT_COUNT = HASH_PIXELS;
