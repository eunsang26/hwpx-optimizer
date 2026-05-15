import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { analyzeHwpxBuffer, optimizeHwpxBufferBalanced, optimizeHwpxBufferSafe } from "../src/optimize.js";
import { readHwpxPackage } from "../src/reader.js";
import { createHwpxFixture } from "./fixtures.js";

describe("optimizeHwpxBufferSafe", () => {
  it("records a missed target without over-compressing or mutating the original result", async () => {
    const input = await createHwpxFixture({
      entries: {
        "Contents/section0.xml": "<root />"
      }
    });

    const result = await optimizeHwpxBufferSafe(input, { targetBytes: 1 });

    expect(result.output).toEqual(input);
    expect(result.report.targetBytes).toBe(1);
    expect(result.report.targetStatus).toBe("missed");
    expect(result.report.targetMissReason).toContain("quality-preserving");
  });

  it("rejects invalid core target sizes", async () => {
    const input = await createHwpxFixture({
      entries: {
        "Contents/section0.xml": "<root />"
      }
    });

    await expect(analyzeHwpxBuffer(input, { targetBytes: 0 })).rejects.toThrow(/targetBytes must be a positive number/);
    await expect(optimizeHwpxBufferBalanced(input, { targetBytes: -1 })).rejects.toThrow(
      /targetBytes must be a positive number/
    );
  });

  it("carries target status through balanced optimization", async () => {
    const input = await createHwpxFixture({
      entries: {
        "Contents/section0.xml": "<root />"
      }
    });

    const result = await optimizeHwpxBufferBalanced(input, { targetBytes: input.byteLength * 2 });

    expect(result.report.targetBytes).toBe(input.byteLength * 2);
    expect(result.report.targetStatus).toBe("already-under-target");
  });

  it("reports per-image progress during advanced image transforms", async () => {
    const input = await createHwpxFixture({
      entries: {
        "Contents/content.hpf": `<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest><opf:item id="image1" href="BinData/image1.bmp" media-type="image/bmp"/><opf:item id="image2" href="BinData/image2.bmp" media-type="image/bmp"/></opf:manifest></opf:package>`,
        "Contents/section0.xml": `<root><hc:img binaryItemIDRef="image1" /><hc:img binaryItemIDRef="image2" /></root>`,
        "BinData/image1.bmp": createBmp24(400, 300),
        "BinData/image2.bmp": createBmp24(320, 240)
      }
    });
    const progress: Array<{ percent: number; item: string }> = [];

    await optimizeHwpxBufferBalanced(input, {
      allowLarger: true,
      onProgress: (item) => progress.push(item)
    });

    expect(progress.map((item) => item.item)).toContain("Transforming images 1/2");
    expect(progress.map((item) => item.item)).toContain("Transforming images 2/2");
    expect(progress.at(-1)).toEqual({ percent: 82, item: "Verifying optimized document" });
  });

  it("uses target-aware JPEG recompression candidates when ordinary balanced resizing is not applicable", async () => {
    const width = 640;
    const height = 480;
    const raw = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 3;
        raw[offset] = x % 256;
        raw[offset + 1] = y % 256;
        raw[offset + 2] = (x + y) % 256;
      }
    }
    const jpeg = await sharp(raw, { raw: { width, height, channels: 3 } })
      .jpeg({ quality: 100 })
      .toBuffer();
    const input = await createHwpxFixture({
      entries: {
        "Contents/content.hpf": `<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest><opf:item id="image1" href="BinData/image1.jpg" media-type="image/jpeg"/></opf:manifest></opf:package>`,
        "Contents/section0.xml": `<root><hc:img binaryItemIDRef="image1" /></root>`,
        "BinData/image1.jpg": jpeg
      }
    });

    const withoutTarget = await optimizeHwpxBufferBalanced(input, { actions: ["resize-jpeg"] });
    const withTarget = await optimizeHwpxBufferBalanced(input, {
      actions: ["resize-jpeg"],
      targetBytes: input.byteLength - 100
    });

    expect(withoutTarget.report.actions.applied).not.toContainEqual(expect.objectContaining({ type: "resize-jpeg" }));
    expect(withTarget.report.actions.applied).toContainEqual(expect.objectContaining({ type: "resize-jpeg" }));
    expect(withTarget.output.byteLength).toBeLessThan(input.byteLength);
  });

  it("keeps progress monotonic across target profile retries", async () => {
    const jpeg = await sharp({
      create: { width: 640, height: 480, channels: 3, background: "#99aabb" }
    })
      .jpeg({ quality: 100 })
      .toBuffer();
    const input = await createHwpxFixture({
      entries: {
        "Contents/content.hpf": `<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest><opf:item id="image1" href="BinData/image1.jpg" media-type="image/jpeg"/></opf:manifest></opf:package>`,
        "Contents/section0.xml": `<root><hc:img binaryItemIDRef="image1" /></root>`,
        "BinData/image1.jpg": jpeg
      }
    });
    const progress: Array<{ percent: number; item: string }> = [];

    await optimizeHwpxBufferBalanced(input, {
      targetBytes: 1,
      onProgress: (item) => progress.push(item)
    });

    for (let index = 1; index < progress.length; index += 1) {
      expect(progress[index]!.percent).toBeGreaterThanOrEqual(progress[index - 1]!.percent);
    }
  });

  it("does not run weaker target profiles after the strongest verified candidate still misses", async () => {
    const jpeg = await sharp({
      create: { width: 640, height: 480, channels: 3, background: "#99aabb" }
    })
      .jpeg({ quality: 100 })
      .toBuffer();
    const input = await createHwpxFixture({
      entries: {
        "Contents/content.hpf": `<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest><opf:item id="image1" href="BinData/image1.jpg" media-type="image/jpeg"/></opf:manifest></opf:package>`,
        "Contents/section0.xml": `<root><hc:img binaryItemIDRef="image1" /></root>`,
        "BinData/image1.jpg": jpeg
      }
    });

    const result = await optimizeHwpxBufferBalanced(input, { targetBytes: 1 });
    const opportunityPasses = result.report.performance?.stages.filter((stage) => stage.name === "opportunities").length;

    expect(result.report.targetStatus).toBe("missed");
    expect(opportunityPasses).toBe(1);
  });

  it("removes unreferenced BinData and writes a verified package", async () => {
    const input = await createHwpxFixture({
      entries: {
        "Contents/section0.xml": '<root> <img href="BinData/used.bin" /> </root>',
        "BinData/used.bin": Buffer.from("used"),
        "BinData/unused.bin": Buffer.from("unused")
      }
    });

    const result = await optimizeHwpxBufferSafe(input);
    const output = await readHwpxPackage(result.output);

    expect(result.report.originalSize).toBe(input.byteLength);
    expect(result.report.optimizedSize).toBeLessThanOrEqual(result.report.originalSize);
    expect(output.entries.map((entry) => entry.path).sort()).toEqual([
      "BinData/used.bin",
      "Contents/content.hpf",
      "Contents/section0.xml"
    ]);
    expect(result.report.actions.applied).toContainEqual(
      expect.objectContaining({ type: "remove-unused", target: "BinData/unused.bin" })
    );
  });

  it("analyzes without optimizing", async () => {
    const input = await createHwpxFixture({
      entries: {
        "Contents/section0.xml": "<root />"
      }
    });

    const report = await analyzeHwpxBuffer(input);

    expect(report.originalSize).toBeGreaterThan(0);
    expect(report.images).toEqual([]);
  });

  it("records local performance timings in analysis reports", async () => {
    const input = await createHwpxFixture({
      entries: {
        "Contents/section0.xml": "<root />"
      }
    });

    const report = await analyzeHwpxBuffer(input, { analysisMode: "quick" });

    expect(report.performance?.totalMs).toBeGreaterThanOrEqual(0);
    expect(report.performance?.stages.map((stage) => stage.name)).toEqual([
      "read",
      "analyze",
      "opportunities",
      "report"
    ]);
  });

  it("records local performance timings in optimization reports", async () => {
    const input = await createHwpxFixture({
      entries: {
        "Contents/section0.xml": '<root> <img href="BinData/used.bin" /> </root>',
        "BinData/used.bin": Buffer.from("used"),
        "BinData/unused.bin": Buffer.from("unused")
      }
    });

    const result = await optimizeHwpxBufferSafe(input);

    expect(result.report.performance?.totalMs).toBeGreaterThanOrEqual(0);
    expect(result.report.performance?.stages.map((stage) => stage.name)).toEqual(
      expect.arrayContaining(["read", "analyze", "plan", "apply", "write", "verify", "report"])
    );
  });

  it("preserves EXIF orientation while stripping JPEG metadata in safe mode", async () => {
    const baseline = await sharp({
      create: { width: 320, height: 240, channels: 3, background: "#445566" }
    })
      .jpeg({ quality: 95 })
      .toBuffer();
    const tagged = await sharp(baseline)
      .withMetadata({ orientation: 6 })
      .jpeg({ quality: 95 })
      .toBuffer();
    const input = await createHwpxFixture({
      entries: {
        "Contents/content.hpf": '<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest><opf:item id="image1" href="BinData/image1.jpg" media-type="image/jpeg"/></opf:manifest></opf:package>',
        "Contents/section0.xml": '<root><hc:img binaryItemIDRef="image1" /></root>',
        "BinData/image1.jpg": tagged
      }
    });

    const result = await optimizeHwpxBufferSafe(input);
    const output = await readHwpxPackage(result.output);
    const image = output.entries.find((entry) => entry.path === "BinData/image1.jpg");
    const metadata = await sharp(image?.data).metadata();

    expect(metadata.orientation).toBe(6);
  });

  it("does not compute advanced resize opportunities while optimizing in safe mode", async () => {
    const jpg = await sharp({
      create: {
        width: 2400,
        height: 1800,
        channels: 3,
        background: "#88aacc"
      }
    })
      .jpeg({ quality: 95 })
      .toBuffer();
    const input = await createHwpxFixture({
      entries: {
        "Contents/content.hpf": `<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest><opf:item id="image1" href="BinData/image1.JPG" media-type="image/jpg"/></opf:manifest></opf:package>`,
        "Contents/section0.xml": `<root><hc:img binaryItemIDRef="image1" /></root>`,
        "BinData/image1.JPG": jpg
      }
    });

    const analysis = await analyzeHwpxBuffer(input);
    const result = await optimizeHwpxBufferSafe(input);

    expect(analysis.opportunities).toContainEqual(expect.objectContaining({ action: "resize-jpeg" }));
    expect(result.report.opportunities).not.toContainEqual(expect.objectContaining({ action: "resize-jpeg" }));
    expect(result.report.opportunities.every((opportunity) => opportunity.risk === "safe")).toBe(true);
  });

  it("surfaces safe-mode optimizer failures in report.warnings", async () => {
    // A file with a .png extension whose bytes are not a real PNG triggers a
    // sharp failure inside applySafeOptimizationPlan. The previous behaviour
    // swallowed the error; now it must reach report.warnings so users can see
    // why the optimization did not shrink that image.
    const input = await createHwpxFixture({
      entries: {
        "Contents/section0.xml": '<root><img href="BinData/broken.png" /></root>',
        "BinData/broken.png": Buffer.from("not actually a png")
      }
    });

    const result = await optimizeHwpxBufferSafe(input);

    expect(result.report.warnings.some((warning) => warning.includes("BinData/broken.png"))).toBe(
      true
    );
  });
});

function createBmp24(width: number, height: number): Buffer {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelDataSize = rowSize * height;
  const fileSize = 54 + pixelDataSize;
  const buffer = Buffer.alloc(fileSize);
  buffer.write("BM", 0, "ascii");
  buffer.writeUInt32LE(fileSize, 2);
  buffer.writeUInt32LE(54, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(pixelDataSize, 34);
  return buffer;
}
