import sharp from "sharp";

const HASH_SIZE = 8;
const HASH_PIXELS = HASH_SIZE * HASH_SIZE;

export type PerceptualHash = {
  bits: Uint8Array;
};

export async function computePerceptualHash(data: Buffer): Promise<PerceptualHash | null> {
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

export function hammingDistance(left: PerceptualHash, right: PerceptualHash): number {
  let distance = 0;
  for (let index = 0; index < HASH_PIXELS; index += 1) {
    if (left.bits[index] !== right.bits[index]) distance += 1;
  }
  return distance;
}

export const PERCEPTUAL_HASH_BIT_COUNT = HASH_PIXELS;
