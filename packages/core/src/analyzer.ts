import { createHash } from "node:crypto";
import sharp from "sharp";
import { decodeBmp } from "./bmp.js";
import { extractImageDisplayReferences } from "./imageDisplay.js";
import { buildReferenceGraph } from "./referenceGraph.js";
import type {
  DuplicateImageGroup,
  HwpxEntryKind,
  HwpxPackage,
  ImageDisplayReference,
  ImageInventoryItem,
  PackageAnalysis,
  RiskyResource,
  UnusedResource
} from "./types.js";

export async function analyzeHwpxPackage(pkg: HwpxPackage): Promise<PackageAnalysis> {
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

  const images: ImageInventoryItem[] = [];
  let totalSize = 0;
  const displaysByPath = extractImageDisplayReferences(pkg);

  for (const entry of pkg.entries) {
    totalSize += entry.size;
    entriesByKind[entry.kind] += 1;
    categorySizes[entry.kind] += entry.size;
    if (entry.kind === "image") {
      images.push(await inspectImage(entry.path, entry.data, entry.size, displaysByPath.get(entry.path) ?? []));
    }
  }

  return {
    totalSize,
    entriesByKind,
    categorySizes,
    images,
    duplicateImages: findDuplicateImages(pkg),
    unusedBinData: findUnusedBinData(pkg),
    riskyResources: findRiskyResources(pkg)
  };
}

async function inspectImage(
  path: string,
  data: Buffer,
  size: number,
  displayRefs: ImageDisplayReference[]
): Promise<ImageInventoryItem> {
  const extension = extensionFormat(path);
  const bmp = decodeBmp(data);
  if (bmp) {
    return {
      path,
      size,
      format: "bmp",
      width: bmp.width,
      height: bmp.height,
      hasMetadata: false,
      isBmpCandidate: true,
      ...createDisplayFields(displayRefs, bmp.width, bmp.height)
    };
  }

  try {
    const metadata = await sharp(data).metadata();
    const metadataFormat = metadata.format ? String(metadata.format) : undefined;
    return {
      path,
      size,
      format: metadataFormat ?? extension,
      width: metadata.width,
      height: metadata.height,
      hasMetadata: Boolean(metadata.exif || metadata.icc || metadata.iptc || metadata.xmp),
      isBmpCandidate: extension === "bmp" || metadataFormat === "bmp",
      ...createDisplayFields(displayRefs, metadata.width, metadata.height)
    };
  } catch {
    return {
      path,
      size,
      format: extension,
      hasMetadata: false,
      isBmpCandidate: extension === "bmp",
      ...createDisplayFields(displayRefs)
    };
  }
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

function findDuplicateImages(pkg: HwpxPackage): DuplicateImageGroup[] {
  const byHash = new Map<string, Array<{ path: string; size: number }>>();
  for (const entry of pkg.entries) {
    if (entry.kind !== "image") continue;
    const hash = createHash("sha256").update(entry.data).digest("hex");
    const group = byHash.get(hash) ?? [];
    group.push({ path: entry.path, size: entry.size });
    byHash.set(hash, group);
  }

  return [...byHash.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([hash, entries]) => {
      const sorted = entries.sort((left, right) => left.path.localeCompare(right.path));
      return {
        hash,
        paths: sorted.map((entry) => entry.path),
        count: sorted.length,
        totalBytes: sorted.reduce((sum, entry) => sum + entry.size, 0),
        wastedBytes: sorted.slice(1).reduce((sum, entry) => sum + entry.size, 0)
      };
    })
    .sort((left, right) => right.wastedBytes - left.wastedBytes);
}

function findUnusedBinData(pkg: HwpxPackage): UnusedResource[] {
  const graph = buildReferenceGraph(pkg);
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
