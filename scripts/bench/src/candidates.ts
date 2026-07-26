import sharp from "sharp";
import type { ImageOptimizationProfile } from "@hwpx-optimizer/core";
import type { EncodeResult, RawImage } from "./types.js";
import { encodeRawWithJpegli, resolveJpegliBin } from "./jpegliCli.js";

export { resolveJpegliBin } from "./jpegliCli.js";

export async function encodeMozjpeg(raw: RawImage, quality: number): Promise<EncodeResult> {
  const start = performance.now();
  const bytes = await sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 3 } })
    .jpeg({ quality, mozjpeg: true, progressive: true })
    .toBuffer();
  return {
    bytes,
    encodeMs: performance.now() - start,
    quality,
    candidate: "mozjpeg"
  };
}

export async function encodeJpegli(raw: RawImage, quality: number): Promise<EncodeResult> {
  const bin = resolveJpegliBin();
  if (!bin) {
    throw new Error("jpegli CLI not found (set HWPX_BENCH_JPEGLI or install cjpegli on PATH)");
  }
  const { bytes, encodeMs } = await encodeRawWithJpegli(raw, quality, bin);
  return { bytes, encodeMs, quality, candidate: "jpegli" };
}

export async function encodePng(raw: RawImage, profile: ImageOptimizationProfile): Promise<EncodeResult> {
  const start = performance.now();
  const bytes = await sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 3 } })
    .png({
      compressionLevel: Math.max(1, Math.min(9, Math.floor(profile.pngCompressionLevel))),
      adaptiveFiltering: true,
      palette: profile.pngPalette
    })
    .toBuffer();
  return {
    bytes,
    encodeMs: performance.now() - start,
    quality: profile.pngCompressionLevel,
    candidate: "png"
  };
}

export async function encodeWebp(raw: RawImage, quality: number): Promise<EncodeResult> {
  const start = performance.now();
  const bytes = await sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 3 } })
    .webp({ quality })
    .toBuffer();
  return {
    bytes,
    encodeMs: performance.now() - start,
    quality,
    candidate: "webp"
  };
}
