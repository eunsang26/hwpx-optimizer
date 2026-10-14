import { describe, expect, it } from "vitest";
import { XMLParser } from "fast-xml-parser";
import { minifyXmlBuffer } from "../src/xmlMinify.js";
import { analyzeHwpxBuffer, optimizeHwpxBufferSafe, optimizeHwpxBufferBalanced, optimizeHwpxBufferAggressive } from "../src/optimize.js";
import { readHwpxPackage } from "../src/reader.js";
import { createHwpxFixture } from "./fixtures.js";

const literalParser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, trimValues: false });
const textXml = '<hp:t> A </hp:t><hp:t>00123</hp:t><hp:t> </hp:t><hp:t>1.20</hp:t><hp:t>1e03</hp:t><hp:t>A &amp; B</hp:t>';

describe("XML document preservation", () => {
  it("keeps text and attribute values literal while removing structural indentation", () => {
    const input = `<root version="001">\n  ${textXml}\n</root>`;
    const output = minifyXmlBuffer(Buffer.from(input)).toString();
    expect(output).toBe(`<root version="001">${textXml}</root>`);
    expect(literalParser.parse(output).root["hp:t"]).toEqual([" A ", "00123", " ", "1.20", "1e03", "A & B"]);
  });

  it("preserves whitespace-only text, mixed content, comments and CDATA", () => {
    const input = '<root><hp:t> <b>001</b> </hp:t><custom> <child/> </custom><hp:t><![CDATA[ 001 & <b> ]]></hp:t><!-- note --></root>';
    const output = minifyXmlBuffer(Buffer.from(input)).toString();
    expect(output).toContain('<hp:t> <b>001</b> </hp:t>');
    expect(output).toContain('<custom> <child></child> </custom>');
    expect(output).toContain('<![CDATA[ 001 & <b> ]]>');
    expect(output).toContain('<!-- note -->');
  });

  it("preserves unfamiliar mixed-content p elements", () => {
    expect(minifyXmlBuffer(Buffer.from('<p> <span> A </span> </p>')).toString())
      .toBe('<p> <span> A </span> </p>');
  });

  it("honors inherited xml:space preservation", () => {
    const input = '<root xml:space="preserve">\n <hp:p> <hp:run><hp:t> </hp:t></hp:run> </hp:p>\n</root>';
    expect(minifyXmlBuffer(Buffer.from(input)).toString()).toBe(input);
  });

  it("keeps whitespace in foreign namespaces and nested text content", () => {
    const input = '<root xmlns:hp="urn:foreign"><hp:p> <hp:run><hp:t> </hp:t></hp:run> </hp:p></root>';
    expect(minifyXmlBuffer(Buffer.from(input)).toString()).toBe(input);
    const nested = '<root><hp:t> <hp:run> <hp:t> A </hp:t> </hp:run> </hp:t></root>';
    expect(minifyXmlBuffer(Buffer.from(nested)).toString()).toBe(nested);
  });

  it("preserves entity-decoded text and attribute whitespace", () => {
    const input = '<root value=" 00123 "><hp:t>&#x20;00123&#32;</hp:t></root>';
    const output = minifyXmlBuffer(Buffer.from(input)).toString();
    expect(literalParser.parse(output).root).toEqual({ "hp:t": " 00123 ", "@_value": " 00123 " });
  });

  it("does not decode an escaped character reference twice", () => {
    const input = '<root><hp:t>&amp;#32;</hp:t></root>';
    expect(minifyXmlBuffer(Buffer.from(input)).toString()).toBe(input);
  });

  it.each([
    ["safe", optimizeHwpxBufferSafe],
    ["balanced", optimizeHwpxBufferBalanced],
    ["aggressive", optimizeHwpxBufferAggressive]
  ] as const)("%s final output preserves document text", async (_mode, optimize) => {
    const input = await createHwpxFixture({ entries: {
      "Contents/section0.xml": `<root>\n  ${textXml}\n</root>`,
      "BinData/unused.bin": Buffer.alloc(8192, 7)
    } });
    const result = await optimize(input);
    const output = await readHwpxPackage(result.output);
    const xml = output.entries.find((entry) => entry.path === "Contents/section0.xml")!.data.toString();
    expect(literalParser.parse(xml).root["hp:t"]).toEqual([" A ", "00123", " ", "1.20", "1e03", "A & B"]);
    expect(result.report.actions.applied).toContainEqual(expect.objectContaining({ type: "minify-xml" }));
  });

  it.each([
    ["balanced", optimizeHwpxBufferBalanced],
    ["aggressive", optimizeHwpxBufferAggressive]
  ] as const)("%s reference rewrites preserve text even without XML minification", async (_mode, optimize) => {
    const bmp = createBmp();
    const input = await createHwpxFixture({ entries: {
      "Contents/content.hpf": '<package><manifest><item id="image1" href="BinData/image1.bmp" media-type="image/bmp"/></manifest></package>',
      "Contents/section0.xml": `<root>${textXml}<img binaryItemIDRef="image1" href="BinData/image1.bmp"/></root>`,
      "BinData/image1.bmp": bmp
    } });
    const result = await optimize(input, { actions: ["convert-bmp-to-png"], allowLarger: true });
    const output = await readHwpxPackage(result.output);
    const xml = output.entries.find((entry) => entry.path === "Contents/section0.xml")!.data.toString();
    expect(xml).toContain('href="BinData/image1.png"');
    expect(literalParser.parse(xml).root["hp:t"]).toEqual([" A ", "00123", " ", "1.20", "1e03", "A & B"]);
  });

  it.each([
    ["analyze", analyzeHwpxBuffer],
    ["safe", optimizeHwpxBufferSafe],
    ["balanced", optimizeHwpxBufferBalanced],
    ["aggressive", optimizeHwpxBufferAggressive]
  ] as const)("%s rejects malformed input XML before it can be rewritten", async (_mode, process) => {
    const input = await createHwpxFixture({ entries: {
      "Contents/section0.xml": '<root><hp:t>00123</root>',
      "BinData/unused.bin": Buffer.alloc(8192)
    } });
    await expect(process(input)).rejects.toThrow(/XML is not well-formed at Contents\/section0.xml/);
  });

  it("rejects malformed XML in the direct rewrite API", () => {
    expect(() => minifyXmlBuffer(Buffer.from('<root><t>001</root>'))).toThrow(/XML is not well-formed/);
  });
});

function createBmp(): Buffer {
  const width = 64, height = 48;
  const data = Buffer.alloc(54 + width * height * 3);
  data.write("BM");
  data.writeUInt32LE(data.length, 2);
  data.writeUInt32LE(54, 10);
  data.writeUInt32LE(40, 14);
  data.writeInt32LE(width, 18);
  data.writeInt32LE(height, 22);
  data.writeUInt16LE(1, 26);
  data.writeUInt16LE(24, 28);
  data.fill(90, 54);
  return data;
}
