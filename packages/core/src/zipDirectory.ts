/** ZIP metadata preflight, independent of decompressor-private fields. */
export type ZipDirectoryEntry = {
  path: string;
  isDirectory: boolean;
  generalPurposeBitFlag: number;
  uncompressedSize: number;
  compressedSize: number;
  compressedStart: number;
  compressionMethod: number;
};
const invalid = (reason: string): Error => new Error(`Invalid HWPX package: ${reason}`);

function uint64(input: Buffer, offset: number, end: number): number {
  if (offset < 0 || offset + 8 > end) throw invalid("truncated ZIP64 field");
  const value = input.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw invalid("ZIP64 value exceeds safe integer range");
  return Number(value);
}

function endRecordOffset(input: Buffer): number {
  for (let offset = input.length - 22; offset >= Math.max(0, input.length - 22 - 0xffff); offset -= 1) {
    if (input.readUInt32LE(offset) === 0x06054b50 && offset + 22 + input.readUInt16LE(offset + 20) === input.length) return offset;
  }
  throw invalid("input is not a readable ZIP archive (missing end record)");
}

export function readZipDirectory(input: Buffer, maxEntries: number): ZipDirectoryEntry[] {
  const end = endRecordOffset(input);
  if (input.readUInt16LE(end + 4) || input.readUInt16LE(end + 6)) throw invalid("multi-volume ZIP is unsupported");
  let count = input.readUInt16LE(end + 10);
  let size = input.readUInt32LE(end + 12), declaredOffset = input.readUInt32LE(end + 16);
  let directoryEnd = end;
  let zip64Pointer: number | undefined;
  if (count === 0xffff || input.readUInt16LE(end + 8) === 0xffff || size === 0xffffffff || declaredOffset === 0xffffffff) {
    const locator = end - 20;
    if (locator < 0 || input.readUInt32LE(locator) !== 0x07064b50) throw invalid("missing ZIP64 locator");
    if (input.readUInt32LE(locator + 4) !== 0 || input.readUInt32LE(locator + 16) !== 1) throw invalid("multi-volume ZIP64 is unsupported");
    zip64Pointer = uint64(input, locator + 8, end);
    const record = locator - 56;
    // JSZip 3.x cannot read extensible ZIP64 end records reliably. Reject before
    // loading metadata rather than passing an unchecked or looping record on.
    if (record < 0 || input.readUInt32LE(record) !== 0x06064b50 || uint64(input, record + 4, locator) !== 44) {
      throw invalid("unsupported or malformed ZIP64 end record");
    }
    if (input.readUInt32LE(record + 16) || input.readUInt32LE(record + 20)) throw invalid("multi-volume ZIP64 is unsupported");
    count = uint64(input, record + 32, locator);
    if (count !== uint64(input, record + 24, locator)) throw invalid("inconsistent ZIP64 entry counts");
    size = uint64(input, record + 40, locator);
    declaredOffset = uint64(input, record + 48, locator);
    directoryEnd = record;
  } else if (input.readUInt16LE(end + 8) !== count) throw invalid("inconsistent ZIP entry counts");
  if (count > maxEntries) throw invalid(`too many entries (${count}; limit ${maxEntries})`);
  const directoryStart = directoryEnd - size;
  // Account for a prepended ZIP stub exactly as the metadata loader does.
  const prefixBytes = directoryStart - declaredOffset;
  if (directoryStart < 0 || prefixBytes < 0) throw invalid("central directory is outside the archive");
  if (zip64Pointer !== undefined && zip64Pointer + prefixBytes !== directoryEnd) throw invalid("inconsistent ZIP64 locator offset");

  const entries: ZipDirectoryEntry[] = [];
  const paths = new Set<string>();
  for (let offset = directoryStart; offset < directoryEnd;) {
    if (entries.length >= maxEntries) throw invalid(`too many entries (limit ${maxEntries})`);
    if (offset + 46 > directoryEnd || input.readUInt32LE(offset) !== 0x02014b50) throw invalid("malformed central directory");
    const nameStart = offset + 46, nameEnd = nameStart + input.readUInt16LE(offset + 28);
    const extraEnd = nameEnd + input.readUInt16LE(offset + 30), next = extraEnd + input.readUInt16LE(offset + 32);
    if (next > directoryEnd) throw invalid("truncated central directory entry");
    const path = input.subarray(nameStart, nameEnd).toString("utf8");
    if (paths.has(path)) throw invalid(`duplicate ZIP entry ${path}`);
    paths.add(path);
    let uncompressedSize = input.readUInt32LE(offset + 24), compressedSize = input.readUInt32LE(offset + 20);
    let localOffset = input.readUInt32LE(offset + 42), disk = input.readUInt16LE(offset + 34);
    let zip64Extra: { offset: number; end: number } | undefined;
    for (let extra = nameEnd; extra < extraEnd;) {
      if (extra + 4 > extraEnd) throw invalid("truncated ZIP extra field");
      const length = input.readUInt16LE(extra + 2), fieldEnd = extra + 4 + length;
      if (fieldEnd > extraEnd) throw invalid("truncated ZIP extra field");
      if (input.readUInt16LE(extra) === 1) {
        if (zip64Extra) throw invalid("duplicate ZIP64 extra field");
        zip64Extra = { offset: extra + 4, end: fieldEnd };
      }
      extra = fieldEnd;
    }
    const next64 = (): number => {
      if (!zip64Extra) throw invalid("missing ZIP64 size/offset field");
      const value = uint64(input, zip64Extra.offset, zip64Extra.end);
      zip64Extra.offset += 8; return value;
    };
    if (uncompressedSize === 0xffffffff) uncompressedSize = next64();
    if (compressedSize === 0xffffffff) compressedSize = next64();
    if (localOffset === 0xffffffff) localOffset = next64();
    if (disk === 0xffff) {
      if (!zip64Extra || zip64Extra.offset + 4 > zip64Extra.end) throw invalid("missing ZIP64 disk field");
      disk = input.readUInt32LE(zip64Extra.offset);
    }
    if (disk !== 0) throw invalid("multi-volume ZIP entry is unsupported");
    const local = localOffset + prefixBytes;
    if (local < 0 || local + 30 > directoryStart || input.readUInt32LE(local) !== 0x04034b50) throw invalid("invalid local ZIP header offset");
    const dataStart = local + 30 + input.readUInt16LE(local + 26) + input.readUInt16LE(local + 28);
    if (compressedSize > directoryStart - dataStart || dataStart > directoryStart) throw invalid("compressed entry is outside the archive");
    entries.push({ path, isDirectory: path.endsWith("/"), generalPurposeBitFlag: input.readUInt16LE(offset + 8), uncompressedSize,
      compressedSize, compressedStart: dataStart, compressionMethod: input.readUInt16LE(offset + 10) });
    offset = next;
  }
  if (entries.length !== count) throw invalid("central directory entry count mismatch");
  return entries;
}
