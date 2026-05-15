import JSZip from "jszip";
import type { HwpxPackage } from "./types.js";

export type WriteHwpxPackageOptions = {
  compressionLevel?: number;
};

export async function writeHwpxPackage(pkg: HwpxPackage, options: WriteHwpxPackageOptions = {}): Promise<Buffer> {
  const compressionLevel = normalizeCompressionLevel(options.compressionLevel);
  const zip = new JSZip();
  for (const entry of pkg.entries) {
    zip.file(entry.path, entry.data);
  }
  return Buffer.from(
    await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: compressionLevel }
    })
  );
}

function normalizeCompressionLevel(value: number | undefined): number {
  if (value === undefined) return 9;
  if (!Number.isFinite(value)) return 9;
  return Math.max(1, Math.min(9, Math.floor(value)));
}
