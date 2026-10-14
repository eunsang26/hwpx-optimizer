import { describe, expect, it } from "vitest";
import { analyzeHwpxBuffer, optimizeHwpxBufferSafe } from "../src/optimize.js";
import { readHwpxPackage } from "../src/reader.js";
import { buildReferenceGraph } from "../src/referenceGraph.js";
import { verifyHwpxOutput } from "../src/verifier.js";
import { createHwpxFixture } from "./fixtures.js";

function manifest(items: string): string {
  return `<opf:package xmlns:opf="http://www.idpf.org/2007/opf"><opf:manifest>${items}</opf:manifest></opf:package>`;
}

describe("package resource reference validation", () => {
  it.each(["binaryItemIDRef", "hc:binaryItemIDRef"])("rejects an undeclared %s", async (attribute) => {
    const input = await createHwpxFixture({ entries: {
      "Contents/section0.xml": `<root><hc:img ${attribute}="missing"/></root>`
    } });
    expect((await analyzeHwpxBuffer(input)).warnings.join(" ")).toContain("binaryItemIDRef missing");
    await expect(verifyHwpxOutput(input)).rejects.toThrow(/binaryItemIDRef missing/);
    await expect(optimizeHwpxBufferSafe(input)).rejects.toThrow(/binaryItemIDRef missing/);
  });
  it.each(["BinData/missing.bin", "../Fonts/missing.ttf", "section1.xml", "../../outside.bin"])
  ("rejects a dangling local manifest href %s even when unused", async (href) => {
    const input = await createHwpxFixture({ entries: {
      "Contents/content.hpf": manifest(`<opf:item id="missing" href="${href}"/>`)
    } });
    await expect(verifyHwpxOutput(input)).rejects.toThrow(/manifest/);
  });
  it("does not interpret undeclared style and paragraph IDs as missing binary IDs", async () => {
    const input = await createHwpxFixture({ entries: {
      "Contents/section0.xml": '<root><hp:p paraPrIDRef="001"><hp:run charPrIDRef="001" styleIDRef="99"/></hp:p></root>'
    } });
    await expect(verifyHwpxOutput(input)).resolves.toBeUndefined();
  });
  it("rejects duplicate resource declarations and ignores a body item masquerading as manifest", async () => {
    const input = await createHwpxFixture({ entries: {
      "Contents/content.hpf": manifest('<opf:item id="001" href="BinData/a.bin"/><opf:item id="001" href="BinData/b.bin"/>'),
      "Contents/section0.xml": '<root><item id="undeclared" href="BinData/a.bin"/><hc:img binaryItemIDRef="undeclared"/></root>',
      "BinData/a.bin": Buffer.from("a"), "BinData/b.bin": Buffer.from("b")
    } });
    const graph = buildReferenceGraph(await readHwpxPackage(input));
    expect(graph.missingReferences).toContain("duplicate manifest ID 001");
    expect(graph.missingReferences).toContain("binaryItemIDRef undeclared at Contents/section0.xml");
  });
  it("resolves numeric character references and encoded filenames without raw XML false positives", async () => {
    const input = await createHwpxFixture({ entries: {
      "Contents/content.hpf": manifest('<opf:item id="001" href="../BinData/a%23b.bin"/>'),
      "Contents/section0.xml": '<root><img href="BinData/im&#97;ge.bin"/><hc:img binaryItemIDRef="&#48;01"/></root>',
      "BinData/image.bin": Buffer.from("image"), "BinData/a#b.bin": Buffer.from("hash filename")
    } });
    const graph = buildReferenceGraph(await readHwpxPackage(input));
    expect(graph.missingReferences).toEqual([]);
    expect(graph.resources.get("BinData/a#b.bin")?.referenced).toBe(true);
    expect(graph.resources.get("BinData/image.bin")?.referenced).toBe(true);
    await expect(verifyHwpxOutput(input)).resolves.toBeUndefined();
  });
  it("does not decode XML entities twice in literal resource filenames", async () => {
    const input = await createHwpxFixture({ entries: {
      "Contents/content.hpf": manifest('<opf:item id="amp" href="BinData/a&amp;amp;b.bin"/>'),
      "Contents/section0.xml": '<root><img href="BinData/a&amp;amp;b.bin"/></root>',
      "BinData/a&amp;b.bin": Buffer.from("literal amp entity filename")
    } });
    const graph = buildReferenceGraph(await readHwpxPackage(input));
    expect(graph.missingReferences).toEqual([]);
    expect(graph.resources.get("BinData/a&amp;b.bin")?.referenced).toBe(true);
  });
  it("removes only deleted-resource declarations when safe output deletes unused BinData", async () => {
    const input = await createHwpxFixture({ entries: {
      "Contents/content.hpf": manifest('<opf:item id="used" href="BinData/used.bin"/><opf:item id="unused" href="../BinData/unused.bin"/><opf:item id="font" href="../Fonts/font.ttf"/>'),
      "Contents/section0.xml": '<root><hc:img binaryItemIDRef="used"/></root>',
      "BinData/used.bin": Buffer.from("used"), "BinData/unused.bin": Buffer.from("unused"),
      "Fonts/font.ttf": Buffer.from("font")
    } });
    const result = await optimizeHwpxBufferSafe(input);
    const pkg = await readHwpxPackage(result.output);
    expect(pkg.entries.some((entry) => entry.path === "BinData/unused.bin")).toBe(false);
    const text = pkg.entries.find((entry) => entry.path === "Contents/content.hpf")!.data.toString();
    expect(text).not.toContain('id="unused"');
    expect(text).toContain('id="used"');
    expect(text).toContain('id="font"');
    await expect(verifyHwpxOutput(result.output)).resolves.toBeUndefined();
  });
});
