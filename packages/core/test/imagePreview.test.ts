import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { computePsnr, computeVisualMetrics, extractImageDiffPreviews } from "../src/imagePreview.js";
import { optimizeHwpxBufferBalanced } from "../src/optimize.js";
import { createHwpxFixture } from "./fixtures.js";

describe("extractImageDiffPreviews", () => {
  it("returns thumbnail pairs for images that changed and skips unchanged ones", async () => {
    const oversizedJpeg = await sharp({
      create: {
        width: 2400,
        height: 1800,
        channels: 3,
        background: "#88aacc"
      }
    })
      .jpeg({ quality: 95 })
      .toBuffer();
    const stableJpeg = await sharp({
      create: {
        width: 200,
        height: 200,
        channels: 3,
        background: "#445566"
      }
    })
      .jpeg({ quality: 80 })
      .toBuffer();
    const fixture = await createHwpxFixture({
      entries: {
        "Contents/content.hpf": [
          '<opf:package xmlns:opf="http://www.idpf.org/2007/opf/">',
          "<opf:manifest>",
          '<opf:item id="image1" href="BinData/image1.jpg" media-type="image/jpeg" isEmbeded="1"/>',
          '<opf:item id="image2" href="BinData/image2.jpg" media-type="image/jpeg" isEmbeded="1"/>',
          "</opf:manifest>",
          "</opf:package>"
        ].join(""),
        "Contents/section0.xml": [
          "<root>",
          '<hp:pic><hc:img binaryItemIDRef="image1" /><hp:sz width="7200" widthRelTo="ABSOLUTE" height="5400" heightRelTo="ABSOLUTE"/></hp:pic>',
          '<hp:pic><hc:img binaryItemIDRef="image2" /></hp:pic>',
          "</root>"
        ].join(""),
        "BinData/image1.jpg": oversizedJpeg,
        "BinData/image2.jpg": stableJpeg
      }
    });

    const result = await optimizeHwpxBufferBalanced(fixture, { allowLarger: true });
    const previews = await extractImageDiffPreviews(fixture, result.output);

    expect(previews.length).toBe(1);
    const [pair] = previews;
    expect(pair.originalPath).toBe("BinData/image1.jpg");
    expect(pair.outputPath).toBe("BinData/image1.jpg");
    expect(pair.savedBytes).toBeGreaterThan(0);
    expect(pair.originalThumbnailDataUrl.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(pair.outputThumbnailDataUrl.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(pair.originalFormat).toBe("jpeg");
    expect(pair.outputFormat).toBe("jpeg");
  });

  it("matches BMP→PNG conversions through sibling extensions", async () => {
    const bmp = createBmp24(200, 100, [0xaa, 0xbb, 0xcc]);
    const fixture = await createHwpxFixture({
      entries: {
        "Contents/content.hpf": [
          '<opf:package xmlns:opf="http://www.idpf.org/2007/opf/">',
          "<opf:manifest>",
          '<opf:item id="image1" href="BinData/image1.bmp" media-type="image/bmp" isEmbeded="1"/>',
          "</opf:manifest>",
          "</opf:package>"
        ].join(""),
        "Contents/section0.xml": '<root><hp:pic><hc:img binaryItemIDRef="image1" /></hp:pic></root>',
        "BinData/image1.bmp": bmp
      }
    });

    const result = await optimizeHwpxBufferBalanced(fixture, { allowLarger: true });
    const previews = await extractImageDiffPreviews(fixture, result.output);

    expect(previews.length).toBe(1);
    expect(previews[0].originalPath).toBe("BinData/image1.bmp");
    expect(previews[0].outputPath).toBe("BinData/image1.png");
    expect(previews[0].originalFormat).toBe("bmp");
    expect(previews[0].outputFormat).toBe("png");
  });

  it("respects maxItems by keeping the largest savings first", async () => {
    const big = await sharp({ create: { width: 2400, height: 1800, channels: 3, background: "#22aa44" } })
      .jpeg({ quality: 95 })
      .toBuffer();
    const small = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: "#3344aa" } })
      .jpeg({ quality: 95 })
      .toBuffer();
    const fixture = await createHwpxFixture({
      entries: {
        "Contents/content.hpf": [
          '<opf:package xmlns:opf="http://www.idpf.org/2007/opf/">',
          "<opf:manifest>",
          '<opf:item id="image1" href="BinData/image1.jpg" media-type="image/jpeg" isEmbeded="1"/>',
          '<opf:item id="image2" href="BinData/image2.jpg" media-type="image/jpeg" isEmbeded="1"/>',
          "</opf:manifest>",
          "</opf:package>"
        ].join(""),
        "Contents/section0.xml": [
          "<root>",
          '<hp:pic><hc:img binaryItemIDRef="image1" /><hp:sz width="7200" widthRelTo="ABSOLUTE" height="5400" heightRelTo="ABSOLUTE"/></hp:pic>',
          '<hp:pic><hc:img binaryItemIDRef="image2" /><hp:sz width="7200" widthRelTo="ABSOLUTE" height="5400" heightRelTo="ABSOLUTE"/></hp:pic>',
          "</root>"
        ].join(""),
        "BinData/image1.jpg": big,
        "BinData/image2.jpg": small
      }
    });

    const result = await optimizeHwpxBufferBalanced(fixture, { allowLarger: true });
    const previews = await extractImageDiffPreviews(fixture, result.output, { maxItems: 1 });

    expect(previews.length).toBe(1);
    expect(previews[0].originalPath).toBe("BinData/image1.jpg");
  });

  it("attaches a PSNR estimate to each preview pair", async () => {
    const oversizedJpeg = await sharp({
      create: { width: 2400, height: 1800, channels: 3, background: "#88aacc" }
    })
      .jpeg({ quality: 95 })
      .toBuffer();
    const fixture = await createHwpxFixture({
      entries: {
        "Contents/content.hpf": [
          '<opf:package xmlns:opf="http://www.idpf.org/2007/opf/">',
          "<opf:manifest>",
          '<opf:item id="image1" href="BinData/image1.jpg" media-type="image/jpeg" isEmbeded="1"/>',
          "</opf:manifest>",
          "</opf:package>"
        ].join(""),
        "Contents/section0.xml":
          '<root><hp:pic><hc:img binaryItemIDRef="image1" /><hp:sz width="7200" widthRelTo="ABSOLUTE" height="5400" heightRelTo="ABSOLUTE"/></hp:pic></root>',
        "BinData/image1.jpg": oversizedJpeg
      }
    });

    const result = await optimizeHwpxBufferBalanced(fixture, { allowLarger: true });
    const previews = await extractImageDiffPreviews(fixture, result.output);
    expect(previews.length).toBe(1);
    const psnr = previews[0]!.psnrDb;
    expect(psnr).not.toBeNull();
    expect(psnr).toBeGreaterThan(20);
    expect(psnr).toBeLessThanOrEqual(80);
  });
});

describe("computePsnr", () => {
  it("returns the maximum cap when buffers decode identically", async () => {
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#445566" } })
      .png()
      .toBuffer();
    const psnr = await computePsnr(png, png);
    expect(psnr).toBe(80);
  });

  it("returns a finite low PSNR when images differ visibly", async () => {
    const blue = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#1133cc" } })
      .png()
      .toBuffer();
    const orange = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#cc7711" } })
      .png()
      .toBuffer();
    const psnr = await computePsnr(blue, orange);
    expect(psnr).not.toBeNull();
    expect(psnr).toBeLessThan(20);
  });

  it("returns null for non-image buffers without throwing", async () => {
    const psnr = await computePsnr(Buffer.from("not an image"), Buffer.from("also not"));
    expect(psnr).toBeNull();
  });

  it("aligns EXIF-rotated JPEGs before comparing so PSNR stays high", async () => {
    const gradient = await sharp({
      create: { width: 192, height: 128, channels: 3, background: "#88aacc" }
    })
      .jpeg({ quality: 95 })
      .toBuffer();
    const tagged = await sharp(gradient)
      .withMetadata({ orientation: 6 })
      .jpeg({ quality: 95 })
      .toBuffer();
    const physicallyRotated = await sharp(tagged).rotate().jpeg({ quality: 80 }).toBuffer();

    const psnr = await computePsnr(tagged, physicallyRotated);
    expect(psnr).not.toBeNull();
    expect(psnr).toBeGreaterThan(20);
  });
});

describe("computeVisualMetrics", () => {
  it("computes PSNR and SSIM from shared decoded samples", async () => {
    const original = await sharp({
      create: { width: 96, height: 64, channels: 3, background: "#446688" }
    })
      .png()
      .toBuffer();
    const optimized = await sharp(original).jpeg({ quality: 88 }).toBuffer();

    const metrics = await computeVisualMetrics(original, optimized);

    expect(metrics.psnr).not.toBeNull();
    expect(metrics.ssim).not.toBeNull();
    expect(metrics.ssim).toBeGreaterThan(0.9);
  });

  it("returns metrics for wide and tall images without distorting-fit length mismatch", async () => {
    const wide = await sharp({
      create: { width: 400, height: 100, channels: 3, background: "#2255aa" }
    })
      .png()
      .toBuffer();
    const tall = await sharp({
      create: { width: 100, height: 400, channels: 3, background: "#2255aa" }
    })
      .png()
      .toBuffer();

    const identical = await computeVisualMetrics(wide, wide);
    expect(identical.psnr).not.toBeNull();
    expect(identical.psnr).toBeGreaterThan(40);
    expect(identical.ssim).not.toBeNull();

    const crossAspect = await computeVisualMetrics(wide, tall);
    expect(crossAspect.psnr).not.toBeNull();
    expect(crossAspect.ssim).not.toBeNull();
  });
});

function createBmp24(width: number, height: number, rgb: [number, number, number]): Buffer {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelDataSize = rowSize * height;
  const fileSize = 54 + pixelDataSize;
  const buffer = Buffer.alloc(fileSize);
  buffer.write("BM", 0, "ascii");
  buffer.writeUInt32LE(fileSize, 2);
  buffer.writeUInt32LE(54, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(pixelDataSize, 34);
  for (let y = 0; y < height; y += 1) {
    const row = 54 + y * rowSize;
    for (let x = 0; x < width; x += 1) {
      const offset = row + x * 3;
      buffer[offset] = rgb[2];
      buffer[offset + 1] = rgb[1];
      buffer[offset + 2] = rgb[0];
    }
  }
  return buffer;
}
