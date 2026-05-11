import { describe, expect, it } from "vitest";
import { extractManifestItems } from "../src/manifest.js";

describe("extractManifestItems", () => {
  it("returns items with id and href across namespace prefixes", () => {
    const xml = `<opf:package xmlns:opf="http://www.idpf.org/2007/opf"><opf:manifest>
      <opf:item id="image1" href="BinData/a.png" media-type="image/png"/>
      <opf:item id="image2" href="BinData/b.jpg" media-type="image/jpeg"/>
    </opf:manifest></opf:package>`;
    const items = extractManifestItems(xml);
    expect(items).toEqual([
      { id: "image1", href: "BinData/a.png" },
      { id: "image2", href: "BinData/b.jpg" }
    ]);
  });

  it("ignores tags that are not <item>", () => {
    const xml = `<root><other id="x" href="y"/><item id="ok" href="BinData/ok.png"/></root>`;
    expect(extractManifestItems(xml)).toEqual([{ id: "ok", href: "BinData/ok.png" }]);
  });

  it("supports both quote styles in attributes", () => {
    const xml = `<root><item id='single' href="BinData/a.png"/><item id="double" href='BinData/b.png'/></root>`;
    expect(extractManifestItems(xml)).toEqual([
      { id: "single", href: "BinData/a.png" },
      { id: "double", href: "BinData/b.png" }
    ]);
  });

  it("decodes XML entities in attribute values", () => {
    // fast-xml-parser decodes &amp;, &quot;, etc. inside attribute values; the
    // legacy regex parser used to fail this case.
    const xml = `<root><item id="amp" href="BinData/a&amp;b.png"/></root>`;
    expect(extractManifestItems(xml)).toEqual([
      { id: "amp", href: "BinData/a&b.png" }
    ]);
  });

  it("returns an empty array on malformed XML instead of throwing", () => {
    expect(extractManifestItems("<<<not xml")).toEqual([]);
  });
});
