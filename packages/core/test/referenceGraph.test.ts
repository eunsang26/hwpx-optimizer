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

  it("does not treat content.hpf manifest declarations as visible usage", async () => {
    const fixture = await createHwpxFixture({
      entries: {
        "Contents/content.hpf": `<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest><opf:item id="image1" href="BinData/image1.png" media-type="image/png"/><opf:item id="image2" href="BinData/image2.png" media-type="image/png"/></opf:manifest></opf:package>`,
        "Contents/section0.xml": `<root><hc:img binaryItemIDRef="image1" /></root>`,
        "BinData/image1.png": Buffer.from("used"),
        "BinData/image2.png": Buffer.from("declared but unused")
      }
    });

    const pkg = await readHwpxPackage(fixture);
    const graph = buildReferenceGraph(pkg);

    expect(graph.resources.get("BinData/image1.png")?.referenced).toBe(true);
    expect(graph.resources.get("BinData/image2.png")?.referenced).toBe(false);
  });

  it("resolves relative and percent-encoded manifest hrefs", async () => {
    const fixture = await createHwpxFixture({
      entries: {
        "Contents/content.hpf": `<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest><opf:item id="image1" href="../BinData/image%201.png" media-type="image/png"/></opf:manifest></opf:package>`,
        "Contents/section0.xml": `<root><hc:img binaryItemIDRef="image1" /></root>`,
        "BinData/image 1.png": Buffer.from("used")
      }
    });

    const pkg = await readHwpxPackage(fixture);
    const graph = buildReferenceGraph(pkg);

    expect(graph.resources.get("BinData/image 1.png")?.referenced).toBe(true);
    expect(graph.missingReferences).toEqual([]);
  });

  it("marks manifest resources referenced by less common id-valued attributes", async () => {
    const fixture = await createHwpxFixture({
      entries: {
        "Contents/content.hpf": `<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest><opf:item id="image1" href="BinData/image1.png" media-type="image/png"/></opf:manifest></opf:package>`,
        "Contents/section0.xml": `<root><hp:customPicture targetRef="image1" /></root>`,
        "BinData/image1.png": Buffer.from("used")
      }
    });

    const pkg = await readHwpxPackage(fixture);
    const graph = buildReferenceGraph(pkg);

    expect(graph.resources.get("BinData/image1.png")?.referenced).toBe(true);
  });

  it("resolves direct relative BinData paths in XML attributes", async () => {
    const fixture = await createHwpxFixture({
      entries: {
        "Contents/section0.xml": `<root><draw:image xlink:href="../BinData/image1.png" /></root>`,
        "BinData/image1.png": Buffer.from("used")
      }
    });

    const pkg = await readHwpxPackage(fixture);
    const graph = buildReferenceGraph(pkg);

    expect(graph.resources.get("BinData/image1.png")?.referenced).toBe(true);
  });

  it("resolves XML-escaped direct package paths through parsed attributes", async () => {
    const fixture = await createHwpxFixture({
      entries: {
        "Contents/section0.xml": `<root><draw:image xlink:href="BinData/image&amp;1.png" /></root>`,
        "BinData/image&1.png": Buffer.from("used")
      }
    });

    const pkg = await readHwpxPackage(fixture);
    const graph = buildReferenceGraph(pkg);

    expect(graph.resources.get("BinData/image&1.png")?.referenced).toBe(true);
    expect(graph.missingReferences).toEqual([]);
  });
});
