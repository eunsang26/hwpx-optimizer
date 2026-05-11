export const BIN_DATA_PREFIX = "BinData/";

export function decodePackagePath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function cleanPackagePath(value: string): string {
  return decodePackagePath(value.trim()).replace(/^#/, "").replace(/^\.?\//, "").replace(/\\/g, "/");
}

function hasUnsafeSegment(path: string): boolean {
  return path.split("/").some((segment) => segment === ".." || segment === "." || segment === "");
}

export function normalizePackagePath(value: string): string | null {
  const cleaned = cleanPackagePath(value);
  const lower = cleaned.toLowerCase();
  const prefix = BIN_DATA_PREFIX.toLowerCase();
  const binDataIndex = lower.indexOf(prefix);
  if (binDataIndex < 0) return null;
  const tail = cleaned.slice(binDataIndex + prefix.length);
  if (hasUnsafeSegment(tail)) return null;
  return BIN_DATA_PREFIX + tail;
}

export function normalizeImagePath(value: string): string | null {
  const cleaned = cleanPackagePath(value);
  const normalizedBinData = normalizePackagePath(cleaned);
  if (normalizedBinData) return normalizedBinData;
  if (/\.(png|jpg|jpeg|bmp|gif|tif|tiff|webp)$/i.test(cleaned)) return cleaned;
  return null;
}
