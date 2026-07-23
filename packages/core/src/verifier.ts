import { XMLParser, XMLValidator } from "fast-xml-parser";
import sharp from "sharp";
import { analyzeHwpxPackage } from "./analyzer.js";
import { findImageConsolidationGroups } from "./imageDuplicates.js";
import { computeVisualMetrics } from "./imagePreview.js";
import { buildReferenceGraph } from "./referenceGraph.js";
import { readHwpxPackage } from "./reader.js";
import type { HwpxEntry, HwpxPackage, ImageInventoryItem } from "./types.js";

export type VerifyMode = "safe" | "balanced" | "aggressive";

export type VerifyHwpxOutputOptions = {
  original?: Buffer;
  mode?: VerifyMode;
  originalPackage?: HwpxPackage;
  originalAnalysis?: Awaited<ReturnType<typeof analyzeHwpxPackage>>;
  outputAnalysis?: Awaited<ReturnType<typeof analyzeHwpxPackage>>;
};

const PSNR_MINIMUM_DB: Record<Exclude<VerifyMode, "safe">, number> = {
  balanced: 18,
  aggressive: 14
};
const SSIM_MINIMUM: Record<Exclude<VerifyMode, "safe">, number> = {
  balanced: 0.72,
  aggressive: 0.55
};

export async function verifyHwpxOutput(output: Buffer, options: VerifyHwpxOutputOptions = {}): Promise<void> {
  const hasOriginal = options.original !== undefined;
  const hasMode = options.mode !== undefined;
  if (hasOriginal !== hasMode) {
    throw new Error(
      "verifyHwpxOutput requires both `original` and `mode` for cross-package verification, or neither."
    );
  }
  verifyHwpxContainerLayout(output);
  const pkg = await readHwpxPackage(output);
  verifyParsedXml(pkg);
  const graph = buildReferenceGraph(pkg);
  if (graph.missingReferences.length > 0) {
    throw new Error(`Verification failed: missing references ${graph.missingReferences.join(", ")}`);
  }
  if (options.original && options.mode) {
    await verifyAgainstOriginal({
      original: options.originalPackage ?? await readHwpxPackage(options.original),
      output: pkg,
      mode: options.mode,
      originalAnalysis: options.originalAnalysis,
      outputAnalysis: options.outputAnalysis
    });
  }
}

function verifyHwpxContainerLayout(output: Buffer): void {
  const mimetype = Buffer.from("application/hwp+zip");
  if (output.byteLength < 30 || output.readUInt32LE(0) !== 0x04034b50) {
    throw new Error("Verification failed: HWPX package does not start with a ZIP local file header");
  }

  const compressionMethod = output.readUInt16LE(8);
  const fileNameLength = output.readUInt16LE(26);
  const extraLength = output.readUInt16LE(28);
  const nameStart = 30;
  const nameEnd = nameStart + fileNameLength;
  const dataStart = nameEnd + extraLength;
  const dataEnd = dataStart + mimetype.byteLength;
  if (dataEnd > output.byteLength) {
    throw new Error("Verification failed: HWPX mimetype entry is truncated");
  }

  const name = output.subarray(nameStart, nameEnd).toString("utf8");
  if (name !== "mimetype") {
    throw new Error("Verification failed: HWPX mimetype entry must be first in the ZIP package");
  }
  if (compressionMethod !== 0) {
    throw new Error("Verification failed: HWPX mimetype entry must be stored without compression");
  }
  if (!output.subarray(dataStart, dataEnd).equals(mimetype)) {
    throw new Error("Verification failed: HWPX mimetype entry must be application/hwp+zip");
  }
}

function verifyParsedXml(pkg: HwpxPackage): void {
  const parser = new XMLParser({ ignoreAttributes: false, preserveOrder: true });
  for (const entry of pkg.entries) {
    if (entry.kind !== "xml") continue;
    const text = entry.data.toString("utf8");
    const validation = XMLValidator.validate(text);
    if (validation !== true) {
      const message = validation.err?.msg ? `: ${validation.err.msg}` : "";
      throw new Error(`Verification failed: XML is not well-formed at ${entry.path}${message}`);
    }
    try {
      parser.parse(text);
    } catch (error) {
      throw new Error(`Verification failed: XML does not parse at ${entry.path}`, { cause: error });
    }
  }
}

async function verifyAgainstOriginal(input: {
  original: HwpxPackage;
  output: HwpxPackage;
  mode: VerifyMode;
  originalAnalysis?: Awaited<ReturnType<typeof analyzeHwpxPackage>>;
  outputAnalysis?: Awaited<ReturnType<typeof analyzeHwpxPackage>>;
}): Promise<void> {
  const originalGraph = buildReferenceGraph(input.original);
  const outputGraph = buildReferenceGraph(input.output);
  const outputPaths = new Set(input.output.entries.map((entry) => entry.path));
  const originalAnalysis =
    input.originalAnalysis ??
    (await analyzeHwpxPackage(input.original, { graph: originalGraph, includeNearDuplicateImages: false }));
  const outputAnalysis =
    input.outputAnalysis ??
    (await analyzeHwpxPackage(input.output, { graph: outputGraph, includeNearDuplicateImages: false }));
  const originalImages = new Map(originalAnalysis.images.map((image) => [image.path, image]));
  const outputImages = new Map(outputAnalysis.images.map((image) => [image.path, image]));
  const originalDuplicatePathsByPath = await duplicateImagePathsByPath(input.original);
  const visualPairs: Array<{ original: HwpxEntry; output: HwpxEntry }> = [];
  const originalImageEntries = new Map(input.original.entries.filter((entry) => entry.kind === "image").map((entry) => [entry.path, entry]));
  const outputImageEntries = new Map(input.output.entries.filter((entry) => entry.kind === "image").map((entry) => [entry.path, entry]));

  for (const resource of originalGraph.resources.values()) {
    if (!resource.referenced) continue;
    const originalImage = originalImages.get(resource.path);
    if (input.mode !== "safe" && originalImage) {
      const outputImage = verifyAdvancedImage({
        originalImage,
        outputImages,
        outputGraph,
        mode: input.mode,
        originalDuplicatePaths: originalDuplicatePathsByPath.get(originalImage.path) ?? []
      });
      const originalEntry = originalImageEntries.get(originalImage.path);
      const outputEntry = outputImageEntries.get(outputImage.path);
      if (originalEntry && outputEntry) {
        visualPairs.push({ original: originalEntry, output: outputEntry });
      }
      continue;
    }
    if (!outputPaths.has(resource.path)) {
      throw new Error(`Verification failed: referenced resource removed ${resource.path}`);
    }
  }

  if (input.mode === "safe") {
    verifySafeImages({ originalImages, outputImages, originalGraph });
    return;
  }

  await verifyVisualSimilarityPairs(visualPairs, input.mode);
}

async function verifyVisualSimilarityPairs(
  pairs: Array<{ original: HwpxEntry; output: HwpxEntry }>,
  mode: Exclude<VerifyMode, "safe">
): Promise<void> {
  if (pairs.length === 0) return;
  const minimum = PSNR_MINIMUM_DB[mode];
  const seenOutputPaths = new Set<string>();
  const uniquePairs = pairs.filter((pair) => {
    if (seenOutputPaths.has(pair.output.path)) return false;
    seenOutputPaths.add(pair.output.path);
    return true;
  });

  for (const pair of uniquePairs) {
    if (pair.original.data.equals(pair.output.data)) continue;
    const { psnr, ssim } = await computeVisualMetrics(pair.original.data, pair.output.data);
    if (psnr === null && ssim === null) {
      const diff = await describeImagePairDiff(pair.original, pair.output);
      const suffix = diff ? ` ${diff}` : "";
      throw new Error(
        `Verification failed: ${mode} mode image quality could not be measured for ${pair.original.path}${suffix}`
      );
    }
    const ssimMinimum = SSIM_MINIMUM[mode];
    if ((psnr !== null && psnr < minimum) || (ssim !== null && ssim < ssimMinimum)) {
      const diff = await describeImagePairDiff(pair.original, pair.output);
      const suffix = diff ? ` ${diff}` : "";
      const psnrText = psnr === null ? "PSNR n/a" : `PSNR ${psnr.toFixed(2)} dB, minimum ${minimum} dB`;
      const ssimText = ssim === null ? "SSIM n/a" : `SSIM ${ssim.toFixed(3)}, minimum ${ssimMinimum.toFixed(3)}`;
      throw new Error(
        `Verification failed: ${mode} mode image quality too low (${psnrText}; ${ssimText}) for ${pair.original.path}${suffix}`
      );
    }
  }
}

async function describeImagePairDiff(original: HwpxEntry, output: HwpxEntry): Promise<string> {
  const [originalMeta, outputMeta] = await Promise.all([
    safeReadMetadata(original.data),
    safeReadMetadata(output.data)
  ]);
  const originalDescription = formatImageMetadata(originalMeta);
  const outputDescription = formatImageMetadata(outputMeta);
  if (!originalDescription && !outputDescription) return "";
  return `(${originalDescription || "?"} → ${outputDescription || "?"})`;
}

type ImageMetadataSnapshot = {
  width?: number;
  height?: number;
  orientation?: number;
  format?: string;
};

async function safeReadMetadata(data: Buffer): Promise<ImageMetadataSnapshot> {
  try {
    const meta = await sharp(data).metadata();
    return {
      width: meta.width,
      height: meta.height,
      orientation: meta.orientation,
      format: typeof meta.format === "string" ? meta.format : undefined
    };
  } catch {
    return {};
  }
}

function formatImageMetadata(meta: ImageMetadataSnapshot): string {
  const parts: string[] = [];
  if (meta.width && meta.height) parts.push(`${meta.width}×${meta.height}`);
  if (meta.format) parts.push(meta.format);
  parts.push(`ori=${meta.orientation ?? 1}`);
  return parts.join(" ");
}

function verifyAdvancedImage(input: {
  originalImage: ImageInventoryItem;
  outputImages: Map<string, ImageInventoryItem>;
  outputGraph: ReturnType<typeof buildReferenceGraph>;
  mode: Exclude<VerifyMode, "safe">;
  originalDuplicatePaths: string[];
}): ImageInventoryItem {
  const candidatePaths = allowedAdvancedImagePaths(input.originalImage, input.originalDuplicatePaths);
  const outputImage =
    candidatePaths
      .map((path) => input.outputImages.get(path))
      .find((image): image is ImageInventoryItem => Boolean(image && input.outputGraph.resources.get(image.path)?.referenced));

  if (!outputImage) {
    throw new Error(`Verification failed: referenced image removed ${input.originalImage.path}`);
  }

  const duplicateOutput = input.originalDuplicatePaths.includes(outputImage.path) && outputImage.path !== input.originalImage.path;
  if (!duplicateOutput && !isAllowedAdvancedFormat(input.originalImage, outputImage)) {
    throw new Error(`Verification failed: ${input.mode} mode image conversion is not allowed ${input.originalImage.path}`);
  }

  if (
    input.originalImage.width &&
    input.originalImage.height &&
    outputImage.width &&
    outputImage.height
  ) {
    if (outputImage.width > input.originalImage.width || outputImage.height > input.originalImage.height) {
      throw new Error(`Verification failed: ${input.mode} mode image dimensions enlarged ${input.originalImage.path}`);
    }
    verifyAdvancedImageGeometry(input.originalImage, outputImage, input.mode);
  }

  return outputImage;
}

function verifyAdvancedImageGeometry(
  originalImage: ImageInventoryItem,
  outputImage: ImageInventoryItem,
  mode: Exclude<VerifyMode, "safe">
): void {
  if (!originalImage.width || !originalImage.height || !outputImage.width || !outputImage.height) return;
  const originalRatio = originalImage.width / originalImage.height;
  const outputRatio = outputImage.width / outputImage.height;
  const ratioDelta = Math.abs(outputRatio - originalRatio) / originalRatio;
  if (ratioDelta > 0.05) {
    throw new Error(`Verification failed: ${mode} mode image aspect ratio changed ${originalImage.path}`);
  }

  const minimum = minimumAdvancedImageDimensions(originalImage, mode);
  if (outputImage.width < minimum.width || outputImage.height < minimum.height) {
    throw new Error(`Verification failed: ${mode} mode image dimensions collapsed ${originalImage.path}`);
  }
}

function minimumAdvancedImageDimensions(
  image: ImageInventoryItem,
  mode: Exclude<VerifyMode, "safe">
): { width: number; height: number } {
  if (!image.width || !image.height) return { width: 1, height: 1 };
  const expected = image.largestDisplay
    ? fitInsideDimensions(image.width, image.height, image.largestDisplay.widthPx96, image.largestDisplay.heightPx96)
    : fitInsideDimensions(image.width, image.height, advancedMinimumEdge(mode), advancedMinimumEdge(mode));
  return {
    width: Math.max(1, Math.floor(expected.width * 0.9)),
    height: Math.max(1, Math.floor(expected.height * 0.9))
  };
}

function advancedMinimumEdge(mode: Exclude<VerifyMode, "safe">): number {
  return mode === "balanced" ? 1280 : 800;
}

function fitInsideDimensions(
  sourceWidth: number,
  sourceHeight: number,
  boxWidth: number,
  boxHeight: number
): { width: number; height: number } {
  const scale = Math.min(1, boxWidth / sourceWidth, boxHeight / sourceHeight);
  return {
    width: sourceWidth * scale,
    height: sourceHeight * scale
  };
}

function verifySafeImages(input: {
  originalImages: Map<string, ImageInventoryItem>;
  outputImages: Map<string, ImageInventoryItem>;
  originalGraph: ReturnType<typeof buildReferenceGraph>;
}): void {
  for (const originalImage of input.originalImages.values()) {
    const originalResource = input.originalGraph.resources.get(originalImage.path);
    if (!originalResource?.referenced) continue;

    const outputImage = input.outputImages.get(originalImage.path);
    if (!outputImage) {
      throw new Error(`Verification failed: safe mode referenced image removed ${originalImage.path}`);
    }
    if (normalizeFormat(outputImage.format) !== normalizeFormat(originalImage.format)) {
      throw new Error(`Verification failed: safe mode image format changed ${originalImage.path}`);
    }
    if (outputImage.width !== originalImage.width || outputImage.height !== originalImage.height) {
      throw new Error(`Verification failed: safe mode image dimensions changed ${originalImage.path}`);
    }
  }
}

function normalizeFormat(format: string): string {
  const normalized = format.toLowerCase();
  if (normalized === "jpg") return "jpeg";
  if (normalized === "tif") return "tiff";
  return normalized;
}

function allowedAdvancedImagePaths(image: ImageInventoryItem, duplicatePaths: string[] = []): string[] {
  const paths = new Set([image.path]);
  for (const duplicatePath of duplicatePaths) {
    paths.add(duplicatePath);
  }
  paths.add(replaceExtension(image.path, ".bmp"));
  paths.add(replaceExtension(image.path, ".png"));
  paths.add(replaceExtension(image.path, ".jpg"));
  paths.add(replaceExtension(image.path, ".jpeg"));
  if (normalizeFormat(image.format) === "bmp") {
    paths.add(replaceExtension(image.path, ".png"));
  }
  if (normalizeFormat(image.format) === "tiff") {
    paths.add(replaceExtension(image.path, ".png"));
  }
  if (normalizeFormat(image.format) === "jpeg") {
    paths.add(replaceExtension(image.path, ".jpg"));
    paths.add(replaceExtension(image.path, ".jpeg"));
  }
  return [...paths];
}

function isAllowedAdvancedFormat(originalImage: ImageInventoryItem, outputImage: ImageInventoryItem): boolean {
  const original = normalizeFormat(originalImage.format);
  const output = normalizeFormat(outputImage.format);
  if (original === "bmp") return output === "bmp" || output === "png";
  if (original === "tiff") return output === "tiff" || output === "png";
  if (original === "jpeg") return output === "jpeg";
  if (original === "png") return output === "png";
  return original === output;
}

function replaceExtension(path: string, extension: string): string {
  return path.replace(/\.[^.\/]+$/, extension);
}

async function duplicateImagePathsByPath(pkg: HwpxPackage): Promise<Map<string, string[]>> {
  const duplicatePathsByPath = new Map<string, string[]>();
  for (const group of await findImageConsolidationGroups(pkg)) {
    for (const path of group.paths) {
      duplicatePathsByPath.set(path, group.paths);
    }
  }
  return duplicatePathsByPath;
}
