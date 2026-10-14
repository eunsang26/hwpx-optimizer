import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { optimizeHwpxBufferBalanced } from "../src/optimize.js";
import { readHwpxPackage } from "../src/reader.js";
import { verifyHwpxOutput } from "../src/verifier.js";
import { createHwpxFixture } from "./fixtures.js";

const modes = ["safe", "balanced", "aggressive"] as const;
async function fixture(body: string, reverseManifest = false): Promise<Buffer> {
  const [a, b] = await Promise.all(["#aabbcc", "#aabbcd"].map((background) =>
    sharp({ create: { width: 32, height: 24, channels: 3, background } }).png().toBuffer()));
  return createHwpxFixture({ entries: {
    "Contents/content.hpf": `<opf:package xmlns:opf="http://www.idpf.org/2007/opf"><opf:manifest><opf:item id="a" href="BinData/${reverseManifest ? "b" : "a"}.png" media-type="image/png"/><opf:item id="b" href="BinData/${reverseManifest ? "a" : "b"}.png" media-type="image/png"/></opf:manifest></opf:package>`,
    "Contents/section0.xml": body, "BinData/a.png": a, "BinData/b.png": b
  } });
}

describe("document preservation verification", () => {
  it.each(["Fonts/font.ttf", "Object/embedded.ole"])("rejects changed protected bytes at %s even when unused", async (path) => {
    const original = await createHwpxFixture({ entries: { [path]: Buffer.from("original bytes") } });
    const output = await createHwpxFixture({ entries: { [path]: Buffer.from("changed bytes") } });
    await expect(verifyHwpxOutput(output, { original, mode: "balanced" })).rejects.toThrow(/protected package bytes changed/);
  });
  it.each(modes)("rejects text changes in %s even when all resources remain", async (mode) => {
    const original = await fixture('<root><hp:t> 00123 </hp:t><hc:img binaryItemIDRef="a"/></root>');
    const output = await fixture('<root><hp:t>123</hp:t><hc:img binaryItemIDRef="a"/></root>');
    await expect(verifyHwpxOutput(output, { original, mode })).rejects.toThrow(/document text changed/);
  });
  it.each(modes)("rejects layout changes in %s", async (mode) => {
    const original = await fixture('<root><hp:pic><hp:sz width="7200" height="5400"/><hc:img binaryItemIDRef="a"/></hp:pic></root>');
    const output = await fixture('<root><hp:pic><hp:sz width="7201" height="5400"/><hc:img binaryItemIDRef="a"/></hp:pic></root>');
    await expect(verifyHwpxOutput(output, { original, mode })).rejects.toThrow(/attribute width changed/);
  });
  it.each(modes)("rejects swapped image uses in %s even for visually similar images", async (mode) => {
    const original = await fixture('<root><hc:img binaryItemIDRef="a"/><hc:img binaryItemIDRef="b"/></root>');
    const output = await fixture('<root><hc:img binaryItemIDRef="b"/><hc:img binaryItemIDRef="a"/></root>');
    await expect(verifyHwpxOutput(output, { original, mode })).rejects.toThrow(/resource use changed|image placement changed/);
  });
  it("rejects swapped manifest hrefs even when body IDs are unchanged", async () => {
    const body = '<root><hc:img binaryItemIDRef="a"/><hc:img binaryItemIDRef="b"/></root>';
    await expect(verifyHwpxOutput(await fixture(body, true), {
      original: await fixture(body), mode: "balanced"
    })).rejects.toThrow(/image placement changed/);
  });
  it("accepts structural formatting and attribute-order changes", async () => {
    const original = await fixture('<root>\n <hp:pic width="001" height="002"><hc:img binaryItemIDRef="a"/></hp:pic>\n</root>');
    const output = await fixture('<root><hp:pic height="002" width="001"><hc:img binaryItemIDRef="a" /></hp:pic></root>');
    await expect(verifyHwpxOutput(output, { original, mode: "safe" })).resolves.toBeUndefined();
  });
  it("preserves authored alternative text while removing generated filename and dimension lines", async () => {
    const original = await createHwpxFixture({ entries: {
      "Contents/section0.xml": '<root><hp:shapeComment>그림입니다.\n월별 공급량 그래프\n원본 그림의 이름: private.png\n원본 그림의 크기: 가로 32pixel, 세로 24pixel</hp:shapeComment></root>'
    } });
    const result = await optimizeHwpxBufferBalanced(original, { actions: ["clean-shape-comment"], allowLarger: true });
    const pkg = await readHwpxPackage(result.output);
    const text = pkg.entries.find((entry) => entry.path === "Contents/section0.xml")!.data.toString();
    expect(text).toContain("월별 공급량 그래프");
    expect(text).not.toContain("private.png");
    const malicious = await createHwpxFixture({ entries: {
      "Contents/section0.xml": '<root><hp:shapeComment>그림입니다.</hp:shapeComment></root>'
    } });
    await expect(verifyHwpxOutput(malicious, { original, mode: "balanced" })).rejects.toThrow(/document text changed/);
  });
  it("does not rewrite style IDs that collide with duplicate image IDs", async () => {
    const image = await sharp({ create: { width: 32, height: 24, channels: 3, background: "#123456" } }).png().toBuffer();
    const original = await createHwpxFixture({ entries: {
      "Contents/content.hpf": '<opf:package xmlns:opf="http://www.idpf.org/2007/opf"><opf:manifest><opf:item id="1" href="BinData/a.png"/><opf:item id="2" href="BinData/b.png"/></opf:manifest></opf:package>',
      "Contents/section0.xml": '<root><hp:run charPrIDRef="2"><hp:t>내용</hp:t></hp:run><hc:img binaryItemIDRef="1"/><hc:img binaryItemIDRef="2"/></root>',
      "BinData/a.png": image, "BinData/b.png": image
    } });
    const result = await optimizeHwpxBufferBalanced(original, { allowLarger: true });
    const pkg = await readHwpxPackage(result.output);
    expect(pkg.entries.find((entry) => entry.path === "Contents/section0.xml")!.data.toString()).toContain('charPrIDRef="2"');
    expect(pkg.entries.some((entry) => entry.path === "BinData/b.png")).toBe(true);
    expect(result.report.actions.applied.some((action) => action.type === "consolidate-duplicate-images")).toBe(false);
  });
  it("rejects safe orientation metadata changes even for a uniform symmetric image", async () => {
    const originalImage = await sharp({ create: { width: 32, height: 24, channels: 3, background: "#123456" } })
      .jpeg().withMetadata({ orientation: 3 }).withIccProfile("srgb", { attach: false }).toBuffer();
    const outputImage = await sharp(originalImage).jpeg().toBuffer();
    const entries = { "Contents/section0.xml": '<root><img href="BinData/a.jpg"/></root>' };
    const original = await createHwpxFixture({ entries: { ...entries, "BinData/a.jpg": originalImage } });
    const output = await createHwpxFixture({ entries: { ...entries, "BinData/a.jpg": outputImage } });
    await expect(verifyHwpxOutput(output, { original, mode: "safe" })).rejects.toThrow(/orientation changed/);
  });
  it("accepts faithful advanced orientation baking with the displayed axes", async () => {
    const image = await sharp({ create: { width: 320, height: 240, channels: 3, background: "#123456" } })
      .jpeg({ quality: 98 }).withMetadata({ orientation: 6 }).withIccProfile("srgb", { attach: false }).toBuffer();
    const original = await createHwpxFixture({ entries: {
      "Contents/section0.xml": '<root><img href="BinData/photo.jpg"/></root>', "BinData/photo.jpg": image
    } });
    const rotated = await sharp(image).rotate().jpeg({ quality: 95 }).toBuffer();
    const output = await createHwpxFixture({ entries: {
      "Contents/section0.xml": '<root><img href="BinData/photo.jpg"/></root>', "BinData/photo.jpg": rotated
    } });
    await expect(verifyHwpxOutput(output, { original, mode: "balanced" })).resolves.toBeUndefined();
  });
  it("allows exact-byte consolidation of images whose representation must be preserved", async () => {
    const image = await sharp({ create: { width: 32, height: 24, channels: 3, background: "#123456" } })
      .png().withIccProfile("srgb").toBuffer();
    const original = await createHwpxFixture({ entries: {
      "Contents/content.hpf": '<opf:package xmlns:opf="http://www.idpf.org/2007/opf"><opf:manifest><opf:item id="a" href="BinData/a.png"/><opf:item id="b" href="BinData/b.png"/></opf:manifest></opf:package>',
      "Contents/section0.xml": '<root><hc:img binaryItemIDRef="a"/><hc:img binaryItemIDRef="b"/></root>',
      "BinData/a.png": image, "BinData/b.png": image
    } });
    const result = await optimizeHwpxBufferBalanced(original, { allowLarger: true });
    const pkg = await readHwpxPackage(result.output);
    expect(pkg.entries.filter((entry) => entry.kind === "image")).toHaveLength(1);
    expect(pkg.entries.find((entry) => entry.kind === "image")!.data).toEqual(image);
  });
});
