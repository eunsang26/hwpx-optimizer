import { describe, expect, it } from "vitest";
import { writeHwpxPackage } from "../src/writer.js";
import type { HwpxPackage } from "../src/types.js";

describe("writeHwpxPackage", () => {
  it("accepts an explicit ZIP compression level for speed-sensitive callers", async () => {
    const xml = Array.from({ length: 5000 }, (_, index) => `<p id="${index}">document image optimization test data</p>`).join("");
    const pkg: HwpxPackage = {
      entries: [
        {
          path: "Contents/section0.xml",
          data: Buffer.from(xml),
          size: Buffer.byteLength(xml),
          kind: "xml"
        }
      ]
    };

    const fast = await writeHwpxPackage(pkg, { compressionLevel: 1 });
    const compact = await writeHwpxPackage(pkg, { compressionLevel: 9 });

    expect(fast.byteLength).toBeGreaterThan(0);
    expect(compact.byteLength).toBeGreaterThan(0);
    expect(fast.equals(compact)).toBe(false);
  });

  it("stores lossy already-compressed image entries while still deflating XML, PNG, and BMP entries", async () => {
    const pkg: HwpxPackage = {
      entries: [
        {
          path: "Contents/section0.xml",
          data: Buffer.from("<root><p>document text</p></root>"),
          size: 34,
          kind: "xml"
        },
        {
          path: "BinData/photo.jpg",
          data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]),
          size: 8,
          kind: "image"
        },
        {
          path: "BinData/chart.png",
          data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]),
          size: 8,
          kind: "image"
        },
        {
          path: "BinData/raw.bmp",
          data: Buffer.from("bitmap data"),
          size: 11,
          kind: "image"
        }
      ]
    };

    const output = await writeHwpxPackage(pkg, { storeAlreadyCompressedImages: true });

    expect(localZipCompressionMethod(output, "Contents/section0.xml")).toBe(8);
    expect(localZipCompressionMethod(output, "BinData/photo.jpg")).toBe(0);
    expect(localZipCompressionMethod(output, "BinData/chart.png")).toBe(8);
    expect(localZipCompressionMethod(output, "BinData/raw.bmp")).toBe(8);
  });
});

function localZipCompressionMethod(zip: Buffer, path: string): number | undefined {
  let offset = 0;
  while (offset + 30 <= zip.byteLength) {
    if (zip.readUInt32LE(offset) !== 0x04034b50) {
      offset += 1;
      continue;
    }

    const method = zip.readUInt16LE(offset + 8);
    const compressedSize = zip.readUInt32LE(offset + 18);
    const fileNameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + fileNameLength;
    const name = zip.subarray(nameStart, nameEnd).toString("utf8");
    if (name === path) return method;
    offset = nameEnd + extraLength + compressedSize;
  }
  return undefined;
}
