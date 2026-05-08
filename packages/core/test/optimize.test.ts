import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { analyzeHwpxBuffer, optimizeHwpxBufferSafe } from "../src/optimize.js";
import { readHwpxPackage } from "../src/reader.js";
import { createHwpxFixture } from "./fixtures.js";

describe("optimizeHwpxBufferSafe", () => {
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
});
