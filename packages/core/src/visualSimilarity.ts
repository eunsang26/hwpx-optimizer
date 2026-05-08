import sharp from "sharp";

const HASH_SIZE = 8;
const HASH_PIXELS = HASH_SIZE * HASH_SIZE;

export type AverageHash = {
  bits: Uint8Array;
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
    const raw = await sharp(data)
      .removeAlpha()
      .grayscale()
      .resize(HASH_SIZE, HASH_SIZE, { fit: "fill", kernel: "lanczos3" })
      .raw()
      .toBuffer();
    if (raw.length < HASH_PIXELS) return null;

    let total = 0;
    for (let index = 0; index < HASH_PIXELS; index += 1) total += raw[index]!;
    const mean = total / HASH_PIXELS;

    const bits = new Uint8Array(HASH_PIXELS);
    for (let index = 0; index < HASH_PIXELS; index += 1) {
      bits[index] = raw[index]! >= mean ? 1 : 0;
    }
    return { bits };
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

export const AVERAGE_HASH_BIT_COUNT = HASH_PIXELS;
