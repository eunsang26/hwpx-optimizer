import { createHash } from "node:crypto";
import { defaultImageConcurrency, mapLimit } from "./concurrency.js";
import { findByteIdenticalImageGroups, findNearDuplicateImageGroups, findSameVisualImageGroups } from "./imageDuplicates.js";
import { extractImageDisplayReferences } from "./imageDisplay.js";
import { readImageMetadata } from "./imageMetadata.js";
import { buildReferenceGraph } from "./referenceGraph.js";
import type {
  HwpxEntryKind,
  HwpxPackage,
  ImageDisplayReference,
  ImageInventoryItem,
  PackageAnalysis,
  ReferenceGraph,
  RiskyResource,
  ResourceDiagnostic,
  UnusedResource
} from "./types.js";

const LARGE_FONT_BYTES = 1 * 1024 * 1024;
const LARGE_OLE_BYTES = 5 * 1024 * 1024;
const OLE_SIZE_SHARE = 0.2;

export async function analyzeHwpxPackage(
  pkg: HwpxPackage,
  options: {
    graph?: ReferenceGraph;
    includeSameVisualDuplicateImages?: boolean;
    includeNearDuplicateImages?: boolean;
  } = {}
): Promise<PackageAnalysis> {
  const entriesByKind: Record<HwpxEntryKind, number> = {
    xml: 0,
    image: 0,
    font: 0,
    ole: 0,
    bindata: 0,
    other: 0
  };
  const categorySizes: Record<HwpxEntryKind, number> = {
    xml: 0,
    image: 0,
    font: 0,
    ole: 0,
    bindata: 0,
    other: 0
  };

  const imageInputs: Array<{ path: string; data: Buffer; size: number; displayRefs: ImageDisplayReference[] }> = [];
  let totalSize = 0;
  const displaysByPath = extractImageDisplayReferences(pkg);

  for (const entry of pkg.entries) {
    totalSize += entry.size;
    entriesByKind[entry.kind] += 1;
    categorySizes[entry.kind] += entry.size;
    if (entry.kind === "image") {
      imageInputs.push({
        path: entry.path,
        data: entry.data,
        size: entry.size,
        displayRefs: displaysByPath.get(entry.path) ?? []
      });
    }
  }
  const images = await mapLimit(imageInputs, defaultImageConcurrency(), (image) =>
    inspectImage(image.path, image.data, image.size, image.displayRefs)
  );

  const graph = options.graph ?? buildReferenceGraph(pkg);
  const sameVisualDuplicateImages =
    options.includeSameVisualDuplicateImages === false ? [] : await findSameVisualImageGroups(pkg);
  return {
    totalSize,
    entriesByKind,
    categorySizes,
    images,
    duplicateImages: findByteIdenticalImageGroups(pkg),
    sameVisualDuplicateImages,
    nearDuplicateImages: options.includeNearDuplicateImages === false ? [] : await findNearDuplicateImageGroups(pkg),
    unusedBinData: findUnusedBinData(pkg, graph),
    riskyResources: findRiskyResources(pkg),
    resourceDiagnostics: findResourceDiagnostics(pkg, categorySizes, totalSize),
    referenceGraph: graph
  };
}

async function inspectImage(
  path: string,
  data: Buffer,
  size: number,
  displayRefs: ImageDisplayReference[]
): Promise<ImageInventoryItem> {
  const extension = extensionFormat(path);
  const metadata = await readImageMetadata(path, data, { rotate: true });
  return {
    path,
    size,
    format: metadata.format ?? extension,
    width: metadata.width,
    height: metadata.height,
    hasMetadata: metadata.hasMetadata,
    isBmpCandidate: extension === "bmp" || metadata.isBmp,
    ...createDisplayFields(displayRefs, metadata.width, metadata.height)
  };
}

function extensionFormat(path: string): string {
  const match = /\.([^.\/]+)$/.exec(path);
  return match ? match[1].toLowerCase() : "unknown";
}

function createDisplayFields(
  displayRefs: ImageDisplayReference[],
  width?: number,
  height?: number
): Pick<ImageInventoryItem, "displayRefs" | "largestDisplay" | "oversizeRatio"> {
  const largest = [...displayRefs].sort(
    (left, right) => right.widthHwpUnit * right.heightHwpUnit - left.widthHwpUnit * left.heightHwpUnit
  )[0];
  if (!largest) {
    return { displayRefs };
  }

  const largestDisplay = {
    ...largest,
    recommendedWidthPx: largest.widthPx96 * 2,
    recommendedHeightPx: largest.heightPx96 * 2
  };
  const oversizeRatio =
    width && height
      ? Math.max(width / largestDisplay.recommendedWidthPx, height / largestDisplay.recommendedHeightPx)
      : undefined;

  return {
    displayRefs,
    largestDisplay,
    ...(oversizeRatio && oversizeRatio > 1 ? { oversizeRatio } : {})
  };
}

function findUnusedBinData(pkg: HwpxPackage, graph: ReferenceGraph): UnusedResource[] {
  const entriesByPath = new Map(pkg.entries.map((entry) => [entry.path, entry]));
  return [...graph.resources.values()]
    .filter((resource) => !resource.referenced && resource.path.startsWith("BinData/"))
    .map((resource) => {
      const entry = entriesByPath.get(resource.path);
      return {
        path: resource.path,
        kind: entry?.kind ?? "bindata",
        size: entry?.size ?? 0
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

function findRiskyResources(pkg: HwpxPackage): RiskyResource[] {
  const risky: RiskyResource[] = [];
  for (const entry of pkg.entries) {
    if (entry.kind !== "font" && entry.kind !== "ole") continue;
    risky.push({
      path: entry.path,
      kind: entry.kind,
      size: entry.size,
      reason:
        entry.kind === "font"
          ? "Embedded fonts can affect document appearance if removed."
          : "OLE objects can be user-visible or required by the document."
    });
  }
  return risky.sort((left, right) => left.path.localeCompare(right.path));
}

function findResourceDiagnostics(
  pkg: HwpxPackage,
  categorySizes: Record<HwpxEntryKind, number>,
  totalSize: number
): ResourceDiagnostic[] {
  const diagnostics: ResourceDiagnostic[] = [];
  const fontEntries = pkg.entries.filter((entry) => entry.kind === "font");
  const oleEntries = pkg.entries.filter((entry) => entry.kind === "ole");

  for (const entry of fontEntries) {
    if (entry.size < LARGE_FONT_BYTES) continue;
    diagnostics.push({
      type: "large-font",
      kind: "font",
      paths: [entry.path],
      sizeBytes: entry.size,
      reason: "Embedded font is large; review whether it is required."
    });
  }

  const fontsByHash = new Map<string, typeof fontEntries>();
  for (const entry of fontEntries) {
    const hash = createHash("sha256").update(entry.data).digest("hex");
    const group = fontsByHash.get(hash) ?? [];
    group.push(entry);
    fontsByHash.set(hash, group);
  }
  for (const group of fontsByHash.values()) {
    if (group.length < 2) continue;
    diagnostics.push({
      type: "duplicate-font",
      kind: "font",
      paths: group.map((entry) => entry.path).sort((left, right) => left.localeCompare(right)),
      sizeBytes: group.reduce((sum, entry) => sum + entry.size, 0),
      reason: "Embedded font files are byte-identical; review before removing or subsetting manually."
    });
  }

  for (const entry of oleEntries) {
    if (entry.size < LARGE_OLE_BYTES) continue;
    diagnostics.push({
      type: "large-ole",
      kind: "ole",
      paths: [entry.path],
      sizeBytes: entry.size,
      reason: "Large OLE or attachment resource contributes materially to document size."
    });
  }

  if (totalSize > 0 && categorySizes.ole / totalSize >= OLE_SIZE_SHARE && categorySizes.ole > 0) {
    diagnostics.push({
      type: "ole-size-share",
      kind: "ole",
      paths: oleEntries.map((entry) => entry.path).sort((left, right) => left.localeCompare(right)),
      sizeBytes: categorySizes.ole,
      reason: "OLE or attachment resources account for a large share of the package size."
    });
  }

  return diagnostics.sort((left, right) => right.sizeBytes - left.sizeBytes || left.type.localeCompare(right.type));
}
