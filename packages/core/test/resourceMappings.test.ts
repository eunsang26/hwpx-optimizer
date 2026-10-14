import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { extractImageDiffPreviews } from "../src/imagePreview.js";
import { optimizeHwpxBufferBalanced } from "../src/optimize.js";
import { readHwpxPackage } from "../src/reader.js";
import { inferResourceMappings } from "../src/resourceMappings.js";
import { verifyHwpxOutput } from "../src/verifier.js";
import { createHwpxFixture } from "./fixtures.js";

function bmp(): Buffer {
  const width = 32, height = 24, row = width * 3;
  const data = Buffer.alloc(54 + row * height);
  data.write("BM"); data.writeUInt32LE(data.length, 2); data.writeUInt32LE(54, 10);
  data.writeUInt32LE(40, 14); data.writeInt32LE(width, 18); data.writeInt32LE(height, 22);
  data.writeUInt16LE(1, 26); data.writeUInt16LE(24, 28); data.writeUInt32LE(row * height, 34);
  for (let index = 54; index < data.length; index += 3) {
    data[index] = 60; data[index + 1] = 120; data[index + 2] = 180;
  }
  return data;
}
async function fixture(images: Record<string, { path: string; data: Buffer }>): Promise<Buffer> {
  return createHwpxFixture({ entries: {
    "Contents/content.hpf": `<opf:package xmlns:opf="http://www.idpf.org/2007/opf"><opf:manifest>${Object.entries(images)
      .map(([id, image]) => `<opf:item id="${id}" href="${image.path}"/>`).join("")}</opf:manifest></opf:package>`,
    "Contents/section0.xml": `<root>${Object.keys(images).map((id) => `<hc:img binaryItemIDRef="${id}"/>`).join("")}</root>`,
    ...Object.fromEntries(Object.values(images).map((image) => [image.path, image.data]))
  } });
}
async function png(background: string): Promise<Buffer> {
  return sharp({ create: { width: 32, height: 24, channels: 3, background } }).png().toBuffer();
}

describe("actual image resource mappings", () => {
  it("verifies and previews BMP conversion through multiple occupied PNG names", async () => {
    const occupied = await png("#abcdef");
    const original = await fixture({
      bitmap: { path: "BinData/image.bmp", data: bmp() },
      png: { path: "BinData/image.png", data: occupied },
      one: { path: "BinData/image-opt.png", data: await png("#123456") },
      two: { path: "BinData/image-opt2.png", data: await png("#456789") }
    });
    const result = await optimizeHwpxBufferBalanced(original, { actions: ["convert-bmp-to-png"], allowLarger: true });
    const expected = { originalPath: "BinData/image.bmp", outputPath: "BinData/image-opt3.png", originalId: "bitmap", outputId: "bitmap" };
    expect(result.report.resourceMappings).toContainEqual(expected);
    expect(result.report.actions.applied).toContainEqual(expect.objectContaining({
      type: "convert-bmp-to-png", target: "BinData/image.bmp", outputPath: expected.outputPath
    }));
    const output = await readHwpxPackage(result.output);
    expect(output.entries.find((entry) => entry.path === "BinData/image.png")!.data).toEqual(occupied);
    await expect(verifyHwpxOutput(result.output, { original, mode: "balanced" })).resolves.toBeUndefined();
    await expect(verifyHwpxOutput(result.output, { original, mode: "balanced", resourceMappings: result.report.resourceMappings })).resolves.toBeUndefined();
    for (const options of [{}, { resourceMappings: result.report.resourceMappings }]) {
      const previews = await extractImageDiffPreviews(original, result.output, options);
      expect(previews).toHaveLength(1);
      expect(previews[0]).toMatchObject({ originalPath: expected.originalPath, outputPath: expected.outputPath });
      expect(previews[0]!.psnrDb).toBeGreaterThan(70);
    }
    await expect(verifyHwpxOutput(result.output, { original, mode: "balanced", resourceMappings: [
      { ...expected, originalId: "nonexistent" }
    ] })).rejects.toThrow(/invalid explicit resource mapping/);
  });
  it("verifies and previews TIFF conversion without extension guesses", async () => {
    const tiff = await sharp({ create: { width: 32, height: 24, channels: 3, background: "#aabbcc" } })
      .tiff({ compression: "none" }).toBuffer();
    const original = await fixture({ image: { path: "BinData/photo.tiff", data: tiff } });
    const result = await optimizeHwpxBufferBalanced(original, { actions: ["convert-tiff-to-png"], allowLarger: true });
    expect(result.report.resourceMappings).toContainEqual({
      originalPath: "BinData/photo.tiff", outputPath: "BinData/photo.png", originalId: "image", outputId: "image"
    });
    const previews = await extractImageDiffPreviews(original, result.output);
    expect(previews).toHaveLength(1);
    expect(previews[0]).toMatchObject({ originalPath: "BinData/photo.tiff", outputPath: "BinData/photo.png" });
  });
  it("composes duplicate ID aliases with a later conversion and collision", async () => {
    const image = bmp();
    const original = await fixture({
      a: { path: "BinData/a.bmp", data: image }, b: { path: "BinData/b.bmp", data: image },
      occupied: { path: "BinData/a.png", data: await png("#abcdef") }
    });
    const result = await optimizeHwpxBufferBalanced(original, {
      actions: ["consolidate-duplicate-images", "convert-bmp-to-png"], allowLarger: true
    });
    expect(result.report.resourceMappings).toContainEqual({
      originalPath: "BinData/b.bmp", outputPath: "BinData/a-opt.png", originalId: "b", outputId: "a"
    });
    const inferred = inferResourceMappings(await readHwpxPackage(original), await readHwpxPackage(result.output));
    expect(inferred).toEqual(expect.arrayContaining(result.report.resourceMappings!));
    const previews = await extractImageDiffPreviews(original, result.output);
    expect(previews.map((pair) => [pair.originalPath, pair.outputPath])).toEqual(expect.arrayContaining([
      ["BinData/a.bmp", "BinData/a-opt.png"], ["BinData/b.bmp", "BinData/a-opt.png"]
    ]));
  });
  it("supports an explicitly selected conversion with no manifest or visible use", async () => {
    const original = await createHwpxFixture({ entries: { "BinData/unused.bmp": bmp() } });
    const result = await optimizeHwpxBufferBalanced(original, { actions: ["convert-bmp-to-png"], allowLarger: true });
    expect(result.report.resourceMappings).toContainEqual({ originalPath: "BinData/unused.bmp", outputPath: "BinData/unused.png" });
    expect(await extractImageDiffPreviews(original, result.output, { resourceMappings: result.report.resourceMappings })).toHaveLength(1);
  });
});
