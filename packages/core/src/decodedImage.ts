import sharp from "sharp";
import { decodeBmp } from "./bmp.js";
import { readImageMetadata } from "./imageMetadata.js";

export type DecodedImage = {
  data: Buffer;
  width: number;
  height: number;
  channels: 3 | 4;
  autoOriented: boolean;
  indexed: boolean;
};

type CacheSlots = {
  plain?: Promise<DecodedImage | null>;
  rotated?: Promise<DecodedImage | null>;
};

const decodedImageCache = new WeakMap<Buffer, CacheSlots>();

/**
 * Decode image bytes to RGB/RGBA raw, caching by Buffer identity.
 * Callers that share the same BinData Buffer across duplicate hashing and
 * transforms hit the cache instead of re-decoding.
 */
export async function getDecodedImage(
  data: Buffer,
  options: { rotate?: boolean } = {}
): Promise<DecodedImage | null> {
  const rotate = Boolean(options.rotate);
  const slots = decodedImageCache.get(data) ?? {};
  const key = rotate ? "rotated" : "plain";
  slots[key] ??= decodeImageUncached(data, rotate);
  decodedImageCache.set(data, slots);
  return slots[key]!;
}

/** Test helper: clears cache entries for a buffer (WeakMap cannot enumerate). */
export async function peekDecodedImageCache(
  data: Buffer,
  options: { rotate?: boolean } = {}
): Promise<"miss" | "hit"> {
  const rotate = Boolean(options.rotate);
  const slots = decodedImageCache.get(data);
  if (!slots) return "miss";
  const key = rotate ? "rotated" : "plain";
  return slots[key] ? "hit" : "miss";
}

async function decodeImageUncached(data: Buffer, rotate: boolean): Promise<DecodedImage | null> {
  if ((await readImageMetadata("", data)).preservationReason) return null;
  const bmp = decodeBmp(data);
  if (bmp) {
    return {
      data: bmp.data,
      width: bmp.width,
      height: bmp.height,
      channels: 3,
      autoOriented: false,
      indexed: bmp.indexed
    };
  }

  try {
    const pipeline = rotate ? sharp(data).rotate() : sharp(data);
    const decoded = await pipeline.toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
    if (!decoded.info.width || !decoded.info.height) return null;
    if (decoded.info.channels === 3 || decoded.info.channels === 4) {
      return {
        data: decoded.data,
        width: decoded.info.width,
        height: decoded.info.height,
        channels: decoded.info.channels,
        autoOriented: rotate,
        indexed: false
      };
    }
    // Normalize unexpected channel counts while retaining alpha.
    const rgb = await sharp(decoded.data, {
      raw: {
        width: decoded.info.width,
        height: decoded.info.height,
        channels: decoded.info.channels
      }
    })
      .toColourspace("srgb")
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (rgb.info.channels !== 3 && rgb.info.channels !== 4) return null;
    return {
      data: rgb.data,
      width: rgb.info.width,
      height: rgb.info.height,
      channels: rgb.info.channels,
      autoOriented: rotate,
      indexed: false
    };
  } catch {
    return null;
  }
}
