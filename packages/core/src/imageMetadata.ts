import sharp from "sharp";
import { decodeBmp } from "./bmp.js";

export type ImageMetadata = {
  format?: string;
  width?: number;
  height?: number;
  hasMetadata: boolean;
  isBmp: boolean;
};

type CachedMetadata = {
  plain?: Promise<ImageMetadata>;
  rotated?: Promise<ImageMetadata>;
};

const metadataCache = new WeakMap<Buffer, CachedMetadata>();

export async function readImageMetadata(
  path: string,
  data: Buffer,
  options: { rotate?: boolean } = {}
): Promise<ImageMetadata> {
  const cached = metadataCache.get(data) ?? {};
  const key = options.rotate ? "rotated" : "plain";
  cached[key] ??= readImageMetadataUncached(path, data, options);
  metadataCache.set(data, cached);
  return cached[key]!;
}

async function readImageMetadataUncached(
  path: string,
  data: Buffer,
  options: { rotate?: boolean }
): Promise<ImageMetadata> {
  if (isMaybeBmp(path, data)) {
    const bmp = decodeBmp(data);
    if (bmp) {
      return {
        format: "bmp",
        width: bmp.width,
        height: bmp.height,
        hasMetadata: false,
        isBmp: true
      };
    }
  }

  try {
    const image = options.rotate ? sharp(data).rotate() : sharp(data);
    const metadata = await image.metadata();
    const format = metadata.format ? String(metadata.format) : undefined;
    return {
      format,
      width: metadata.width,
      height: metadata.height,
      hasMetadata: Boolean(metadata.exif || metadata.icc || metadata.iptc || metadata.xmp),
      isBmp: format === "bmp"
    };
  } catch {
    return {
      format: undefined,
      hasMetadata: false,
      isBmp: false
    };
  }
}

function isMaybeBmp(path: string, data: Buffer): boolean {
  return /\.bmp$/i.test(path) || (data.length >= 2 && data[0] === 0x42 && data[1] === 0x4d);
}
