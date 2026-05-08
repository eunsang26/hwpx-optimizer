import { describe, expect, it } from "vitest";
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

    expect(output.entries.map((entry) => entry.path).sort()).toEqual(["BinData/used.bin", "Contents/section0.xml"]);
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
});
