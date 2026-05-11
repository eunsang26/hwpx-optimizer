import { describe, expect, it } from "vitest";
import { BIN_DATA_PREFIX, normalizeImagePath, normalizePackagePath } from "../src/packagePath.js";

describe("normalizePackagePath", () => {
  it("returns null for non-BinData paths", () => {
    expect(normalizePackagePath("Contents/section0.xml")).toBeNull();
    expect(normalizePackagePath("Pictures/foo.png")).toBeNull();
    expect(normalizePackagePath("")).toBeNull();
  });

  it("returns canonical BinData/ prefix even when input casing varies", () => {
    expect(normalizePackagePath("BinData/img.png")).toBe("BinData/img.png");
    expect(normalizePackagePath("bindata/img.png")).toBe("BinData/img.png");
    expect(normalizePackagePath("BINDATA/IMG.PNG")).toBe("BinData/IMG.PNG");
  });

  it("preserves file name casing inside BinData", () => {
    expect(normalizePackagePath("bindata/Mixed_Case.JPG")).toBe("BinData/Mixed_Case.JPG");
  });

  it("strips leading #, ./, and / characters", () => {
    expect(normalizePackagePath("#BinData/a.png")).toBe("BinData/a.png");
    expect(normalizePackagePath("./BinData/a.png")).toBe("BinData/a.png");
    expect(normalizePackagePath("/BinData/a.png")).toBe("BinData/a.png");
  });

  it("converts backslashes to forward slashes", () => {
    expect(normalizePackagePath("BinData\\sub\\a.png")).toBe("BinData/sub/a.png");
  });

  it("decodes percent-encoded path segments", () => {
    expect(normalizePackagePath("BinData/with%20space.png")).toBe("BinData/with space.png");
  });

  it("rejects path traversal attempts inside BinData", () => {
    expect(normalizePackagePath("BinData/../etc/passwd")).toBeNull();
    expect(normalizePackagePath("BinData/./a.png")).toBeNull();
    expect(normalizePackagePath("BinData//a.png")).toBeNull();
  });

  it("falls back to the input when percent decoding fails", () => {
    expect(normalizePackagePath("BinData/%E0%A4%A.png")).toBe("BinData/%E0%A4%A.png");
  });

  it("exports the canonical prefix constant", () => {
    expect(BIN_DATA_PREFIX).toBe("BinData/");
  });
});

describe("normalizeImagePath", () => {
  it("delegates to normalizePackagePath for BinData references", () => {
    expect(normalizeImagePath("bindata/foo.png")).toBe("BinData/foo.png");
  });

  it("keeps non-BinData package paths that end with an image extension", () => {
    expect(normalizeImagePath("Pictures/foo.png")).toBe("Pictures/foo.png");
    expect(normalizeImagePath("Pictures/foo.JPG")).toBe("Pictures/foo.JPG");
    expect(normalizeImagePath("Pictures/foo.tiff")).toBe("Pictures/foo.tiff");
  });

  it("returns null for paths without image extensions outside BinData", () => {
    expect(normalizeImagePath("Contents/section0.xml")).toBeNull();
    expect(normalizeImagePath("anything.txt")).toBeNull();
  });
});
