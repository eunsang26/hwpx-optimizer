import JSZip from "jszip";
import type { HwpxPackage } from "./types.js";

export type WriteHwpxPackageOptions = {
  compressionLevel?: number;
  storeAlreadyCompressedImages?: boolean;
};

export async function writeHwpxPackage(pkg: HwpxPackage, options: WriteHwpxPackageOptions = {}): Promise<Buffer> {
  const compressionLevel = normalizeCompressionLevel(options.compressionLevel);
  const storeAlreadyCompressedImages = options.storeAlreadyCompressedImages ?? false;
  const zip = new JSZip();
  for (const entry of pkg.entries) {
    zip.file(entry.path, entry.data, {
      compression: storeAlreadyCompressedImages && isAlreadyCompressedImage(entry.path) ? "STORE" : "DEFLATE",
      compressionOptions: { level: compressionLevel }
    });
  }
  return Buffer.from(
    await zip.generateAsync({
      type: "nodebuffer"
    })
  );
}

function normalizeCompressionLevel(value: number | undefined): number {
  if (value === undefined) return 9;
  if (!Number.isFinite(value)) return 9;
  return Math.max(1, Math.min(9, Math.floor(value)));
}

function isAlreadyCompressedImage(path: string): boolean {
  return /\.(gif|jpe?g|tiff?|webp)$/i.test(path);
}
