import sharp from "sharp";
import { writeHwpxPackage } from "@hwpx-optimizer/core";

export async function buildSyntheticPhotoHwpx(): Promise<Buffer> {
  const jpeg = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: { r: 40, g: 90, b: 160 } }
  })
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();

  const entries = [
    { path: "mimetype", data: Buffer.from("application/hwp+zip"), size: 17, kind: "other" as const },
    {
      path: "Contents/content.hpf",
      data: Buffer.from(
        `<opf:package xmlns:opf="http://www.idpf.org/2007/opf"><opf:manifest>` +
          `<opf:item id="photo" href="BinData/photo.jpg" media-type="image/jpeg" isEmbeded="1"/>` +
          `</opf:manifest></opf:package>`
      ),
      size: 0,
      kind: "xml" as const
    },
    {
      path: "Contents/section0.xml",
      data: Buffer.from(
        `<root><hp:pic><hp:sz width="7200" height="4800"/><hc:img binaryItemIDRef="photo"/></hp:pic></root>`
      ),
      size: 0,
      kind: "xml" as const
    },
    { path: "BinData/photo.jpg", data: jpeg, size: jpeg.byteLength, kind: "image" as const }
  ].map((e) => ({ ...e, size: e.data.byteLength }));

  return writeHwpxPackage({ entries });
}
