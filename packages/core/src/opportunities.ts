import sharp from "sharp";
import { decodeBmp } from "./bmp.js";
import { findImageConsolidationGroups } from "./imageDuplicates.js";
import { getRecommendedImagePixelBudgets } from "./imageDisplay.js";
import { stripJpegMetadataSegments } from "./optimizer.js";
import type { HwpxPackage, OptimizationOpportunity } from "./types.js";

const BALANCED_MAX_EDGE = 1920;
const BALANCED_JPEG_QUALITY = 88;
const AGGRESSIVE_MAX_EDGE = 1280;
const AGGRESSIVE_JPEG_QUALITY = 80;
const JPEG_METADATA_MIN_SAVING_BYTES = 256;
const JPEG_METADATA_MIN_SAVING_RATIO = 0.005;

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

export type OpportunityConfidence = "exact" | "estimated";
export type TransformImageAction =
  | "convert-bmp-to-png"
  | "convert-tiff-to-png"
  | "resize-jpeg"
  | "resize-png"
  | "strip-metadata"
  | "optimize-png";

export async function detectOptimizationOpportunities(
  pkg: HwpxPackage,
  profile: ImageOptimizationProfile = balancedImageProfile
): Promise<OptimizationOpportunity[]> {
  return collectOpportunities(pkg, profile, "exact");
}

export async function detectEstimatedOptimizationOpportunities(
  pkg: HwpxPackage,
  profile: ImageOptimizationProfile = balancedImageProfile
): Promise<OptimizationOpportunity[]> {
  return collectOpportunities(pkg, profile, "estimated");
}

async function collectOpportunities(
  pkg: HwpxPackage,
  profile: ImageOptimizationProfile,
  confidence: OpportunityConfidence
): Promise<OptimizationOpportunity[]> {
  const opportunities: OptimizationOpportunity[] = [];
  const resizeBudgets = getRecommendedImagePixelBudgets(pkg, profile.displayScale);
  await addDuplicateImageOpportunities(pkg, opportunities);

  for (const entry of pkg.entries) {
    if (entry.kind !== "image") continue;

    const metadata = await readMetadata(entry.data);
    const resizeBudget = normalizeResizeBudget(resizeBudgets.get(entry.path), profile);
    if (isJpeg(entry.path) && shouldResize(metadata.width, metadata.height, resizeBudget, profile)) {
      const afterSize = await measureOrEstimateImageSize({
        confidence,
        size: entry.size,
        transform: () => resizeJpeg(entry.data, resizeBudget, profile),
        estimate: () => estimateJpegResizeSize(entry.size, metadata.width, metadata.height, resizeBudget, profile)
      });
      if (
        afterSize !== null &&
        addOpportunityIfSmaller(opportunities, {
          id: `resize-jpeg:${entry.path}`,
          label: resizeBudget ? profile.opportunityLabel : "Resize oversized JPEG and recompress with MozJPEG",
          action: "resize-jpeg",
          target: entry.path,
          beforeSize: entry.size,
          afterSize,
          confidence,
          risk: "medium",
          visualImpact: "medium",
          defaultEnabledIn: ["balanced", "aggressive"]
        })
      ) {
        continue;
      }
    }

    if (isJpeg(entry.path)) {
      addJpegMetadataOpportunity(opportunities, entry.path, entry.data, entry.size, confidence);
      continue;
    }

    if (isBmp(entry.path)) {
      const afterSize = await measureOrEstimateImageSize({
        confidence,
        size: entry.size,
        transform: () => convertBmpToPng(entry.data, metadata.width, metadata.height, resizeBudget, profile),
        estimate: () => estimateBmpPngSize(entry.size, metadata.width, metadata.height, resizeBudget, profile)
      });
      if (afterSize === null) continue;
      addOpportunityIfSmaller(opportunities, {
        id: `convert-bmp-to-png:${entry.path}`,
        label: "Convert BMP to PNG",
        action: "convert-bmp-to-png",
        target: entry.path,
        beforeSize: entry.size,
        afterSize,
        confidence,
        risk: "medium",
        visualImpact:
          metadata.width && metadata.height && Math.max(metadata.width, metadata.height) > profile.maxEdge
            ? "medium"
            : "low",
        defaultEnabledIn: ["balanced", "aggressive"]
      });
      continue;
    }

    if (isTiff(entry.path)) {
      const afterSize = await measureTiffPngSize({
        data: entry.data,
        width: metadata.width,
        height: metadata.height,
        resizeBudget,
        profile
      });
      if (afterSize === null) continue;
      addOpportunityIfSmaller(opportunities, {
        id: `convert-tiff-to-png:${entry.path}`,
        label: "Convert TIFF to PNG",
        action: "convert-tiff-to-png",
        target: entry.path,
        beforeSize: entry.size,
        afterSize,
        confidence,
        risk: "medium",
        visualImpact:
          metadata.width && metadata.height && Math.max(metadata.width, metadata.height) > profile.maxEdge
            ? "medium"
            : "low",
        defaultEnabledIn: ["balanced", "aggressive"]
      });
      continue;
    }

    if (isPng(entry.path) && (confidence === "exact" || entry.size > 4096)) {
      if (shouldResize(metadata.width, metadata.height, resizeBudget, profile)) {
        const afterSize = await measureOrEstimateImageSize({
          confidence,
          size: entry.size,
          transform: () => resizePng(entry.data, resizeBudget, profile),
          estimate: () => estimatePngResizeSize(entry.size, metadata.width, metadata.height, resizeBudget, profile)
        });
        if (
          afterSize !== null &&
          addOpportunityIfSmaller(opportunities, {
            id: `resize-png:${entry.path}`,
            label: "Resize PNG to document display budget",
            action: "resize-png",
            target: entry.path,
            beforeSize: entry.size,
            afterSize,
            confidence,
            risk: "medium",
            visualImpact: "low",
            defaultEnabledIn: ["balanced", "aggressive"]
          })
        ) {
          continue;
        }
      }

      const afterSize = await measureOrEstimateImageSize({
        confidence,
        size: entry.size,
        transform: () => optimizePng(entry.data, profile),
        estimate: () => Math.round(entry.size * (profile.pngPalette ? 0.8 : 0.95))
      });
      if (afterSize === null) continue;
      addOpportunityIfSmaller(opportunities, {
        id: `optimize-png:${entry.path}`,
        label: "Optimize PNG losslessly",
        action: "optimize-png",
        target: entry.path,
        beforeSize: entry.size,
        afterSize,
        confidence,
        risk: "safe",
        visualImpact: "none",
        defaultEnabledIn: ["safe", "balanced", "aggressive"]
      });
    }
  }

  addShapeCommentOpportunities(pkg, opportunities);
  return opportunities.sort((left, right) => right.estimatedSavingBytes - left.estimatedSavingBytes);
}

async function measureOrEstimateImageSize(input: {
  confidence: OpportunityConfidence;
  size: number;
  transform: () => Promise<Buffer>;
  estimate: () => number;
}): Promise<number | null> {
  if (input.confidence === "estimated") return input.estimate();
  const candidate = await tryTransform(input.transform);
  return candidate ? candidate.byteLength : null;
}

async function addDuplicateImageOpportunities(pkg: HwpxPackage, opportunities: OptimizationOpportunity[]): Promise<void> {
  const seenTargets = new Set<string>();
  const sizesByPath = new Map(pkg.entries.filter((entry) => entry.kind === "image").map((entry) => [entry.path, entry.size]));
  for (const group of await findImageConsolidationGroups(pkg)) {
    for (const duplicatePath of group.paths) {
      if (duplicatePath === group.canonicalPath || seenTargets.has(duplicatePath)) continue;
      const size = sizesByPath.get(duplicatePath);
      if (size === undefined) continue;
      seenTargets.add(duplicatePath);
      opportunities.push({
        id: `consolidate-duplicate-images:${duplicatePath}`,
        label: "Consolidate duplicate image references",
        action: "consolidate-duplicate-images",
        target: duplicatePath,
        beforeSize: size,
        afterSize: 0,
        estimatedSavingBytes: size,
        confidence: "exact",
        risk: "medium",
        visualImpact: "none",
        defaultEnabledIn: ["balanced", "aggressive"]
      });
    }
  }
}

function addJpegMetadataOpportunity(
  opportunities: OptimizationOpportunity[],
  path: string,
  data: Buffer,
  size: number,
  confidence: OpportunityConfidence
): void {
  const stripped = stripJpegMetadataSegments(data);
  const savedBytes = size - stripped.byteLength;
  if (savedBytes < JPEG_METADATA_MIN_SAVING_BYTES || savedBytes / size < JPEG_METADATA_MIN_SAVING_RATIO) {
    return;
  }
  addOpportunityIfSmaller(opportunities, {
    id: `strip-metadata:${path}`,
    label: "Strip JPEG metadata",
    action: "strip-metadata",
    target: path,
    beforeSize: size,
    afterSize: stripped.byteLength,
    confidence,
    risk: "safe",
    visualImpact: "none",
    defaultEnabledIn: ["balanced", "aggressive"]
  });
}

async function measureTiffPngSize(input: {
  data: Buffer;
  width?: number;
  height?: number;
  resizeBudget?: { width: number; height: number };
  profile: ImageOptimizationProfile;
}): Promise<number | null> {
  const candidate = await tryTransform(() =>
    convertTiffToPng(input.data, input.width, input.height, input.resizeBudget, input.profile)
  );
  return candidate ? candidate.byteLength : null;
}

function addShapeCommentOpportunities(pkg: HwpxPackage, opportunities: OptimizationOpportunity[]): void {
  for (const entry of pkg.entries) {
    if (entry.kind !== "xml") continue;
    const source = entry.data.toString("utf8");
    const cleaned = cleanShapeComments(source);
    if (cleaned === source) continue;
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
  if (isTiff(path)) {
    return {
      outputPath: replaceExtension(path, ".png"),
      data: await convertTiffToPng(data, metadata.width, metadata.height, resizeBudget, profile)
    };
  }
  if (isJpeg(path) && shouldResize(metadata.width, metadata.height, resizeBudget)) {
    return {
      outputPath: replaceExtension(path, ".jpg"),
      data: await resizeJpeg(data, resizeBudget, profile)
    };
  }
  if (isJpeg(path)) {
    return {
      outputPath: path,
      data: stripJpegMetadataSegments(data)
    };
  }
  if (isPng(path)) {
    if (shouldResize(metadata.width, metadata.height, resizeBudget, profile)) {
      return {
        outputPath: path,
        data: await resizePng(data, resizeBudget, profile)
      };
    }
    return {
      outputPath: path,
      data: await optimizePng(data, profile)
    };
  }
  return { outputPath: path, data };
}

export async function transformImageActionWithBudget(
  path: string,
  data: Buffer,
  action: TransformImageAction,
  budget?: { width: number; height: number },
  profile: ImageOptimizationProfile = balancedImageProfile
): Promise<{ outputPath: string; data: Buffer }> {
  const metadata = await readMetadata(data);
  const resizeBudget = normalizeResizeBudget(budget, profile);
  if (action === "convert-bmp-to-png") {
    return {
      outputPath: replaceExtension(path, ".png"),
      data: await convertBmpToPng(data, metadata.width, metadata.height, resizeBudget, profile)
    };
  }
  if (action === "convert-tiff-to-png") {
    return {
      outputPath: replaceExtension(path, ".png"),
      data: await convertTiffToPng(data, metadata.width, metadata.height, resizeBudget, profile)
    };
  }
  if (action === "resize-jpeg") {
    return { outputPath: replaceExtension(path, ".jpg"), data: await resizeJpeg(data, resizeBudget, profile) };
  }
  if (action === "resize-png") {
    return { outputPath: path, data: await resizePng(data, resizeBudget, profile) };
  }
  if (action === "strip-metadata") {
    return { outputPath: path, data: stripJpegMetadataSegments(data) };
  }
  if (action === "optimize-png") {
    return { outputPath: path, data: await optimizePng(data, profile) };
  }
  return { outputPath: path, data };
}

export function cleanShapeComments(xml: string): string {
  return xml.replace(/<hp:shapeComment>[\s\S]*?<\/hp:shapeComment>/g, "<hp:shapeComment>그림입니다.</hp:shapeComment>");
}

export function outputMediaType(path: string): string {
  if (/\.png$/i.test(path)) return "image/png";
  if (/\.jpe?g$/i.test(path)) return "image/jpeg";
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

async function convertTiffToPng(
  data: Buffer,
  width?: number,
  height?: number,
  budget?: { width: number; height: number },
  profile: ImageOptimizationProfile = balancedImageProfile
): Promise<Buffer> {
  const image = sharp(data);
  const target = budget ?? { width: profile.maxEdge, height: profile.maxEdge };
  const resized =
    width && height && shouldResize(width, height, budget, profile)
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
  return sharp(data, { failOn: "none" })
    .resize({
      width: target.width,
      height: target.height,
      fit: "inside",
      withoutEnlargement: true,
      kernel: "lanczos3"
    })
    .keepExif()
    .jpeg({ quality: profile.jpegQuality, mozjpeg: true, progressive: true })
    .toBuffer();
}

async function resizePng(
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
    .png({ compressionLevel: 9, adaptiveFiltering: true, palette: profile.pngPalette })
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
): boolean {
  const estimatedSavingBytes = input.beforeSize - input.afterSize;
  if (estimatedSavingBytes <= 0) return false;
  opportunities.push({ ...input, estimatedSavingBytes });
  return true;
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

function estimateJpegResizeSize(
  size: number,
  width: number | undefined,
  height: number | undefined,
  budget: { width: number; height: number } | undefined,
  profile: ImageOptimizationProfile
): number {
  const pixelRatio = estimatePixelRatio(width, height, budget ?? { width: profile.maxEdge, height: profile.maxEdge });
  const qualityRatio = profile.jpegQuality / 95;
  return Math.max(1024, Math.round(size * Math.min(0.95, pixelRatio * qualityRatio * 1.1)));
}

function estimateBmpPngSize(
  size: number,
  width: number | undefined,
  height: number | undefined,
  budget: { width: number; height: number } | undefined,
  profile: ImageOptimizationProfile
): number {
  const pixelRatio = estimatePixelRatio(width, height, budget ?? { width: profile.maxEdge, height: profile.maxEdge });
  const pngCompressionRatio = profile.pngPalette ? 0.35 : 0.5;
  return Math.max(1024, Math.round(size * pixelRatio * pngCompressionRatio));
}

function estimatePngResizeSize(
  size: number,
  width: number | undefined,
  height: number | undefined,
  budget: { width: number; height: number } | undefined,
  profile: ImageOptimizationProfile
): number {
  const pixelRatio = estimatePixelRatio(width, height, budget ?? { width: profile.maxEdge, height: profile.maxEdge });
  const compressionRatio = profile.pngPalette ? 0.7 : 0.9;
  return Math.max(1024, Math.round(size * Math.min(0.95, pixelRatio * compressionRatio)));
}

function estimatePixelRatio(
  width: number | undefined,
  height: number | undefined,
  budget: { width: number; height: number }
): number {
  if (!width || !height) return 0.75;
  const scale = Math.min(1, budget.width / width, budget.height / height);
  return Math.max(0.01, scale * scale);
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

function isTiff(path: string): boolean {
  return /\.tiff?$/i.test(path);
}

function replaceExtension(path: string, extension: string): string {
  return path.replace(/\.[^.\/]+$/, extension);
}
