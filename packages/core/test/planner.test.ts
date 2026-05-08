import { describe, expect, it } from "vitest";
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

    expect(plan.actions.map((action) => action.type)).toEqual(["minify-xml", "remove-unused", "repack-zip"]);
    expect(plan.actions).not.toContainEqual(expect.objectContaining({ type: "convert-bmp" }));
  });
});
