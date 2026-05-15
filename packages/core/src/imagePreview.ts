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

export type VisualMetrics = {
  psnr: number | null;
  ssim: number | null;
};

const PSNR_DEFAULT_SAMPLE_SIZE = 256;
const PSNR_MAX_DB = 80;
const SSIM_DEFAULT_SAMPLE_SIZE = 256;

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
        computeVisualMetrics(original.data, output.data, psnrSampleSize).then((metrics) => metrics.psnr)
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
  return (await computeVisualMetrics(original, optimized, sampleSize)).psnr;
}

export async function computeSsim(original: Buffer, optimized: Buffer, sampleSize = SSIM_DEFAULT_SAMPLE_SIZE): Promise<number | null> {
  return (await computeVisualMetrics(original, optimized, sampleSize)).ssim;
}

export async function computeVisualMetrics(
  original: Buffer,
  optimized: Buffer,
  sampleSize = PSNR_DEFAULT_SAMPLE_SIZE
): Promise<VisualMetrics> {
  try {
    const [originalRaw, optimizedRaw] = await Promise.all([
      decodeForMetrics(original, sampleSize),
      decodeForMetrics(optimized, sampleSize)
    ]);
    if (!originalRaw || !optimizedRaw || originalRaw.length !== optimizedRaw.length) {
      return { psnr: null, ssim: null };
    }

    let sumSquaredError = 0;
    for (let index = 0; index < originalRaw.length; index += 1) {
      const diff = originalRaw[index]! - optimizedRaw[index]!;
      sumSquaredError += diff * diff;
    }
    const mse = sumSquaredError / originalRaw.length;
    const psnr = mse === 0 ? PSNR_MAX_DB : Math.min(10 * Math.log10((255 * 255) / mse), PSNR_MAX_DB);
    return { psnr, ssim: computeSsimFromRgbSamples(originalRaw, optimizedRaw) };
  } catch {
    return { psnr: null, ssim: null };
  }
}

function computeSsimFromRgbSamples(originalRaw: Buffer, optimizedRaw: Buffer): number | null {
  if (originalRaw.length !== optimizedRaw.length || originalRaw.length === 0 || originalRaw.length % 3 !== 0) return null;
  const pixelCount = originalRaw.length / 3;
  const originalGray = new Float64Array(pixelCount);
  const optimizedGray = new Float64Array(pixelCount);

  let meanOriginal = 0;
  let meanOptimized = 0;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 3;
    const originalValue = 0.299 * originalRaw[offset]! + 0.587 * originalRaw[offset + 1]! + 0.114 * originalRaw[offset + 2]!;
    const optimizedValue = 0.299 * optimizedRaw[offset]! + 0.587 * optimizedRaw[offset + 1]! + 0.114 * optimizedRaw[offset + 2]!;
    originalGray[pixel] = originalValue;
    optimizedGray[pixel] = optimizedValue;
    meanOriginal += originalValue;
    meanOptimized += optimizedValue;
  }
  meanOriginal /= pixelCount;
  meanOptimized /= pixelCount;

  let varianceOriginal = 0;
  let varianceOptimized = 0;
  let covariance = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    const originalDelta = originalGray[index]! - meanOriginal;
    const optimizedDelta = optimizedGray[index]! - meanOptimized;
    varianceOriginal += originalDelta * originalDelta;
    varianceOptimized += optimizedDelta * optimizedDelta;
    covariance += originalDelta * optimizedDelta;
  }
  const denominator = Math.max(1, pixelCount - 1);
  varianceOriginal /= denominator;
  varianceOptimized /= denominator;
  covariance /= denominator;

  const c1 = (0.01 * 255) ** 2;
  const c2 = (0.03 * 255) ** 2;
  const numerator = (2 * meanOriginal * meanOptimized + c1) * (2 * covariance + c2);
  const ssimDenominator = (meanOriginal ** 2 + meanOptimized ** 2 + c1) * (varianceOriginal + varianceOptimized + c2);
  if (ssimDenominator === 0) return 1;
  return Math.max(-1, Math.min(1, numerator / ssimDenominator));
}

async function decodeForMetrics(data: Buffer, sampleSize: number): Promise<Buffer | null> {
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
