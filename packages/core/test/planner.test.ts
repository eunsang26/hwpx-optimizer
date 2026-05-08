import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { analyzeHwpxPackage } from "../src/analyzer.js";
import { createSafeOptimizationPlan } from "../src/planner.js";
import { buildReferenceGraph } from "../src/referenceGraph.js";
import { readHwpxPackage } from "../src/reader.js";
import { createHwpxFixture } from "./fixtures.js";

describe("createSafeOptimizationPlan", () => {
  it("plans XML minify, ZIP repack, and unreferenced BinData removal", async () => {
    const fixture = await createHwpxFixture({
      entries: {
        "Contents/section0.xml": '<root><img href="BinData/used.png" /></root>',
        "BinData/used.png": Buffer.from("used"),
        "BinData/unused.bin": Buffer.from("unused")
      }
    });
    const pkg = await readHwpxPackage(fixture);
    const analysis = await analyzeHwpxPackage(pkg);
    const graph = buildReferenceGraph(pkg);

    const plan = createSafeOptimizationPlan({ pkg, analysis, graph });

    expect(plan.actions.map((action) => action.type)).toEqual([
      "minify-xml",
      "minify-xml",
      "optimize-png",
      "remove-unused",
      "repack-zip"
    ]);
    expect(plan.actions).not.toContainEqual(expect.objectContaining({ type: "convert-bmp" }));
  });

  it("does not remove unreferenced non-BinData package images in safe mode", async () => {
    const fixture = await createHwpxFixture({
      entries: {
        "Contents/section0.xml": "<root />",
        "Preview/PrvImage.png": Buffer.from("preview")
      }
    });
    const pkg = await readHwpxPackage(fixture);
    const analysis = await analyzeHwpxPackage(pkg);
    const graph = buildReferenceGraph(pkg);

    const plan = createSafeOptimizationPlan({ pkg, analysis, graph });

    expect(plan.actions).not.toContainEqual(
      expect.objectContaining({ type: "remove-unused", target: "Preview/PrvImage.png" })
    );
  });

  it("plans lossless PNG optimization in safe mode", async () => {
    const png = await sharp({
      create: {
        width: 80,
        height: 80,
        channels: 4,
        background: { r: 40, g: 120, b: 200, alpha: 1 }
      }
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    const fixture = await createHwpxFixture({
      entries: {
        "Contents/section0.xml": '<root><img href="BinData/image1.png" /></root>',
        "BinData/image1.png": png
      }
    });
    const pkg = await readHwpxPackage(fixture);
    const analysis = await analyzeHwpxPackage(pkg);
    const graph = buildReferenceGraph(pkg);

    const plan = createSafeOptimizationPlan({ pkg, analysis, graph });

    expect(plan.actions).toContainEqual(
      expect.objectContaining({ type: "optimize-png", target: "BinData/image1.png", risk: "safe" })
    );
  });
});
