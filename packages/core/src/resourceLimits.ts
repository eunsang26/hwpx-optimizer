/** Local processing ceilings, not a promise about total process RSS. */
export const MAX_IMAGE_PIXELS = 24_000_000;
export const MAX_DECODED_CACHE_BYTES = 64 * 1024 * 1024;
export const MAX_CONCURRENT_IMAGE_OPERATIONS = 4;
export const MAX_BATCH_WORKERS = 4;
export const MAX_PREVIEW_ITEMS = 12;
export const MAX_PREVIEW_EDGE = 1024;
export const SHARP_INPUT_OPTIONS = { limitInputPixels: MAX_IMAGE_PIXELS };

export function imagePixelLimitReason(width?: number, height?: number): string | undefined {
  if (width === undefined || height === undefined) return undefined;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width > MAX_IMAGE_PIXELS / height) {
    return `Image exceeds supported pixel limit (${MAX_IMAGE_PIXELS} pixels); original bytes are preserved.`;
  }
  return undefined;
}
