import { createHash } from "node:crypto";
import sharp from "sharp";
import { decodeBmp } from "./bmp.js";
import { getRecommendedImagePixelBudgets } from "./imageDisplay.js";
import type { HwpxPackage, OptimizationOpportunity } from "./types.js";

const BALANCED_MAX_EDGE = 1920;
const BALANCED_JPEG_QUALITY = 88;
const AGGRESSIVE_MAX_EDGE = 1280;
const AGGRESSIVE_JPEG_QUALITY = 80;

export type ImageOptimizationProfile = {
  maxEdge: number;
  displayScale: number;
  jpegQuality: number;
  pngPalette: boolean;
  opportunityLabel: string;
};

export const balancedImageProfile: ImageOptimizationProfile = {
  maxEdge: BALANCED_MAX_EDGE,
  displayScale: 2,
  jpegQuality: BALANCED_JPEG_QUALITY,
  pngPalette: false,
  opportunityLabel: "Resize JPEG to document display budget"
};

export const aggressiveImageProfile: ImageOptimizationProfile = {
  maxEdge: AGGRESSIVE_MAX_EDGE,
  displayScale: 1,
  jpegQuality: AGGRESSIVE_JPEG_QUALITY,
  pngPalette: true,
  opportunityLabel: "Resize JPEG to aggressive document display budget"
};

export async function detectOptimizationOpportunities(
  pkg: HwpxPackage,
  profile: ImageOptimizationProfile = balancedImageProfile
): Promise<OptimizationOpportunity[]> {
  const opportunities: OptimizationOpportunity[] = [];
  const resizeBudgets = getRecommendedImagePixelBudgets(pkg, profile.displayScale);
  addDuplicateImageOpportunities(pkg, opportunities);

  for (const entry of pkg.entries) {
    if (entry.kind !== "image") continue;

    const metadata = await readMetadata(entry.data);
    const resizeBudget = normalizeResizeBudget(resizeBudgets.get(entry.path), profile);
    if (isJpeg(entry.path) && shouldResize(metadata.width, metadata.height, resizeBudget, profile)) {
      const candidate = await tryTransform(() => resizeJpeg(entry.data, resizeBudget, profile));
      if (!candidate) continue;
      addOpportunityIfSmaller(opportunities, {
        id: `resize-jpeg:${entry.path}`,
        label: resizeBudget ? profile.opportunityLabel : "Resize oversized JPEG and recompress with MozJPEG",
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
      const candidate = await tryTransform(() => convertBmpToPng(entry.data, metadata.width, metadata.height, resizeBudget, profile));
      if (!candidate) continue;
      addOpportunityIfSmaller(opportunities, {
        id: `convert-bmp-to-png:${entry.path}`,
        label: "Convert BMP to PNG",
        action: "convert-bmp-to-png",
        target: entry.path,
        beforeSize: entry.size,
        afterSize: candidate.byteLength,
        confidence: "exact",
        risk: "medium",
        visualImpact: metadata.width && metadata.height && Math.max(metadata.width, metadata.height) > profile.maxEdge ? "medium" : "low",
        defaultEnabledIn: ["balanced", "aggressive"]
      });
      continue;
    }

    if (isPng(entry.path)) {
      const candidate = await tryTransform(() => optimizePng(entry.data, profile));
      if (!candidate) continue;
      addOpportunityIfSmaller(opportunities, {
        id: `optimize-png:${entry.path}`,
        label: "Optimize PNG losslessly",
        action: "optimize-png",
        target: entry.path,
        beforeSize: entry.size,
        afterSize: candidate.byteLength,
        confidence: "exact",
        risk: "safe",
        visualImpact: "none",
        defaultEnabledIn: ["safe", "balanced", "aggressive"]
      });
    }
  }

  for (const entry of pkg.entries) {
    if (entry.kind !== "xml") continue;
    const cleaned = cleanShapeComments(entry.data.toString("utf8"));
    if (cleaned === entry.data.toString("utf8")) continue;
    addOpportunityIfSmaller(opportunities, {
      id: `clean-shape-comment:${entry.path}`,
      label: "Clean image shape comments",
      action: "clean-shape-comment",
      target: entry.path,
      beforeSize: entry.size,
      afterSize: Buffer.byteLength(cleaned),
      confidence: "exact",
      risk: "safe",
      visualImpact: "none",
      defaultEnabledIn: ["balanced", "aggressive"]
    });
  }

  return opportunities.sort((left, right) => right.estimatedSavingBytes - left.estimatedSavingBytes);
}

function addDuplicateImageOpportunities(pkg: HwpxPackage, opportunities: OptimizationOpportunity[]): void {
  const groups = new Map<string, Array<{ path: string; size: number }>>();
  for (const entry of pkg.entries) {
    if (entry.kind !== "image") continue;
    const hash = createHash("sha256").update(entry.data).digest("hex");
    const group = groups.get(hash) ?? [];
    group.push({ path: entry.path, size: entry.size });
    groups.set(hash, group);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sorted = group.sort((left, right) => left.path.localeCompare(right.path));
    for (const duplicate of sorted.slice(1)) {
      opportunities.push({
        id: `consolidate-duplicate-images:${duplicate.path}`,
        label: "Consolidate duplicate image references",
        action: "consolidate-duplicate-images",
        target: duplicate.path,
        beforeSize: duplicate.size,
        afterSize: 0,
        estimatedSavingBytes: duplicate.size,
        confidence: "exact",
        risk: "medium",
        visualImpact: "none",
        defaultEnabledIn: ["balanced", "aggressive"]
      });
    }
  }
}

async function tryTransform(operation: () => Promise<Buffer>): Promise<Buffer | null> {
  try {
    return await operation();
  } catch {
    return null;
  }
}

export async function transformImageBalanced(path: string, data: Buffer): Promise<{ outputPath: string; data: Buffer }> {
  return transformImageBalancedWithBudget(path, data);
}

export async function transformImageBalancedWithBudget(
  path: string,
  data: Buffer,
  budget?: { width: number; height: number },
  profile: ImageOptimizationProfile = balancedImageProfile
): Promise<{ outputPath: string; data: Buffer }> {
  const metadata = await readMetadata(data);
  const resizeBudget = normalizeResizeBudget(budget, profile);
  if (isBmp(path)) {
    return {
      outputPath: replaceExtension(path, ".png"),
      data: await convertBmpToPng(data, metadata.width, metadata.height, resizeBudget, profile)
    };
  }
  if (isJpeg(path) && shouldResize(metadata.width, metadata.height, resizeBudget)) {
    return {
      outputPath: replaceExtension(path, ".jpg"),
      data: await resizeJpeg(data, resizeBudget, profile)
    };
  }
  if (isPng(path)) {
    return {
      outputPath: path,
      data: await optimizePng(data, profile)
    };
  }
  return { outputPath: path, data };
}

export function cleanShapeComments(xml: string): string {
  return xml.replace(/<hp:shapeComment>[\s\S]*?<\/hp:shapeComment>/g, "<hp:shapeComment>그림입니다.</hp:shapeComment>");
}

export function outputMediaType(path: string): string {
  if (/\.png$/i.test(path)) return "image/png";
  if (/\.jpe?g$/i.test(path)) return "image/jpg";
  if (/\.bmp$/i.test(path)) return "image/bmp";
  return "application/octet-stream";
}

async function convertBmpToPng(
  data: Buffer,
  width?: number,
  height?: number,
  budget?: { width: number; height: number },
  profile: ImageOptimizationProfile = balancedImageProfile
): Promise<Buffer> {
  const bmp = decodeBmp(data);
  const image = bmp ? sharp(bmp.data, { raw: { width: bmp.width, height: bmp.height, channels: 3 } }) : sharp(data);
  const sourceWidth = bmp?.width ?? width;
  const sourceHeight = bmp?.height ?? height;
  const target = budget ?? { width: profile.maxEdge, height: profile.maxEdge };
  const resized =
    sourceWidth && sourceHeight && shouldResize(sourceWidth, sourceHeight, budget, profile)
      ? image.resize({
          width: target.width,
          height: target.height,
          fit: "inside",
          withoutEnlargement: true,
          kernel: "lanczos3"
        })
      : image;
  return resized.png({ compressionLevel: 9, adaptiveFiltering: true, palette: profile.pngPalette }).toBuffer();
}

async function resizeJpeg(
  data: Buffer,
  budget?: { width: number; height: number },
  profile: ImageOptimizationProfile = balancedImageProfile
): Promise<Buffer> {
  const target = budget ?? { width: profile.maxEdge, height: profile.maxEdge };
  return sharp(data)
    .rotate()
    .resize({
      width: target.width,
      height: target.height,
      fit: "inside",
      withoutEnlargement: true,
      kernel: "lanczos3"
    })
    .jpeg({ quality: profile.jpegQuality, mozjpeg: true, progressive: true })
    .toBuffer();
}

async function optimizePng(data: Buffer, profile: ImageOptimizationProfile = balancedImageProfile): Promise<Buffer> {
  return sharp(data).png({ compressionLevel: 9, adaptiveFiltering: true, palette: profile.pngPalette }).toBuffer();
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

function shouldResize(
  width?: number,
  height?: number,
  budget?: { width: number; height: number },
  profile: ImageOptimizationProfile = balancedImageProfile
): boolean {
  if (!width || !height) return false;
  const target = budget ?? { width: profile.maxEdge, height: profile.maxEdge };
  return width > target.width || height > target.height;
}

function normalizeResizeBudget(
  budget?: { width: number; height: number },
  profile: ImageOptimizationProfile = balancedImageProfile
): { width: number; height: number } | undefined {
  if (!budget || budget.width <= 0 || budget.height <= 0) return undefined;
  return {
    width: Math.min(profile.maxEdge, Math.ceil(budget.width)),
    height: Math.min(profile.maxEdge, Math.ceil(budget.height))
  };
}

function isBmp(path: string): boolean {
  return /\.bmp$/i.test(path);
}

function isJpeg(path: string): boolean {
  return /\.jpe?g$/i.test(path);
}

function isPng(path: string): boolean {
  return /\.png$/i.test(path);
}

function replaceExtension(path: string, extension: string): string {
  return path.replace(/\.[^.\/]+$/, extension);
}
