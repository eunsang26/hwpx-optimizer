import JSZip from "jszip";
import type { HwpxEntry, HwpxEntryKind, HwpxPackage } from "./types.js";

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

type CentralDirectoryEntry = {
  path: string;
  isDirectory: boolean;
  generalPurposeBitFlag: number;
  uncompressedSize?: number;
};

export async function readHwpxPackage(input: Buffer, options: ReadHwpxPackageOptions = {}): Promise<HwpxPackage> {
  const limits = normalizeReadLimits(options.limits);
  if (isHwpBinary(input)) {
    throw new Error("Unsupported HWP binary file: save or export the document as .hwpx before optimizing");
  }
  if (hasEncryptedZipFlag(input)) {
    throw new Error(PROTECTED_DOCUMENT_ERROR);
  }
  const declaredEntries = readCentralDirectoryEntries(input);
  if (declaredEntries) assertDeclaredEntriesWithinLimits(declaredEntries, limits);

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
  if (files.length > limits.maxEntries) {
    throw new Error(`Invalid HWPX package: too many entries (${files.length}; limit ${limits.maxEntries})`);
  }

  let expandedBytes = 0;
  for (const [path, file] of files) {
    if (!isSafePackagePath(path)) {
      throw new Error(`Invalid HWPX package: unsafe entry path ${path}`);
    }
    const data = Buffer.from(await file.async("nodebuffer"));
    assertEntrySizeWithinLimit(path, data.byteLength, limits.maxEntryBytes);
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
  return { entries };
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
  if (!Number.isFinite(value) || value <= 0) {
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
  entries: CentralDirectoryEntry[],
  limits: Required<HwpxPackageReadLimits>
): void {
  const files = entries.filter((entry) => !entry.isDirectory);
  if (files.length > limits.maxEntries) {
    throw new Error(`Invalid HWPX package: too many entries (${files.length}; limit ${limits.maxEntries})`);
  }
  let expandedBytes = 0;
  for (const entry of files) {
    if (!isSafePackagePath(entry.path)) {
      throw new Error(`Invalid HWPX package: unsafe entry path ${entry.path}`);
    }
    if (entry.uncompressedSize === undefined) continue;
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

function hasEncryptedZipFlag(input: Buffer): boolean {
  return readCentralDirectoryEntries(input)?.some((entry) => (entry.generalPurposeBitFlag & 1) === 1) ?? false;
}

function findCentralDirectory(input: Buffer): { offset: number; size: number } | undefined {
  const minimumEndRecordSize = 22;
  const maxCommentSize = 0xffff;
  const start = Math.max(0, input.length - minimumEndRecordSize - maxCommentSize);
  for (let offset = input.length - minimumEndRecordSize; offset >= start; offset -= 1) {
    if (input.readUInt32LE(offset) !== 0x06054b50) continue;
    const commentLength = input.readUInt16LE(offset + 20);
    if (offset + minimumEndRecordSize + commentLength !== input.length) continue;
    return {
      size: input.readUInt32LE(offset + 12),
      offset: input.readUInt32LE(offset + 16)
    };
  }
  return undefined;
}

function readCentralDirectoryEntries(input: Buffer): CentralDirectoryEntry[] | undefined {
  const centralDirectory = findCentralDirectory(input);
  if (!centralDirectory) return undefined;
  const end = centralDirectory.offset + centralDirectory.size;
  if (centralDirectory.offset < 0 || end > input.length) return undefined;

  const entries: CentralDirectoryEntry[] = [];
  let offset = centralDirectory.offset;
  while (offset < end) {
    if (offset + 46 > end || input.readUInt32LE(offset) !== 0x02014b50) return undefined;
    const generalPurposeBitFlag = input.readUInt16LE(offset + 8);
    const uncompressedSize32 = input.readUInt32LE(offset + 24);
    const fileNameLength = input.readUInt16LE(offset + 28);
    const extraLength = input.readUInt16LE(offset + 30);
    const commentLength = input.readUInt16LE(offset + 32);
    const pathStart = offset + 46;
    const pathEnd = pathStart + fileNameLength;
    const nextOffset = pathEnd + extraLength + commentLength;
    if (pathEnd > end || nextOffset > end) return undefined;
    const path = input.subarray(pathStart, pathEnd).toString("utf8");
    entries.push({
      path,
      isDirectory: path.endsWith("/"),
      generalPurposeBitFlag,
      ...(uncompressedSize32 === 0xffffffff ? {} : { uncompressedSize: uncompressedSize32 })
    });
    offset = nextOffset;
  }
  return offset === end ? entries : undefined;
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

function hasProtectedMetadata(entry: HwpxEntry): boolean {
  if (entry.kind !== "xml") return false;
  const normalized = entry.path.replace(/\\/g, "/");
  if (/^Contents\/section\d+\.xml$/i.test(normalized)) return false;
  const text = entry.data.toString("utf8");
  return /\b(documentProtection|readOnlyRecommended|modifyPassword|writeProtection|editProtection|rightsManagement|drm|encrypted|digitalSignature|signatureInfo|certificate)\b/i.test(
    text
  );
}
