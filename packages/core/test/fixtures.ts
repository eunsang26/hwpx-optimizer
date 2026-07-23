import sharp from "sharp";
import { writeHwpxPackage } from "../src/writer.js";

export async function createHwpxFixture(input: {
  entries: Record<string, string | Buffer>;
  includeRequiredFiles?: boolean;
}): Promise<Buffer> {
  const entries =
    input.includeRequiredFiles === false
      ? { mimetype: "application/hwp+zip", ...input.entries }
      : {
          mimetype: "application/hwp+zip",
          "Contents/content.hpf": '<opf:package xmlns:opf="http://www.idpf.org/2007/opf" />',
          "Contents/section0.xml": "<root />",
          ...input.entries
        };

  return writeHwpxPackage({
    entries: Object.entries(entries).map(([path, value]) => {
      const data = Buffer.isBuffer(value) ? value : Buffer.from(value);
      return {
        path,
        data,
        size: data.byteLength,
        kind: path === "mimetype" ? "other" : "xml"
      };
    })
  });
}

export async function createReportLikeHwpxFixture(): Promise<Buffer> {
  const [coverJpeg, chartPng, duplicatedPng] = await Promise.all([
    sharp({
      create: { width: 1600, height: 1200, channels: 3, background: "#90a4c2" }
    })
      .jpeg({ quality: 96 })
      .toBuffer(),
    sharp({
      create: { width: 900, height: 520, channels: 3, background: "#d9e8f8" }
    })
      .png()
      .toBuffer(),
    sharp({
      create: { width: 320, height: 180, channels: 3, background: "#224466" }
    })
      .png()
      .toBuffer()
  ]);

  return createHwpxFixture({
    entries: {
      "Contents/content.hpf": [
        '<opf:package xmlns:opf="http://www.idpf.org/2007/opf/">',
        "<opf:manifest>",
        '<opf:item id="cover" href="BinData/cover.jpg" media-type="image/jpeg" isEmbeded="1"/>',
        '<opf:item id="chart" href="BinData/chart.png" media-type="image/png" isEmbeded="1"/>',
        '<opf:item id="logo1" href="BinData/logo1.png" media-type="image/png" isEmbeded="1"/>',
        '<opf:item id="logo2" href="BinData/logo2.png" media-type="image/png" isEmbeded="1"/>',
        "</opf:manifest>",
        "</opf:package>"
      ].join(""),
      "Contents/section0.xml": [
        "<root>",
        '<hp:pic><hp:sz width="7200" height="5400"/><hc:img binaryItemIDRef="cover"/></hp:pic>',
        '<hp:pic><hp:sz width="5000" height="3000"/><hc:img binaryItemIDRef="chart"/></hp:pic>',
        '<hp:pic><hp:sz width="1600" height="900"/><hc:img binaryItemIDRef="logo1"/></hp:pic>',
        '<hp:pic><hp:sz width="1600" height="900"/><hc:img binaryItemIDRef="logo2"/></hp:pic>',
        "</root>"
      ].join(""),
      "BinData/cover.jpg": coverJpeg,
      "BinData/chart.png": chartPng,
      "BinData/logo1.png": duplicatedPng,
      "BinData/logo2.png": duplicatedPng,
      "BinData/unused.bin": Buffer.alloc(2048, 1),
      "Object/embedded.ole": Buffer.alloc(4096, 2),
      "Fonts/report.ttf": Buffer.alloc(4096, 3)
    }
  });
}
