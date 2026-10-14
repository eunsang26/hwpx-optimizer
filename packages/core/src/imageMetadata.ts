import sharp from "sharp";
import type { Metadata } from "sharp";
import { readBmpInfo } from "./bmp.js";

export type ImageMetadata = {
  format?: string;
  width?: number;
  height?: number;
  hasMetadata: boolean;
  isBmp: boolean;
  preservationReason?: string;
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
    const bmp = readBmpInfo(data);
    if (bmp) {
      return {
        format: "bmp",
        width: bmp.width,
        height: bmp.height,
        hasMetadata: false,
        isBmp: true,
        ...(!bmp.supported ? { preservationReason: "Unsupported BMP variant; alpha or encoding cannot be preserved." } : {})
      };
    }
  }

  try {
    const image = options.rotate ? sharp(data).rotate() : sharp(data);
    const metadata = await image.metadata();
    const format = metadata.format ? String(metadata.format) : undefined;
    // metadata() describes the input header even when rotate() is queued.
    const swapsAxes = options.rotate && (metadata.orientation ?? 1) >= 5 && (metadata.orientation ?? 1) <= 8;
    return {
      format,
      width: swapsAxes ? metadata.height : metadata.width,
      height: swapsAxes ? metadata.width : metadata.height,
      hasMetadata: Boolean(metadata.exif || metadata.icc || metadata.iptc || metadata.xmp),
      isBmp: format === "bmp",
      ...(preservationReason(metadata) ? { preservationReason: preservationReason(metadata) } : {})
    };
  } catch {
    return {
      format: undefined,
      hasMetadata: false,
      isBmp: false
    };
  }
}

function preservationReason(metadata: Metadata): string | undefined {
  if ((metadata.pages ?? 1) > 1) return "Multi-page or animated image; all frames must be preserved.";
  if (metadata.icc) return "Embedded color profile; original color representation is preserved.";
  if ((metadata.depth && metadata.depth !== "uchar") || (metadata.bitsPerSample ?? 8) > 8) {
    return "High-bit-depth image; original sample precision is preserved.";
  }
  if (metadata.format === "png" && (metadata.orientation ?? 1) !== 1) {
    return "Oriented PNG; original orientation metadata is preserved.";
  }
  return undefined;
}

export async function assertImageCanBeTransformed(data: Buffer): Promise<void> {
  const metadata = await readImageMetadata("", data);
  if (metadata.preservationReason) throw new Error(metadata.preservationReason);
}

function isMaybeBmp(path: string, data: Buffer): boolean {
  return /\.bmp$/i.test(path) || (data.length >= 2 && data[0] === 0x42 && data[1] === 0x4d);
}
