import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { optimizeHwpxBufferAggressive } from "../src/optimize.js";
import { readHwpxPackage } from "../src/reader.js";
import { createHwpxFixture } from "./fixtures.js";

describe("aggressive optimization", () => {
  it("uses a tighter document display size budget than balanced mode", async () => {
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
    const fixture = await createReferencedImageFixtureWithDisplay({
      id: "image1",
      path: "BinData/image1.JPG",
      mediaType: "image/jpg",
      data: jpg,
      widthHwpUnit: 7200,
      heightHwpUnit: 5400
    });

    const result = await optimizeHwpxBufferAggressive(fixture, { allowLarger: true });
    const output = await readHwpxPackage(result.output);
    const image = output.entries.find((entry) => entry.path === "BinData/image1.jpg");
    const metadata = await sharp(image?.data).metadata();

    expect(metadata.width).toBe(96);
    expect(metadata.height).toBe(72);
    expect(result.report.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("Aggressive mode prioritizes file size")])
    );
  });
});

async function createReferencedImageFixtureWithDisplay(input: {
  id: string;
  path: string;
  mediaType: string;
  data: Buffer;
  widthHwpUnit: number;
  heightHwpUnit: number;
}): Promise<Buffer> {
  return createHwpxFixture({
    entries: {
      "Contents/content.hpf": `<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest><opf:item id="${input.id}" href="${input.path}" media-type="${input.mediaType}" isEmbeded="1"/></opf:manifest></opf:package>`,
      "Contents/section0.xml": `<root><hp:pic><hc:img binaryItemIDRef="${input.id}" /><hp:sz width="${input.widthHwpUnit}" widthRelTo="ABSOLUTE" height="${input.heightHwpUnit}" heightRelTo="ABSOLUTE"/></hp:pic></root>`,
      [input.path]: input.data
    }
  });
}
