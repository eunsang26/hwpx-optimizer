import JSZip from "jszip";
import { readZipDirectory } from "./zipDirectory.js";
import type { ZipDirectoryEntry } from "./zipDirectory.js";
import type { HwpxEntry, HwpxEntryKind, HwpxPackage } from "./types.js";
import { assertWellFormedXml, decodeDocumentXml } from "./xmlDocument.js";

const PROTECTED_DOCUMENT_ERROR =
  "보안 처리된 문서는 최적화 대상이 아닙니다. 암호화, DRM, 전자서명, 권한 제한을 해제하거나 우회하지 않습니다.";

export type HwpxPackageReadLimits = {
  maxEntries?: number;
  maxEntryBytes?: number;
  maxExpandedBytes?: number;
};

export type ReadHwpxPackageOptions = {
  limits?: HwpxPackageReadLimits;
};

const DEFAULT_READ_LIMITS: Required<HwpxPackageReadLimits> = {
  maxEntries: 20_000,
  maxEntryBytes: 512 * 1024 * 1024,
  maxExpandedBytes: 2 * 1024 * 1024 * 1024
};

export async function readHwpxPackage(input: Buffer, options: ReadHwpxPackageOptions = {}): Promise<HwpxPackage> {
  const limits = normalizeReadLimits(options.limits);
  if (isHwpBinary(input)) {
    throw new Error("Unsupported HWP binary file: save or export the document as .hwpx before optimizing");
  }
  const declaredEntries = readZipDirectory(input, limits.maxEntries);
  if (declaredEntries.some(entry => (entry.generalPurposeBitFlag & 1) === 1)) throw new Error(PROTECTED_DOCUMENT_ERROR);
  assertDeclaredEntriesWithinLimits(declaredEntries, limits);

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(input);
  } catch (error) {
    throw new Error("Invalid HWPX package: input is not a readable ZIP archive", {
      cause: error
    });
  }

  const entries: HwpxEntry[] = [];
  const files = Object.entries(zip.files).filter(([, file]) => !file.dir);
  if (files.length !== declaredEntries.filter(entry => !entry.isDirectory).length) {
    throw new Error("Invalid HWPX package: duplicate or inconsistent decoded ZIP entry names");
  }
  const declaredSizes = new Map(declaredEntries.filter(entry => !entry.isDirectory).map(entry => [entry.path, entry.uncompressedSize]));
  if (files.length > limits.maxEntries) {
    throw new Error(`Invalid HWPX package: too many entries (${files.length}; limit ${limits.maxEntries})`);
  }

  let expandedBytes = 0;
  for (const [path, file] of files) {
    if (!isSafePackagePath(path) || (file.unsafeOriginalName !== undefined && !isSafePackagePath(file.unsafeOriginalName))) {
      throw new Error(`Invalid HWPX package: unsafe entry path ${path}`);
    }
    const data = await readBoundedEntry(file, path, {
      maxEntryBytes: limits.maxEntryBytes,
      remainingExpandedBytes: limits.maxExpandedBytes - expandedBytes,
      declaredBytes: declaredSizes.get(path)
    });
    expandedBytes += data.byteLength;
    if (expandedBytes > limits.maxExpandedBytes) {
      throw new Error(
        `Invalid HWPX package: expanded contents exceed supported size (${expandedBytes} bytes; limit ${limits.maxExpandedBytes} bytes)`
      );
    }
    entries.push({
      path,
      data,
      size: data.byteLength,
      kind: classifyEntry(path)
    });
  }

  rejectProtectedHwpxEntries(entries);
  validateHwpxStructure(entries);
  for (const entry of entries) {
    if (entry.kind === "xml") assertWellFormedXml(decodeDocumentXml(entry.data, entry.path), entry.path);
  }
  return { entries };
}

/** Accumulate only checked chunks; never allocate the full untrusted entry first. */
async function readBoundedEntry(file: JSZip.JSZipObject, path: string, limits: {
  maxEntryBytes: number; remainingExpandedBytes: number; declaredBytes?: number;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const stream = file.nodeStream("nodebuffer") as NodeJS.ReadableStream & { destroy: () => void };
    const chunks: Buffer[] = [];
    let size = 0, settled = false;
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true; chunks.length = 0;
      stream.pause(); stream.destroy(); reject(error);
    };
    stream.on("error", fail);
    stream.on("data", (chunk: Buffer) => {
      if (settled) return;
      const nextSize = size + chunk.length;
      try {
        assertEntrySizeWithinLimit(path, nextSize, limits.maxEntryBytes);
        if (nextSize > limits.remainingExpandedBytes) throw new Error("Invalid HWPX package: expanded contents exceed supported size while decoding " + path);
        if (limits.declaredBytes !== undefined && nextSize > limits.declaredBytes) throw new Error("Invalid HWPX package: entry exceeds declared size " + path);
        chunks.push(chunk); size = nextSize;
      } catch (error) { fail(error); }
    });
    stream.on("end", () => {
      if (settled) return;
      settled = true;
      try { resolve(Buffer.concat(chunks, size)); }
      catch (error) { reject(error); }
      finally { chunks.length = 0; }
    });
  });
}

function normalizeReadLimits(limits: HwpxPackageReadLimits | undefined): Required<HwpxPackageReadLimits> {
  return {
    maxEntries: normalizePositiveInteger(limits?.maxEntries, DEFAULT_READ_LIMITS.maxEntries, "maxEntries"),
    maxEntryBytes: normalizePositiveInteger(limits?.maxEntryBytes, DEFAULT_READ_LIMITS.maxEntryBytes, "maxEntryBytes"),
    maxExpandedBytes: normalizePositiveInteger(
      limits?.maxExpandedBytes,
      DEFAULT_READ_LIMITS.maxExpandedBytes,
      "maxExpandedBytes"
    )
  };
}

function normalizePositiveInteger(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(Math.floor(value)) || Math.floor(value) <= 0) {
    throw new Error(`Invalid HWPX read limit: ${name} must be a positive number.`);
  }
  return Math.floor(value);
}

function assertEntrySizeWithinLimit(path: string, size: number, limit: number): void {
  if (size > limit) {
    throw new Error(`Invalid HWPX package: entry exceeds supported size ${path} (${size} bytes; limit ${limit} bytes)`);
  }
}

function assertDeclaredEntriesWithinLimits(
  entries: ZipDirectoryEntry[],
  limits: Required<HwpxPackageReadLimits>
): void {
  const files = entries.filter((entry) => !entry.isDirectory);
  if (files.length > limits.maxEntries) {
    throw new Error(`Invalid HWPX package: too many entries (${files.length}; limit ${limits.maxEntries})`);
  }
  let expandedBytes = 0;
  for (const entry of entries) {
    if (!isSafePackagePath(entry.isDirectory ? entry.path.slice(0, -1) : entry.path)) {
      throw new Error(`Invalid HWPX package: unsafe entry path ${entry.path}`);
    }
    if (entry.isDirectory) {
      if (entry.uncompressedSize !== 0) throw new Error("Invalid HWPX package: nonempty directory entry " + entry.path);
      continue;
    }
    assertEntrySizeWithinLimit(entry.path, entry.uncompressedSize, limits.maxEntryBytes);
    expandedBytes += entry.uncompressedSize;
    if (expandedBytes > limits.maxExpandedBytes) {
      throw new Error(
        `Invalid HWPX package: expanded contents exceed supported size (${expandedBytes} bytes; limit ${limits.maxExpandedBytes} bytes)`
      );
    }
  }
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
    if (/\.(ttf|otf|woff|woff2)$/i.test(lower)) return "font";
    if (/\.ole$/i.test(lower)) return "ole";
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

function rejectProtectedHwpxEntries(entries: HwpxEntry[]): void {
  if (entries.some((entry) => isProtectedPackagePath(entry.path) || hasProtectedMetadata(entry))) {
    throw new Error(PROTECTED_DOCUMENT_ERROR);
  }
}

function isProtectedPackagePath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").toLowerCase();
  return (
    normalized.startsWith("_xmlsignatures/") ||
    normalized.startsWith("drm/") ||
    normalized.startsWith("security/") ||
    normalized.includes("/drm/") ||
    normalized.includes("/security/") ||
    normalized.includes("/_xmlsignatures/") ||
    normalized.endsWith("/signatures.xml") ||
    normalized.endsWith("/signature.xml")
  );
}

const PROTECTION_TOKENS =
  "documentProtection|readOnlyRecommended|modifyPassword|writeProtection|editProtection|rightsManagement|drm|encrypted|digitalSignature|signatureInfo|certificate";
// Match protection markers only in structural positions: an element name
// (`<drm`, `</drm`, optionally namespaced), an attribute name (`drm=`), or an
// OPF/meta declaration whose name is the marker (`<meta name="documentProtection">`).
// Prose or free text that merely mentions one of these words (e.g. a template
// describing a "certificate") no longer triggers a false rejection.
const PROTECTED_ELEMENT_PATTERN = new RegExp(`<\\/?(?:[\\w.-]+:)?(?:${PROTECTION_TOKENS})\\b`, "i");
const PROTECTED_ATTRIBUTE_PATTERN = new RegExp(`\\b(?:[\\w.-]+:)?(?:${PROTECTION_TOKENS})\\s*=`, "i");
const PROTECTED_META_NAME_PATTERN = new RegExp(`name\\s*=\\s*["'](?:[\\w.-]+:)?(?:${PROTECTION_TOKENS})\\b`, "i");

function hasProtectedMetadata(entry: HwpxEntry): boolean {
  if (entry.kind !== "xml") return false;
  const normalized = entry.path.replace(/\\/g, "/");
  if (/^Contents\/section\d+\.xml$/i.test(normalized)) return false;
  const text = entry.data.toString("utf8");
  return (
    PROTECTED_ELEMENT_PATTERN.test(text) ||
    PROTECTED_ATTRIBUTE_PATTERN.test(text) ||
    PROTECTED_META_NAME_PATTERN.test(text)
  );
}
