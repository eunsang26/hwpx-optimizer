import sharp from "sharp";
import { decodeBmp } from "./bmp.js";
import type { HwpxPackage, OptimizationOpportunity } from "./types.js";

const BALANCED_MAX_EDGE = 1920;
const BALANCED_JPEG_QUALITY = 88;

export async function detectOptimizationOpportunities(pkg: HwpxPackage): Promise<OptimizationOpportunity[]> {
  const opportunities: OptimizationOpportunity[] = [];

  for (const entry of pkg.entries) {
    if (entry.kind !== "image") continue;

    const metadata = await readMetadata(entry.data);
    if (isJpeg(entry.path) && metadata.width && metadata.height && Math.max(metadata.width, metadata.height) > BALANCED_MAX_EDGE) {
      const candidate = await resizeJpegBalanced(entry.data);
      addOpportunityIfSmaller(opportunities, {
        id: `resize-jpeg:${entry.path}`,
        label: "Resize oversized JPEG and recompress with MozJPEG",
        action: "resize-jpeg",
        target: entry.path,
        beforeSize: entry.size,
        afterSize: candidate.byteLength,
        confidence: "exact",
        risk: "medium",
        visualImpact: "medium",
        defaultEnabledIn: ["balanced", "aggressive"]
      });
      continue;
    }

    if (isBmp(entry.path)) {
      const candidate = await convertBmpToPngBalanced(entry.data, metadata.width, metadata.height);
      addOpportunityIfSmaller(opportunities, {
        id: `convert-bmp-to-png:${entry.path}`,
        label: "Convert BMP to PNG",
        action: "convert-bmp-to-png",
        target: entry.path,
        beforeSize: entry.size,
        afterSize: candidate.byteLength,
        confidence: "exact",
        risk: "medium",
        visualImpact: metadata.width && metadata.height && Math.max(metadata.width, metadata.height) > BALANCED_MAX_EDGE ? "medium" : "low",
        defaultEnabledIn: ["balanced", "aggressive"]
      });
    }
  }

  return opportunities.sort((left, right) => right.estimatedSavingBytes - left.estimatedSavingBytes);
}

export async function transformImageBalanced(path: string, data: Buffer): Promise<{ outputPath: string; data: Buffer }> {
  const metadata = await readMetadata(data);
  if (isBmp(path)) {
    return {
      outputPath: replaceExtension(path, ".png"),
      data: await convertBmpToPngBalanced(data, metadata.width, metadata.height)
    };
  }
  if (isJpeg(path) && metadata.width && metadata.height && Math.max(metadata.width, metadata.height) > BALANCED_MAX_EDGE) {
    return {
      outputPath: replaceExtension(path, ".jpg"),
      data: await resizeJpegBalanced(data)
    };
  }
  return { outputPath: path, data };
}

export function outputMediaType(path: string): string {
  if (/\.png$/i.test(path)) return "image/png";
  if (/\.jpe?g$/i.test(path)) return "image/jpg";
  if (/\.bmp$/i.test(path)) return "image/bmp";
  return "application/octet-stream";
}

async function convertBmpToPngBalanced(data: Buffer, width?: number, height?: number): Promise<Buffer> {
  const bmp = decodeBmp(data);
  const image = bmp ? sharp(bmp.data, { raw: { width: bmp.width, height: bmp.height, channels: 3 } }) : sharp(data);
  const sourceWidth = bmp?.width ?? width;
  const sourceHeight = bmp?.height ?? height;
  const resized =
    sourceWidth && sourceHeight && Math.max(sourceWidth, sourceHeight) > BALANCED_MAX_EDGE
      ? image.resize({
          width: BALANCED_MAX_EDGE,
          height: BALANCED_MAX_EDGE,
          fit: "inside",
          withoutEnlargement: true,
          kernel: "lanczos3"
        })
      : image;
  return resized.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
}

async function resizeJpegBalanced(data: Buffer): Promise<Buffer> {
  return sharp(data)
    .rotate()
    .resize({
      width: BALANCED_MAX_EDGE,
      height: BALANCED_MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
      kernel: "lanczos3"
    })
    .jpeg({ quality: BALANCED_JPEG_QUALITY, mozjpeg: true, progressive: true })
    .toBuffer();
}

async function readMetadata(data: Buffer): Promise<{ width?: number; height?: number }> {
  const bmp = decodeBmp(data);
  if (bmp) return { width: bmp.width, height: bmp.height };

  try {
    const metadata = await sharp(data).metadata();
    return { width: metadata.width, height: metadata.height };
  } catch {
    return {};
  }
}

function addOpportunityIfSmaller(
  opportunities: OptimizationOpportunity[],
  input: Omit<OptimizationOpportunity, "estimatedSavingBytes">
): void {
  const estimatedSavingBytes = input.beforeSize - input.afterSize;
  if (estimatedSavingBytes <= 0) return;
  opportunities.push({ ...input, estimatedSavingBytes });
}

function isBmp(path: string): boolean {
  return /\.bmp$/i.test(path);
}

function isJpeg(path: string): boolean {
  return /\.jpe?g$/i.test(path);
}

function replaceExtension(path: string, extension: string): string {
  return path.replace(/\.[^.\/]+$/, extension);
}
