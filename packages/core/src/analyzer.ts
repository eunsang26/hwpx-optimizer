import sharp from "sharp";
import type { HwpxEntryKind, HwpxPackage, ImageInventoryItem, PackageAnalysis } from "./types.js";

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

  for (const entry of pkg.entries) {
    totalSize += entry.size;
    entriesByKind[entry.kind] += 1;
    if (entry.kind === "image") {
      images.push(await inspectImage(entry.path, entry.data, entry.size));
    }
  }

  return { totalSize, entriesByKind, images };
}

async function inspectImage(path: string, data: Buffer, size: number): Promise<ImageInventoryItem> {
  const extension = extensionFormat(path);
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
      isBmpCandidate: extension === "bmp" || metadataFormat === "bmp"
    };
  } catch {
    return {
      path,
      size,
      format: extension,
      hasMetadata: false,
      isBmpCandidate: extension === "bmp"
    };
  }
}

function extensionFormat(path: string): string {
  const match = /\.([^.\/]+)$/.exec(path);
  return match ? match[1].toLowerCase() : "unknown";
}
