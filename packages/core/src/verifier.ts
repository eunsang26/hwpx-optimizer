import { XMLParser } from "fast-xml-parser";
import { analyzeHwpxPackage } from "./analyzer.js";
import { buildReferenceGraph } from "./referenceGraph.js";
import { readHwpxPackage } from "./reader.js";
import type { HwpxPackage, ImageInventoryItem } from "./types.js";

export type VerifyMode = "safe" | "balanced" | "aggressive";

export type VerifyHwpxOutputOptions = {
  original?: Buffer;
  mode?: VerifyMode;
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
  const outputPaths = new Set(input.output.entries.map((entry) => entry.path));
  const originalImages = new Map((await analyzeHwpxPackage(input.original)).images.map((image) => [image.path, image]));
  const outputImages = new Map((await analyzeHwpxPackage(input.output)).images.map((image) => [image.path, image]));

  for (const resource of originalGraph.resources.values()) {
    if (!resource.referenced) continue;
    const originalImage = originalImages.get(resource.path);
    if (input.mode !== "safe" && originalImage) continue;
    if (!outputPaths.has(resource.path)) {
      throw new Error(`Verification failed: referenced resource removed ${resource.path}`);
    }
  }

  if (input.mode === "safe") {
    verifySafeImages({ originalImages, outputImages, originalGraph });
  }
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
  return normalized;
}
