import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { getDecodedImage } from "../src/decodedImage.js";
import { computeDecodedPixelHash } from "../src/visualSimilarity.js";
import { findSameVisualImageGroups } from "../src/imageDuplicates.js";
import { computeVisualMetrics } from "../src/imagePreview.js";
import { optimizeHwpxBufferSafe, optimizeHwpxBufferBalanced, optimizeHwpxBufferAggressive } from "../src/optimize.js";
import { transformImageActionWithBudget } from "../src/opportunities.js";
import { readHwpxPackage } from "../src/reader.js";
import { writeHwpxPackage } from "../src/writer.js";
import { verifyHwpxOutput } from "../src/verifier.js";
import { readBmpInfo, decodeBmp } from "../src/bmp.js";
import { createHwpxFixture } from "./fixtures.js";

describe("image appearance preservation", () => {
  it("keeps alpha in decoded pixels and distinguishes it in exact hashes", async () => {
    const translucent = await png(0.25);
    const opaque = await png(1);
    const decoded = await getDecodedImage(translucent);
    expect(decoded?.channels).toBe(4);
    expect(decoded?.data[3]).toBe(64);
    expect((await computeDecodedPixelHash(translucent))?.hash)
      .not.toBe((await computeDecodedPixelHash(opaque))?.hash);
  });

  it("still treats fully opaque RGBA and RGB as pixel-identical", async () => {
    const rgba = await png(1);
    const rgb = await sharp(rgba).removeAlpha().png().toBuffer();
    expect((await computeDecodedPixelHash(rgba))?.hash).toBe((await computeDecodedPixelHash(rgb))?.hash);
  });

  it.each([
    ["safe", optimizeHwpxBufferSafe],
    ["balanced", optimizeHwpxBufferBalanced],
    ["aggressive", optimizeHwpxBufferAggressive]
  ] as const)("%s retains transparent PNG pixels in final output", async (_mode, optimize) => {
    const originalPng = await png(0.25);
    const fixture = await imageFixture({ "BinData/transparent.png": originalPng });
    const result = await optimize(fixture);
    const outputImage = (await readHwpxPackage(result.output)).entries.find(entry => entry.path.endsWith("transparent.png"))!;
    expect((await sharp(outputImage.data).metadata()).hasAlpha).toBe(true);
    const [before, after] = await Promise.all([pixels(originalPng), pixels(outputImage.data)]);
    expect(after).toEqual(before);
    expect(result.report.actions.applied).toContainEqual(expect.objectContaining({ type: "optimize-png" }));
  });

  it("does not consolidate images whose alpha differs", async () => {
    const fixture = await imageFixture({ "BinData/a.png": await png(0.25), "BinData/b.png": await png(1) });
    expect(await findSameVisualImageGroups(await readHwpxPackage(fixture))).toEqual([]);
    const result = await optimizeHwpxBufferBalanced(fixture, { actions: ["consolidate-duplicate-images"] });
    expect(result.report.actions.applied).not.toContainEqual(expect.objectContaining({ type: "consolidate-duplicate-images" }));
    expect((await readHwpxPackage(result.output)).entries.filter(entry => entry.kind === "image")).toHaveLength(2);
  });

  it("detects alpha loss in dark and light background quality samples", async () => {
    const translucent = await png(0.25);
    const opaque = await sharp(translucent).removeAlpha().png().toBuffer();
    const metrics = await computeVisualMetrics(translucent, opaque);
    expect(metrics.psnr).toBeLessThan(18);
    expect(metrics.ssim).toBeLessThan(0.72);
  });

  it.each(["safe", "balanced", "aggressive"] as const)("%s verifier rejects removed transparency", async (mode) => {
    const transparent = await png(0.25);
    const fixture = await imageFixture({ "BinData/image.png": transparent });
    const pkg = await readHwpxPackage(fixture);
    const removedAlpha = await sharp(transparent).removeAlpha().png().toBuffer();
    const output = await writeHwpxPackage({ entries: pkg.entries.map(entry => entry.path.endsWith("image.png")
      ? { ...entry, data: removedAlpha, size: removedAlpha.length } : entry) });
    await expect(verifyHwpxOutput(output, { original: fixture, mode })).rejects.toThrow(/pixels or alpha changed|image quality too low/);
  });

  it("retains alpha through PNG resizing", async () => {
    const input = await png(0.25);
    const result = await transformImageActionWithBudget("BinData/image.png", input, "resize-png", { width: 64, height: 64 });
    const meta = await sharp(result.data).metadata();
    expect(meta).toMatchObject({ width: 64, height: 64, hasAlpha: true });
    expect((await pixels(result.data))[3]).toBe(64);
  });

  it.each(["profile", "16-bit", "multi-page"] as const)("preserves %s bytes and reports the reason", async (kind) => {
    const data = kind === "profile"
      ? await sharp(await png(0.25)).withIccProfile("p3").png({ compressionLevel: 0 }).toBuffer()
      : kind === "16-bit"
        ? await sharp({ create: { width: 128, height: 128, channels: 3, background: "#224466" } }).toColourspace("rgb16").png({ compressionLevel: 0 }).toBuffer()
        : await sharp({ create: { width: 128, height: 256, pageHeight: 128, channels: 3, background: "#224466" } }).tiff({ compression: "none" }).toBuffer();
    const path = `BinData/preserved.${kind === "multi-page" ? "tiff" : "png"}`;
    const fixture = await imageFixture({ [path]: data });
    for (const optimize of [optimizeHwpxBufferSafe, optimizeHwpxBufferBalanced, optimizeHwpxBufferAggressive]) {
      const result = await optimize(fixture);
      expect((await readHwpxPackage(result.output)).entries.find(entry => entry.path === path)?.data).toEqual(data);
      expect(result.report.warnings.some(warning => warning.includes("Image bytes preserved") && warning.includes(path))).toBe(true);
    }
    expect(await getDecodedImage(data)).toBeNull();
    await expect(transformImageActionWithBudget(path, data, kind === "multi-page" ? "convert-tiff-to-png" : "optimize-png"))
      .rejects.toThrow(/profile|precision|frames/);
  });

  it("does not decode or transform alpha-mask BMPs", async () => {
    const data = alphaBmp();
    expect(readBmpInfo(data)?.supported).toBe(false);
    expect(decodeBmp(data)).toBeNull();
    expect(await getDecodedImage(data)).toBeNull();
    const fixture = await imageFixture({ "BinData/alpha.bmp": data });
    const result = await optimizeHwpxBufferBalanced(fixture);
    expect((await readHwpxPackage(result.output)).entries.find(entry => entry.path === "BinData/alpha.bmp")?.data).toEqual(data);
    expect(result.report.warnings.some(warning => warning.includes("alpha or encoding"))).toBe(true);
  });
});

async function png(alpha: number): Promise<Buffer> {
  return sharp({ create: { width: 128, height: 128, channels: 4, background: { r: 220, g: 40, b: 10, alpha } } })
    .png({ compressionLevel: 0 }).toBuffer();
}

async function pixels(data: Buffer): Promise<Buffer> {
  return sharp(data).toColourspace("srgb").ensureAlpha().raw().toBuffer();
}

async function imageFixture(images: Record<string, Buffer>): Promise<Buffer> {
  return createHwpxFixture({ entries: {
    "Contents/content.hpf": '<package><manifest>' + Object.keys(images).map((path, i) =>
      `<item id="image${i}" href="${path}"/>`).join("") + '</manifest></package>',
    "Contents/section0.xml": '<root>' + Object.keys(images).map((_, i) => `<img binaryItemIDRef="image${i}"/>`).join("") + '</root>',
    "BinData/unused.bin": Buffer.alloc(8192),
    ...images
  } });
}

function alphaBmp(): Buffer {
  const width = 128, height = 128, offset = 14 + 108;
  const buffer = Buffer.alloc(offset + width * height * 4);
  buffer.write("BM"); buffer.writeUInt32LE(buffer.length, 2); buffer.writeUInt32LE(offset, 10);
  buffer.writeUInt32LE(108, 14); buffer.writeInt32LE(width, 18); buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26); buffer.writeUInt16LE(32, 28); buffer.writeUInt32LE(3, 30);
  buffer.writeUInt32LE(0xff0000, 54); buffer.writeUInt32LE(0xff00, 58);
  buffer.writeUInt32LE(0xff, 62); buffer.writeUInt32LE(0xff000000, 66);
  for (let i = offset; i < buffer.length; i += 4) buffer.writeUInt32LE(0x40223344, i);
  return buffer;
}
