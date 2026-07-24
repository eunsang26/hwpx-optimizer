import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readHwpxPackage, writeHwpxPackage } from "@hwpx-optimizer/core";
import { repackWithImageBytes } from "../src/packageBytes.js";

async function buildDuplicatePngHwpx(): Promise<Buffer> {
  const png = await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 10, g: 20, b: 30 } }
  })
    .png()
    .toBuffer();

  const entries = [
    { path: "mimetype", data: Buffer.from("application/hwp+zip"), size: 17, kind: "other" as const },
    {
      path: "Contents/content.hpf",
      data: Buffer.from(
        `<opf:package xmlns:opf="http://www.idpf.org/2007/opf"><opf:manifest>` +
          `<opf:item id="logo1" href="BinData/logo1.png" media-type="image/png" isEmbeded="1"/>` +
          `<opf:item id="logo2" href="BinData/logo2.png" media-type="image/png" isEmbeded="1"/>` +
          `</opf:manifest></opf:package>`
      ),
      size: 0,
      kind: "xml" as const
    },
    {
      path: "Contents/section0.xml",
      data: Buffer.from(
        `<root>` +
          `<hp:pic><hp:sz width="1600" height="900"/><hc:img binaryItemIDRef="logo1"/></hp:pic>` +
          `<hp:pic><hp:sz width="1600" height="900"/><hc:img binaryItemIDRef="logo2"/></hp:pic>` +
          `</root>`
      ),
      size: 0,
      kind: "xml" as const
    },
    { path: "BinData/logo1.png", data: png, size: png.byteLength, kind: "image" as const },
    { path: "BinData/logo2.png", data: png, size: png.byteLength, kind: "image" as const }
  ].map((entry) => ({ ...entry, size: entry.data.byteLength }));

  return writeHwpxPackage({ entries });
}

describe("repackWithImageBytes", () => {
  it("collapses byte-identical image entries and remains readable", async () => {
    const original = await buildDuplicatePngHwpx();
    const withoutCollapse = await repackWithImageBytes(original, new Map(), {
      collapseByteIdentical: false
    });
    const withCollapse = await repackWithImageBytes(original, new Map(), {
      collapseByteIdentical: true
    });

    expect(withCollapse.byteLength).toBeLessThan(withoutCollapse.byteLength);

    const pkg = await readHwpxPackage(withCollapse);
    const images = pkg.entries.filter((entry) => entry.kind === "image");
    expect(images).toHaveLength(1);

    const manifest = pkg.entries.find((entry) => entry.path === "Contents/content.hpf")!;
    const manifestXml = manifest.data.toString("utf8");
    expect(manifestXml).not.toContain("BinData/logo2.png");
    expect(manifestXml).toContain("BinData/logo1.png");
  });

  it("substitutes image bytes at the same path", async () => {
    const fixturePath = join(import.meta.dirname, "../fixtures/photo.hwpx");
    const original = await readFile(fixturePath);
    const pkg = await readHwpxPackage(original);
    const image = pkg.entries.find((entry) => entry.kind === "image")!;
    const smaller = await sharp(image.data).jpeg({ quality: 50, mozjpeg: true }).toBuffer();
    const replacements = new Map([[image.path, smaller]]);
    const repacked = await repackWithImageBytes(original, replacements);
    const next = await readHwpxPackage(repacked);
    const updated = next.entries.find((entry) => entry.path === image.path)!;
    expect(updated.data.byteLength).toBe(smaller.byteLength);
  });
});
