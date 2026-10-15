import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readHwpxPackage } from "../src/reader.js";
import { createHwpxFixture } from "./fixtures.js";

/** Force small, independently generated ZIPs into ZIP64 without allocating large data. */
function zip64(input: Buffer, options: { endRecord?: boolean; declaredSize?: bigint } = {}): Buffer {
  const end = input.length - 22, directory = input.readUInt32LE(end + 16), records: Buffer[] = [];
  for (let offset = directory; offset < end;) {
    const nameLength = input.readUInt16LE(offset + 28), extraLength = input.readUInt16LE(offset + 30), commentLength = input.readUInt16LE(offset + 32);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    const header = Buffer.from(input.subarray(offset, offset + 46));
    const extra = Buffer.alloc(28); extra.writeUInt16LE(1); extra.writeUInt16LE(24, 2);
    const path = input.subarray(offset + 46, offset + 46 + nameLength).toString();
    extra.writeBigUInt64LE(path === "BinData/payload.bin" && options.declaredSize !== undefined ? options.declaredSize : BigInt(input.readUInt32LE(offset + 24)), 4);
    extra.writeBigUInt64LE(BigInt(input.readUInt32LE(offset + 20)), 12); extra.writeBigUInt64LE(BigInt(input.readUInt32LE(offset + 42)), 20);
    header.writeUInt16LE(45, 6); header.writeUInt32LE(0xffffffff, 20); header.writeUInt32LE(0xffffffff, 24); header.writeUInt32LE(0xffffffff, 42);
    header.writeUInt16LE(extraLength + extra.length, 30);
    records.push(Buffer.concat([header, input.subarray(offset + 46, offset + 46 + nameLength), extra, input.subarray(offset + 46 + nameLength, next)]));
    offset = next;
  }
  const central = Buffer.concat(records), footer = Buffer.from(input.subarray(end));
  if (options.endRecord === false) {
    footer.writeUInt32LE(central.length, 12);
    return Buffer.concat([input.subarray(0, directory), central, footer]);
  }
  const record = Buffer.alloc(56); record.writeUInt32LE(0x06064b50); record.writeBigUInt64LE(44n, 4);
  record.writeUInt16LE(45, 12); record.writeUInt16LE(45, 14);
  record.writeBigUInt64LE(BigInt(records.length), 24); record.writeBigUInt64LE(BigInt(records.length), 32);
  record.writeBigUInt64LE(BigInt(central.length), 40); record.writeBigUInt64LE(BigInt(directory), 48);
  const locator = Buffer.alloc(20); locator.writeUInt32LE(0x07064b50); locator.writeBigUInt64LE(BigInt(directory + central.length), 8); locator.writeUInt32LE(1, 16);
  footer.writeUInt16LE(0xffff, 8); footer.writeUInt16LE(0xffff, 10); footer.writeUInt32LE(0xffffffff, 12); footer.writeUInt32LE(0xffffffff, 16);
  return Buffer.concat([input.subarray(0, directory), central, record, locator, footer]);
}
function forgeDeclaredSize(input: Buffer, target: string, bytes: number): Buffer {
  const result = Buffer.from(input), end = result.length - 22;
  for (let offset = result.readUInt32LE(end + 16); offset < end;) {
    const nameLength = result.readUInt16LE(offset + 28), extraLength = result.readUInt16LE(offset + 30), commentLength = result.readUInt16LE(offset + 32);
    const path = result.subarray(offset + 46, offset + 46 + nameLength).toString();
    if (path === target) result.writeUInt32LE(bytes, offset + 24);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return result;
}
async function encodedFixture(entries: Record<string, Buffer | string>, encodeFileName?: (path: string) => Buffer) {
  const zip = new JSZip();
  for (const [path, data] of Object.entries({ mimetype: "application/hwp+zip", "Contents/content.hpf": "<root/>", "Contents/section0.xml": "<root/>", ...entries })) zip.file(path, data);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", encodeFileName });
}
afterEach(() => vi.restoreAllMocks());

describe("ZIP preflight and bounded expansion", () => {
  it.each([true, false])("reads valid small ZIP64 entries with end-record=%s", async (endRecord) => {
    const input = await createHwpxFixture({ entries: { "BinData/payload.bin": "synthetic" } });
    const result = await readHwpxPackage(zip64(input, { endRecord }));
    expect(result.entries.find(entry => entry.path === "BinData/payload.bin")?.data.toString()).toBe("synthetic");
  });
  it.each([false, true])("retains prepended-stub compatibility for ZIP64=%s", async (useZip64) => {
    const original = await createHwpxFixture({ entries: {} });
    const prefixed = Buffer.concat([Buffer.from("synthetic-prefix"), useZip64 ? zip64(original) : original]);
    expect((await readHwpxPackage(prefixed)).entries.some(entry => entry.path === "Contents/section0.xml")).toBe(true);
  });
  it.each([1024n * 1024n * 1024n, 2n ** 53n])("rejects ZIP64 declared size %s before the metadata loader", async (declaredSize) => {
    const input = zip64(await createHwpxFixture({ entries: { "BinData/payload.bin": "small" } }), { declaredSize });
    const load = vi.spyOn(JSZip, "loadAsync");
    await expect(readHwpxPackage(input)).rejects.toThrow(/entry exceeds supported size|safe integer range/);
    expect(load).not.toHaveBeenCalled();
  });
  it("rejects forged ZIP64 entry counts before the loader", async () => {
    const input = zip64(await createHwpxFixture({ entries: {} })); const record = input.length - 22 - 20 - 56;
    input.writeBigUInt64LE(20_001n, record + 24); input.writeBigUInt64LE(20_001n, record + 32);
    const load = vi.spyOn(JSZip, "loadAsync");
    await expect(readHwpxPackage(input)).rejects.toThrow(/too many entries/); expect(load).not.toHaveBeenCalled();
  });
  it("rejects missing ZIP64 size metadata rather than skipping size preflight", async () => {
    const input = await createHwpxFixture({ entries: {} }); const directory = input.readUInt32LE(input.length - 6);
    input.writeUInt32LE(0xffffffff, directory + 24);
    const load = vi.spyOn(JSZip, "loadAsync");
    await expect(readHwpxPackage(input)).rejects.toThrow(/missing ZIP64/); expect(load).not.toHaveBeenCalled();
  });
  it("rejects malformed directory ranges before the loader", async () => {
    const input = await createHwpxFixture({ entries: {} }); input.writeUInt32LE(0xffffffff - 1, input.length - 6);
    const load = vi.spyOn(JSZip, "loadAsync");
    await expect(readHwpxPackage(input)).rejects.toThrow(/central directory/); expect(load).not.toHaveBeenCalled();
  });
  it("counts directory records toward the metadata entry limit", async () => {
    const input = await encodedFixture({ "a/": "", "b/": "", "c/": "" });
    const load = vi.spyOn(JSZip, "loadAsync");
    await expect(readHwpxPackage(input, { limits: { maxEntries: 5 } })).rejects.toThrow(/too many entries/); expect(load).not.toHaveBeenCalled();
  });
  it("rejects a false small size without concatenating the full 8MiB payload", async () => {
    const input = forgeDeclaredSize(await createHwpxFixture({ entries: { "BinData/payload.bin": Buffer.alloc(8 * 1024 * 1024, 7) } }), "BinData/payload.bin", 64 * 1024);
    const concat = vi.spyOn(Buffer, "concat");
    await expect(readHwpxPackage(input, { limits: { maxEntryBytes: 64 * 1024 } })).rejects.toThrow(/entry exceeds supported size/);
    expect(concat.mock.calls.every(([chunks]) => chunks.reduce((sum, chunk) => sum + chunk.length, 0) <= 64 * 1024)).toBe(true);
  });
  it.each(["DEFLATE", "STORE"] as const)("rejects a nonempty %s resource declared as zero before the loader can discard it", async compression => {
    const zip = new JSZip(); zip.file("mimetype", "application/hwp+zip"); zip.file("Contents/content.hpf", "<root/>"); zip.file("Contents/section0.xml", "<root/>");
    zip.file("BinData/payload.bin", Buffer.alloc(1024 * 1024, 7));
    const input = forgeDeclaredSize(await zip.generateAsync({ type: "nodebuffer", compression }), "BinData/payload.bin", 0);
    const load = vi.spyOn(JSZip, "loadAsync");
    await expect(readHwpxPackage(input)).rejects.toThrow(/entry exceeds declared size/);
    expect(load).not.toHaveBeenCalled();
  });
  it.each([true, false])("accepts an empty DEFLATE entry with explicit stream bytes=%s", async hasStreamBytes => {
    const original = await createHwpxFixture({ entries: { "BinData/empty.bin": Buffer.alloc(0) } });
    const oldEnd = original.length - 22, directory = original.readUInt32LE(oldEnd + 16);
    const compressed = hasStreamBytes ? Buffer.from([3, 0]) : Buffer.alloc(0);
    const input = Buffer.concat([original.subarray(0, directory), compressed, original.subarray(directory)]);
    const end = input.length - 22; input.writeUInt32LE(directory + compressed.length, end + 16);
    for (let offset = directory + compressed.length; offset < end;) {
      const nameLength = input.readUInt16LE(offset + 28);
      if (input.subarray(offset + 46, offset + 46 + nameLength).toString() === "BinData/empty.bin") {
        const local = input.readUInt32LE(offset + 42);
        input.writeUInt16LE(8, local + 8); input.writeUInt32LE(compressed.length, local + 18);
        input.writeUInt16LE(8, offset + 10); input.writeUInt32LE(compressed.length, offset + 20);
      }
      offset += 46 + nameLength + input.readUInt16LE(offset + 30) + input.readUInt16LE(offset + 32);
    }
    expect((await readHwpxPackage(input)).entries.find(entry => entry.path === "BinData/empty.bin")?.data.length).toBe(0);
  });
  it("rejects expansion above the declaration even when configured limits are larger", async () => {
    const input = forgeDeclaredSize(await createHwpxFixture({ entries: { "BinData/payload.bin": Buffer.alloc(2 * 1024 * 1024) } }), "BinData/payload.bin", 32);
    await expect(readHwpxPackage(input)).rejects.toThrow(/entry exceeds declared size/);
  });
  it("bounds real aggregate expansion when Unicode metadata changes the decoded entry name", async () => {
    const encoded = await encodedFixture({ "BinData/first.bin": Buffer.alloc(32 * 1024, 3), "BinData/합성.bin": Buffer.alloc(8 * 1024 * 1024, 7) }, path => Buffer.from(path.replace("합성", "synthetic")));
    const input = forgeDeclaredSize(encoded, "BinData/synthetic.bin", 32 * 1024);
    const concat = vi.spyOn(Buffer, "concat");
    await expect(readHwpxPackage(input, { limits: { maxExpandedBytes: 70 * 1024 } })).rejects.toThrow(/expanded contents exceed supported size/);
    expect(concat.mock.calls.every(([chunks]) => chunks.reduce((sum, chunk) => sum + chunk.length, 0) <= 70 * 1024)).toBe(true);
  });
  it("retains valid Unicode paths and rejects unsafe Unicode aliases before expansion", async () => {
    const valid = await encodedFixture({ "BinData/합성.bin": "safe" }, path => Buffer.from(path.replace("합성", "synthetic")));
    expect((await readHwpxPackage(valid)).entries.some(entry => entry.path === "BinData/합성.bin")).toBe(true);
    const unsafe = await encodedFixture({ "../탈출.bin": "unsafe" }, path => Buffer.from(path.replace("../탈출", "safe")));
    await expect(readHwpxPackage(unsafe)).rejects.toThrow(/unsafe entry path/);
  });
  it.each([0.5, Number.MAX_SAFE_INTEGER + 1, Infinity])("rejects unsafe read limit %s", async (maxEntryBytes) => {
    const input = await createHwpxFixture({ entries: {} });
    await expect(readHwpxPackage(input, { limits: { maxEntryBytes } })).rejects.toThrow(/Invalid HWPX read limit/);
  });
});
