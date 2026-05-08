import JSZip from "jszip";
import type { HwpxPackage } from "./types.js";

export async function writeHwpxPackage(pkg: HwpxPackage): Promise<Buffer> {
  const zip = new JSZip();
  for (const entry of pkg.entries) {
    zip.file(entry.path, entry.data);
  }
  return Buffer.from(
    await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 9 }
    })
  );
}
