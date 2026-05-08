import sharp from "sharp";
import { decodeBmp } from "./bmp.js";
import { extractImageDisplayReferences } from "./imageDisplay.js";
import type { HwpxEntryKind, HwpxPackage, ImageDisplayReference, ImageInventoryItem, PackageAnalysis } from "./types.js";

export async function analyzeHwpxPackage(pkg: HwpxPackage): Promise<PackageAnalysis> {
  const entriesByKind: Record<HwpxEntryKind, number> = {
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
    if (entry.kind === "image") {
      images.push(await inspectImage(entry.path, entry.data, entry.size, displaysByPath.get(entry.path) ?? []));
    }
  }

  return { totalSize, entriesByKind, images };
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
