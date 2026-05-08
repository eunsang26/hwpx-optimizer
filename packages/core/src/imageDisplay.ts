import type { HwpxPackage, ImageDisplayReference } from "./types.js";

const HWP_UNITS_PER_96_DPI_PIXEL = 75;

export function extractImageDisplayReferences(pkg: HwpxPackage): Map<string, ImageDisplayReference[]> {
  const manifest = extractManifestImagePaths(pkg);
  const refsByPath = new Map<string, ImageDisplayReference[]>();

  for (const entry of pkg.entries) {
    if (entry.kind !== "xml") continue;
    const xml = entry.data.toString("utf8");
    for (const pic of extractPicBlocks(xml)) {
      const imageAttrs = findTagAttrs(pic, "img");
      const binaryItemIDRef = imageAttrs ? parseAttributes(imageAttrs).binaryItemIDRef : undefined;
      if (!binaryItemIDRef) continue;

      const imagePath = manifest.get(binaryItemIDRef);
      if (!imagePath) continue;

      const size = extractDisplaySize(pic);
      if (!size) continue;

      const ref: ImageDisplayReference = {
        sourceXml: entry.path,
        binaryItemIDRef,
        widthHwpUnit: size.widthHwpUnit,
        heightHwpUnit: size.heightHwpUnit,
        widthPx96: hwpUnitsToPx96(size.widthHwpUnit),
        heightPx96: hwpUnitsToPx96(size.heightHwpUnit)
      };
      const refs = refsByPath.get(imagePath) ?? [];
      refs.push(ref);
      refsByPath.set(imagePath, refs);
    }
  }

  return refsByPath;
}

export function getRecommendedImagePixelBudgets(pkg: HwpxPackage, scale = 2): Map<string, { width: number; height: number }> {
  const budgets = new Map<string, { width: number; height: number }>();
  for (const [path, refs] of extractImageDisplayReferences(pkg)) {
    const largest = [...refs].sort(
      (left, right) => right.widthHwpUnit * right.heightHwpUnit - left.widthHwpUnit * left.heightHwpUnit
    )[0];
    if (!largest) continue;
    budgets.set(path, {
      width: Math.ceil(largest.widthPx96 * scale),
      height: Math.ceil(largest.heightPx96 * scale)
    });
  }
  return budgets;
}

function extractManifestImagePaths(pkg: HwpxPackage): Map<string, string> {
  const manifest = new Map<string, string>();
  for (const entry of pkg.entries) {
    if (entry.kind !== "xml") continue;
    const xml = entry.data.toString("utf8");
    for (const match of xml.matchAll(/<(?:\w+:)?item\b([^>]*)>/gi)) {
      const attrs = parseAttributes(match[1] ?? "");
      if (!attrs.id || !attrs.href) continue;
      const normalizedPath = normalizeImagePath(attrs.href);
      if (!normalizedPath) continue;
      manifest.set(attrs.id, normalizedPath);
    }
  }
  return manifest;
}

function extractPicBlocks(xml: string): string[] {
  return [...xml.matchAll(/<(?:\w+:)?pic\b[\s\S]*?<\/(?:\w+:)?pic>/gi)].map((match) => match[0]);
}

function extractDisplaySize(pic: string): { widthHwpUnit: number; heightHwpUnit: number } | null {
  const attrs = findTagAttrs(pic, "sz") ?? findTagAttrs(pic, "curSz") ?? findTagAttrs(pic, "orgSz");
  if (!attrs) return null;

  const parsed = parseAttributes(attrs);
  const width = parsePositiveInteger(parsed.width);
  const height = parsePositiveInteger(parsed.height);
  if (!width || !height) return null;

  return { widthHwpUnit: width, heightHwpUnit: height };
}

function findTagAttrs(xml: string, localName: string): string | null {
  const pattern = new RegExp(`<(?:\\w+:)?${localName}\\b([^>]*)>`, "i");
  return pattern.exec(xml)?.[1] ?? null;
}

function parseAttributes(input: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of input.matchAll(/([\w:-]+)=["']([^"']*)["']/g)) {
    attrs[match[1] ?? ""] = match[2] ?? "";
  }
  return attrs;
}

function parsePositiveInteger(value?: string): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeImagePath(value: string): string | null {
  const cleaned = value.replace(/^#/, "").replace(/^\.?\//, "").replace(/\\/g, "/");
  const binDataIndex = cleaned.toLowerCase().indexOf("bindata/");
  if (binDataIndex >= 0) return cleaned.slice(binDataIndex);
  if (/\.(png|jpg|jpeg|bmp|gif|tif|tiff|webp)$/i.test(cleaned)) return cleaned;
  return null;
}

function hwpUnitsToPx96(value: number): number {
  return Math.ceil(value / HWP_UNITS_PER_96_DPI_PIXEL);
}
