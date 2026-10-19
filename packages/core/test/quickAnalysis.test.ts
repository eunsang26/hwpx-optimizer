import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeHwpxBuffer } from "../src/optimize.js";
import { createHwpxFixture } from "./fixtures.js";

async function mixedFixture() {
  const width = 256, height = 192;
  const raw = Buffer.alloc(width * height * 3);
  for (let index = 0; index < raw.length; index += 1) raw[index] = (index * 37 + Math.floor(index / 401)) % 256;
  const options = { raw: { width, height, channels: 3 as const } };
  const png = await sharp(raw, options).png().toBuffer();
  const blackPng = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#000" } }).png().toBuffer();
  const bmp = Buffer.alloc(54 + 64 * 48 * 3);
  bmp.write("BM"); bmp.writeUInt32LE(bmp.length, 2); bmp.writeUInt32LE(54, 10); bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(64, 18); bmp.writeInt32LE(48, 22); bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(24, 28);
  const images = {
    "BinData/a.jpg": await sharp(raw, options).jpeg({ quality: 95 }).toBuffer(),
    "BinData/a.png": png,
    "BinData/copy.png": png,
    "BinData/a.tif": await sharp(raw, options).tiff({ compression: "none" }).toBuffer(),
    "BinData/black.png": blackPng,
    "BinData/black.bmp": bmp
  };
  return createHwpxFixture({ entries: {
    ...images,
    "Contents/content.hpf": `<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest>${Object.keys(images).map((path, index) => `<opf:item id="i${index}" href="${path}"/>`).join("")}</opf:manifest></opf:package>`,
    "Contents/section0.xml": `<root>${Object.keys(images).map((_path, index) => `<pic><sz width="7200" height="5400"/><img binaryItemIDRef="i${index}"/></pic>`).join("")}</root>`
  } });
}

afterEach(() => vi.restoreAllMocks());
describe("quick analysis cost and coverage", () => {
  it("makes default and explicit quick identical without pixel decoding or encoding mixed image formats", async () => {
    const input = await mixedFixture();
    const toBuffer = vi.spyOn(sharp.prototype, "toBuffer");
    const implicit = await analyzeHwpxBuffer(input);
    const explicit = await analyzeHwpxBuffer(input, { analysisMode: "quick" });
    expect(toBuffer).not.toHaveBeenCalled();
    expect({ ...implicit, performance: undefined }).toEqual({ ...explicit, performance: undefined });
    expect(implicit.analysis).toEqual({ mode: "quick", imageSizes: "estimated", visualDuplicatesChecked: false });
    expect(implicit.duplicateImages).toHaveLength(1);
    expect(implicit.sameVisualDuplicateImages).toEqual([]);
    expect(implicit.nearDuplicateImages).toEqual([]);
    expect(implicit.opportunities).not.toContainEqual(expect.objectContaining({ target: "BinData/black.bmp", action: "consolidate-duplicate-images" }));
    expect(implicit.opportunities).toContainEqual(expect.objectContaining({ action: "convert-tiff-to-png", confidence: "estimated" }));
    expect(implicit.opportunities).toContainEqual(expect.objectContaining({ action: "resize-jpeg", confidence: "estimated" }));
  });
  it("runs pixel diagnostics and candidate encodes only when deep is requested", async () => {
    const input = await mixedFixture();
    const toBuffer = vi.spyOn(sharp.prototype, "toBuffer");
    const report = await analyzeHwpxBuffer(input, { analysisMode: "deep" });
    const formats = toBuffer.mock.contexts.map(context => (context as unknown as { options: { formatOut: string } }).options.formatOut);
    expect(formats).toContain("raw");
    expect(formats).toContain("jpeg");
    expect(formats).toContain("png");
    expect(report.analysis).toEqual({ mode: "deep", imageSizes: "encoded", visualDuplicatesChecked: true });
    expect(report.sameVisualDuplicateImages).toContainEqual(expect.objectContaining({ paths: ["BinData/black.bmp", "BinData/black.png"] }));
    expect(report.opportunities).toContainEqual(expect.objectContaining({ target: "BinData/black.bmp", action: "consolidate-duplicate-images", confidence: "exact" }));
    expect(report.opportunities.every(item => item.confidence === "exact")).toBe(true);
  });
});
