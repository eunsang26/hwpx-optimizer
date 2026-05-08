import { describe, expect, it } from "vitest";
import { isSafePackagePath, readHwpxPackage } from "../src/reader.js";
import { createHwpxFixture } from "./fixtures.js";

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

  it("fails clearly when required HWPX package files are missing", async () => {
    const fixture = await createHwpxFixture({
      includeRequiredFiles: false,
      entries: {
        "BinData/image1.png": Buffer.from("not really png")
      }
    });

    await expect(readHwpxPackage(fixture)).rejects.toThrow(/missing required files/i);
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
