export const JPEG_QUALITY_FLOOR = 60;
export const JPEG_QUALITY_CEILING = 95;
export const DEFAULT_JPEG_QUALITY = 88;

export function clampJpegQuality(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_JPEG_QUALITY;
  return Math.max(JPEG_QUALITY_FLOOR, Math.min(JPEG_QUALITY_CEILING, Math.round(value)));
}
