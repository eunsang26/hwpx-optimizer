import { describe, expect, it } from "vitest";
import { isSafePackagePath, readHwpxPackage } from "../src/reader.js";
import { createHwpxFixture } from "./fixtures.js";

const protectedDocumentMessage = /보안 처리된 문서는 최적화 대상이 아닙니다/;

describe("readHwpxPackage", () => {
  it("reads entries from a valid HWPX zip buffer", async () => {
    const fixture = await createHwpxFixture({
      entries: {
        mimetype: "application/hwp+zip",
        "Contents/content.hpf": '<opf:package xmlns:opf="http://www.idpf.org/2007/opf" />',
        "Contents/section0.xml": "<root />"
      }
    });

    const result = await readHwpxPackage(fixture);

    expect(result.entries.map((entry) => entry.path).sort()).toEqual([
      "Contents/content.hpf",
      "Contents/section0.xml",
      "mimetype"
    ]);
  });

  it("fails clearly for an invalid zip buffer", async () => {
    await expect(readHwpxPackage(Buffer.from("not a zip"))).rejects.toThrow(/Invalid HWPX package/);
  });

  it("fails clearly for an encrypted HWPX zip package", async () => {
    await expect(readHwpxPackage(createEncryptedZipHeaderFixture())).rejects.toThrow(protectedDocumentMessage);
  });

  it("does not reject ordinary data that only contains an encrypted local-header byte pattern", async () => {
    const fixture = await createHwpxFixture({
      entries: {
        "BinData/pattern.bin": createEncryptedLocalHeaderPattern()
      }
    });

    await expect(readHwpxPackage(fixture)).resolves.toEqual(
      expect.objectContaining({
        entries: expect.arrayContaining([expect.objectContaining({ path: "BinData/pattern.bin" })])
      })
    );
  });

  it("fails clearly when protected HWPX signature entries are present", async () => {
    const fixture = await createHwpxFixture({
      entries: {
        "_xmlsignatures/sig1.xml": "<Signature />"
      }
    });

    await expect(readHwpxPackage(fixture)).rejects.toThrow(protectedDocumentMessage);
  });

  it("fails clearly when protected HWPX metadata is present", async () => {
    const fixture = await createHwpxFixture({
      entries: {
        "Contents/content.hpf":
          '<opf:package xmlns:opf="http://www.idpf.org/2007/opf"><opf:metadata><opf:meta name="documentProtection" content="readOnly" /></opf:metadata></opf:package>'
      }
    });

    await expect(readHwpxPackage(fixture)).rejects.toThrow(protectedDocumentMessage);
  });

  it("fails clearly when required HWPX package files are missing", async () => {
    const fixture = await createHwpxFixture({
      includeRequiredFiles: false,
      entries: {
        "BinData/image1.png": Buffer.from("not really png")
      }
    });

    await expect(readHwpxPackage(fixture)).rejects.toThrow(/missing required files/i);
  });

  it("rejects packages with too many entries before trusting package contents", async () => {
    const fixture = await createHwpxFixture({
      entries: {
        "BinData/a.bin": "a",
        "BinData/b.bin": "b"
      }
    });

    await expect(readHwpxPackage(fixture, { limits: { maxEntries: 3 } })).rejects.toThrow(
      /too many entries/i
    );
  });

  it("rejects packages with an oversized expanded entry", async () => {
    const fixture = await createHwpxFixture({
      entries: {
        "BinData/large.bin": Buffer.alloc(16)
      }
    });

    await expect(readHwpxPackage(fixture, { limits: { maxEntryBytes: 8 } })).rejects.toThrow(
      /entry exceeds supported size/i
    );
  });

  it("rejects packages whose expanded contents exceed the total limit", async () => {
    const fixture = await createHwpxFixture({
      entries: {
        "BinData/a.bin": Buffer.alloc(8),
        "BinData/b.bin": Buffer.alloc(8)
      }
    });

    await expect(readHwpxPackage(fixture, { limits: { maxExpandedBytes: 12 } })).rejects.toThrow(
      /expanded contents exceed supported size/i
    );
  });

  it("isSafePackagePath flags traversal and absolute segments", () => {
    expect(isSafePackagePath("BinData/foo.png")).toBe(true);
    expect(isSafePackagePath("Contents/section0.xml")).toBe(true);
    expect(isSafePackagePath("mimetype")).toBe(true);
    expect(isSafePackagePath("../etc/passwd")).toBe(false);
    expect(isSafePackagePath("BinData/../escape")).toBe(false);
    expect(isSafePackagePath("./local")).toBe(false);
    expect(isSafePackagePath("/absolute/path")).toBe(false);
    expect(isSafePackagePath("\\absolute\\path")).toBe(false);
    expect(isSafePackagePath("C:\\Windows\\system32")).toBe(false);
    expect(isSafePackagePath("BinData//double")).toBe(false);
    expect(isSafePackagePath("")).toBe(false);
  });

  it("fails clearly for an HWP binary buffer", async () => {
    const hwpHeader = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

    await expect(readHwpxPackage(Buffer.concat([hwpHeader, Buffer.from("HWP Document File")]))).rejects.toThrow(
      /Unsupported HWP binary file/
    );
  });
});

function createEncryptedZipHeaderFixture(): Buffer {
  const fileName = Buffer.from("Contents/content.hpf");
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(1, 6);
  localHeader.writeUInt16LE(0, 8);
  localHeader.writeUInt16LE(fileName.length, 26);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(1, 8);
  centralHeader.writeUInt16LE(0, 10);
  centralHeader.writeUInt16LE(fileName.length, 28);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralHeader.length + fileName.length, 12);
  end.writeUInt32LE(localHeader.length + fileName.length, 16);

  return Buffer.concat([localHeader, fileName, centralHeader, fileName, end]);
}

function createEncryptedLocalHeaderPattern(): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(1, 6);
  return header;
}
