import { describe, expect, it } from "vitest";
import { buildReferenceGraph } from "../src/referenceGraph.js";
import { readHwpxPackage } from "../src/reader.js";
import { createHwpxFixture } from "./fixtures.js";

describe("buildReferenceGraph", () => {
  it("marks BinData files referenced by XML text", async () => {
    const fixture = await createHwpxFixture({
      entries: {
        "Contents/section0.xml": '<root><img href="BinData/image1.png" /></root>',
        "BinData/image1.png": Buffer.from("used"),
        "BinData/image2.png": Buffer.from("unused")
      }
    });

    const pkg = await readHwpxPackage(fixture);
    const graph = buildReferenceGraph(pkg);

    expect(graph.resources.get("BinData/image1.png")?.referenced).toBe(true);
    expect(graph.resources.get("BinData/image2.png")?.referenced).toBe(false);
  });
});
