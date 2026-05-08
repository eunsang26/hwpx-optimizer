import JSZip from "jszip";
import type { HwpxEntry, HwpxEntryKind, HwpxPackage } from "./types.js";

export async function readHwpxPackage(input: Buffer): Promise<HwpxPackage> {
  if (isHwpBinary(input)) {
    throw new Error("Unsupported HWP binary file: save or export the document as .hwpx before optimizing");
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(input);
  } catch (error) {
    throw new Error("Invalid HWPX package: input is not a readable ZIP archive", {
      cause: error
    });
  }

  const entries: HwpxEntry[] = [];
  for (const [path, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    if (!isSafePackagePath(path)) {
      throw new Error(`Invalid HWPX package: unsafe entry path ${path}`);
    }
    const data = Buffer.from(await file.async("nodebuffer"));
    entries.push({
      path,
      data,
      size: data.byteLength,
      kind: classifyEntry(path)
    });
  }

  validateHwpxStructure(entries);
  return { entries };
}

export function isSafePackagePath(path: string): boolean {
  if (!path) return false;
  if (path.startsWith("/") || path.startsWith("\\")) return false;
  if (/^[a-z]:/i.test(path)) return false;
  const segments = path.replace(/\\/g, "/").split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") return false;
  }
  return true;
}

function isHwpBinary(input: Buffer): boolean {
  const oleCompoundSignature = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  return input.subarray(0, oleCompoundSignature.length).equals(oleCompoundSignature);
}

export function classifyEntry(path: string): HwpxEntryKind {
  const lower = path.toLowerCase();
  if (lower.endsWith(".xml") || lower.endsWith(".hpf") || lower.endsWith(".opf")) return "xml";
  if (lower.includes("bindata/")) {
    if (/\.(png|jpg|jpeg|bmp|gif|tif|tiff|webp)$/i.test(lower)) return "image";
    return "bindata";
  }
  if (/\.(png|jpg|jpeg|bmp|gif|tif|tiff|webp)$/i.test(lower)) return "image";
  if (/\.(ttf|otf|woff|woff2)$/i.test(lower)) return "font";
  if (/\.(ole|bin)$/i.test(lower)) return "ole";
  return "other";
}

function validateHwpxStructure(entries: HwpxEntry[]): void {
  const paths = new Set(entries.map((entry) => entry.path));
  const missing: string[] = [];
  if (!paths.has("Contents/content.hpf")) {
    missing.push("Contents/content.hpf");
  }
  if (!entries.some((entry) => /^Contents\/section\d+\.xml$/i.test(entry.path))) {
    missing.push("Contents/section*.xml");
  }

  if (missing.length > 0) {
    throw new Error(`Invalid HWPX package: missing required files ${missing.join(", ")}`);
  }
}
