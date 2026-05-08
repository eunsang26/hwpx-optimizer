import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { analyzeHwpxPackage } from "./analyzer.js";
import { buildReferenceGraph } from "./referenceGraph.js";
import { readHwpxPackage } from "./reader.js";
import type { HwpxEntry, HwpxPackage, ImageInventoryItem } from "./types.js";
import { computePerceptualHash, hammingDistance, PERCEPTUAL_HASH_BIT_COUNT } from "./visualSimilarity.js";

export type VerifyMode = "safe" | "balanced" | "aggressive";

export type VerifyHwpxOutputOptions = {
  original?: Buffer;
  mode?: VerifyMode;
};

const VISUAL_SIMILARITY_LIMITS: Record<Exclude<VerifyMode, "safe">, number> = {
  balanced: 16,
  aggressive: 22
};

export async function verifyHwpxOutput(output: Buffer, options: VerifyHwpxOutputOptions = {}): Promise<void> {
  const pkg = await readHwpxPackage(output);
  verifyParsedXml(pkg);
  const graph = buildReferenceGraph(pkg);
  if (graph.missingReferences.length > 0) {
    throw new Error(`Verification failed: missing references ${graph.missingReferences.join(", ")}`);
  }
  if (options.original && options.mode) {
    await verifyAgainstOriginal({
      original: await readHwpxPackage(options.original),
      output: pkg,
      mode: options.mode
    });
  }
}

function verifyParsedXml(pkg: HwpxPackage): void {
  const parser = new XMLParser({ ignoreAttributes: false, preserveOrder: true });
  for (const entry of pkg.entries) {
    if (entry.kind !== "xml") continue;
    try {
      parser.parse(entry.data.toString("utf8"));
    } catch (error) {
      throw new Error(`Verification failed: XML does not parse at ${entry.path}`, { cause: error });
    }
  }
}

async function verifyAgainstOriginal(input: { original: HwpxPackage; output: HwpxPackage; mode: VerifyMode }): Promise<void> {
  const originalGraph = buildReferenceGraph(input.original);
  const outputGraph = buildReferenceGraph(input.output);
  const outputPaths = new Set(input.output.entries.map((entry) => entry.path));
  const originalImages = new Map(
    (await analyzeHwpxPackage(input.original, { graph: originalGraph })).images.map((image) => [image.path, image])
  );
  const outputImages = new Map(
    (await analyzeHwpxPackage(input.output, { graph: outputGraph })).images.map((image) => [image.path, image])
  );
  const originalDuplicatePathsByPath = duplicateImagePathsByPath(input.original);
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
  const limit = VISUAL_SIMILARITY_LIMITS[mode];
  const seenOutputPaths = new Set<string>();
  const uniquePairs = pairs.filter((pair) => {
    if (seenOutputPaths.has(pair.output.path)) return false;
    seenOutputPaths.add(pair.output.path);
    return true;
  });

  for (const pair of uniquePairs) {
    const [originalHash, outputHash] = await Promise.all([
      computePerceptualHash(pair.original.data),
      computePerceptualHash(pair.output.data)
    ]);
    if (!originalHash || !outputHash) continue;
    const distance = hammingDistance(originalHash, outputHash);
    if (distance > limit) {
      throw new Error(
        `Verification failed: ${mode} mode visual difference too large (${distance}/${PERCEPTUAL_HASH_BIT_COUNT} bits) for ${pair.original.path}`
      );
    }
  }
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

  if (!isAllowedAdvancedFormat(input.originalImage, outputImage)) {
    throw new Error(`Verification failed: ${input.mode} mode image conversion is not allowed ${input.originalImage.path}`);
  }

  if (
    input.originalImage.width &&
    input.originalImage.height &&
    outputImage.width &&
    outputImage.height &&
    (outputImage.width > input.originalImage.width || outputImage.height > input.originalImage.height)
  ) {
    throw new Error(`Verification failed: ${input.mode} mode image dimensions enlarged ${input.originalImage.path}`);
  }

  return outputImage;
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

function duplicateImagePathsByPath(pkg: HwpxPackage): Map<string, string[]> {
  const byHash = new Map<string, string[]>();

  for (const entry of pkg.entries) {
    if (entry.kind !== "image") continue;
    const hash = createHash("sha256").update(entry.data).digest("hex");
    const paths = byHash.get(hash) ?? [];
    paths.push(entry.path);
    byHash.set(hash, paths);
  }

  const duplicatePathsByPath = new Map<string, string[]>();
  for (const paths of byHash.values()) {
    if (paths.length < 2) continue;
    const sorted = paths.sort((left, right) => left.localeCompare(right));
    for (const path of sorted) {
      duplicatePathsByPath.set(path, sorted);
    }
  }
  return duplicatePathsByPath;
}
