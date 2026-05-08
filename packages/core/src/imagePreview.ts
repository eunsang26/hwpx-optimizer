import { createHash } from "node:crypto";
import sharp from "sharp";
import { decodeBmp } from "./bmp.js";
import { readHwpxPackage } from "./reader.js";
import type { HwpxEntry } from "./types.js";

export type ImagePreviewPair = {
  originalPath: string;
  outputPath: string;
  originalSize: number;
  outputSize: number;
  savedBytes: number;
  originalFormat: string;
  outputFormat: string;
  originalThumbnailDataUrl: string;
  outputThumbnailDataUrl: string;
  psnrDb: number | null;
};

export type ImagePreviewOptions = {
  maxItems?: number;
  thumbnailMaxEdge?: number;
  thumbnailQuality?: number;
  psnrSampleSize?: number;
};

const PSNR_DEFAULT_SAMPLE_SIZE = 256;
const PSNR_MAX_DB = 80;

export async function extractImageDiffPreviews(
  originalBuffer: Buffer,
  optimizedBuffer: Buffer,
  options: ImagePreviewOptions = {}
): Promise<ImagePreviewPair[]> {
  const maxItems = options.maxItems ?? 12;
  const thumbnailMaxEdge = options.thumbnailMaxEdge ?? 200;
  const thumbnailQuality = options.thumbnailQuality ?? 72;
  const psnrSampleSize = options.psnrSampleSize ?? PSNR_DEFAULT_SAMPLE_SIZE;

  const [originalPkg, outputPkg] = await Promise.all([
    readHwpxPackage(originalBuffer),
    readHwpxPackage(optimizedBuffer)
  ]);

  const originalImages = new Map<string, HwpxEntry>();
  for (const entry of originalPkg.entries) {
    if (entry.kind === "image") originalImages.set(entry.path, entry);
  }
  const outputImages = new Map<string, HwpxEntry>();
  for (const entry of outputPkg.entries) {
    if (entry.kind === "image") outputImages.set(entry.path, entry);
  }

  type Candidate = { original: HwpxEntry; output: HwpxEntry; savedBytes: number };
  const candidates: Candidate[] = [];

  for (const [path, output] of outputImages) {
    const original = matchOriginalImage(originalImages, path);
    if (!original) continue;
    if (original.size === output.size && hashesEqual(original.data, output.data)) continue;
    candidates.push({ original, output, savedBytes: original.size - output.size });
  }

  candidates.sort((left, right) => right.savedBytes - left.savedBytes);
  const top = candidates.slice(0, maxItems);

  return Promise.all(
    top.map(async ({ original, output, savedBytes }) => {
      const [originalThumbnailDataUrl, outputThumbnailDataUrl, psnrDb] = await Promise.all([
        renderThumbnailDataUrl(original.data, thumbnailMaxEdge, thumbnailQuality),
        renderThumbnailDataUrl(output.data, thumbnailMaxEdge, thumbnailQuality),
        computePsnr(original.data, output.data, psnrSampleSize)
      ]);
      return {
        originalPath: original.path,
        outputPath: output.path,
        originalSize: original.size,
        outputSize: output.size,
        savedBytes,
        originalFormat: imageFormatFromPath(original.path),
        outputFormat: imageFormatFromPath(output.path),
        originalThumbnailDataUrl,
        outputThumbnailDataUrl,
        psnrDb
      };
    })
  );
}

export async function computePsnr(original: Buffer, optimized: Buffer, sampleSize = PSNR_DEFAULT_SAMPLE_SIZE): Promise<number | null> {
  try {
    const [originalRaw, optimizedRaw] = await Promise.all([
      decodeForPsnr(original, sampleSize),
      decodeForPsnr(optimized, sampleSize)
    ]);
    if (!originalRaw || !optimizedRaw || originalRaw.length !== optimizedRaw.length) return null;

    let sumSquaredError = 0;
    for (let index = 0; index < originalRaw.length; index += 1) {
      const diff = originalRaw[index]! - optimizedRaw[index]!;
      sumSquaredError += diff * diff;
    }
    const mse = sumSquaredError / originalRaw.length;
    if (mse === 0) return PSNR_MAX_DB;
    const psnr = 10 * Math.log10((255 * 255) / mse);
    return Math.min(psnr, PSNR_MAX_DB);
  } catch {
    return null;
  }
}

async function decodeForPsnr(data: Buffer, sampleSize: number): Promise<Buffer | null> {
  try {
    const bmp = decodeBmp(data);
    const pipeline = bmp
      ? sharp(bmp.data, { raw: { width: bmp.width, height: bmp.height, channels: 3 } })
      : sharp(data);
    return await pipeline
      .rotate()
      .removeAlpha()
      .resize(sampleSize, sampleSize, { fit: "fill", kernel: "lanczos3" })
      .raw()
      .toBuffer();
  } catch {
    return null;
  }
}

function matchOriginalImage(originalImages: Map<string, HwpxEntry>, outputPath: string): HwpxEntry | undefined {
  const direct = originalImages.get(outputPath);
  if (direct) return direct;
  const candidates = ["bmp", "png", "jpg", "jpeg"];
  for (const ext of candidates) {
    const candidate = outputPath.replace(/\.[^.\/]+$/, `.${ext}`);
    if (candidate === outputPath) continue;
    const match = originalImages.get(candidate);
    if (match) return match;
  }
  return undefined;
}

async function renderThumbnailDataUrl(data: Buffer, maxEdge: number, quality: number): Promise<string> {
  const buffer = await renderThumbnail(data, maxEdge, quality);
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

async function renderThumbnail(data: Buffer, maxEdge: number, quality: number): Promise<Buffer> {
  const bmp = decodeBmp(data);
  const pipeline = bmp
    ? sharp(bmp.data, { raw: { width: bmp.width, height: bmp.height, channels: 3 } })
    : sharp(data);
  return pipeline
    .rotate()
    .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true, kernel: "lanczos3" })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
}

function imageFormatFromPath(path: string): string {
  const match = /\.([^.\/]+)$/.exec(path);
  if (!match) return "unknown";
  const ext = match[1]!.toLowerCase();
  if (ext === "jpg") return "jpeg";
  return ext;
}

function hashesEqual(left: Buffer, right: Buffer): boolean {
  if (left.byteLength !== right.byteLength) return false;
  const leftHash = createHash("sha256").update(left).digest("hex");
  const rightHash = createHash("sha256").update(right).digest("hex");
  return leftHash === rightHash;
}
