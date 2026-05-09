import sharp from "sharp";
import { randomBytes } from "node:crypto";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { analyzeHwpxBuffer, optimizeHwpxBufferBalanced, optimizeHwpxBufferSafe } from "../src/optimize.js";
import { readHwpxPackage } from "../src/reader.js";
import { createHwpxFixture } from "./fixtures.js";

describe("balanced optimization", () => {
  it("reports dry-run opportunities for oversized JPEG and BMP resources", async () => {
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
    const bmp = createBmp24(1600, 900, [0xee, 0xee, 0xee]);
    const fixture = await createReferencedImageFixture({
      "image1": { path: "BinData/image1.JPG", mediaType: "image/jpg", data: jpg },
      "image2": { path: "BinData/image2.bmp", mediaType: "image/bmp", data: bmp }
    });

    const report = await analyzeHwpxBuffer(fixture);

    expect(report.opportunities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "resize-jpeg", target: "BinData/image1.JPG" }),
        expect.objectContaining({ action: "convert-bmp-to-png", target: "BinData/image2.bmp" })
      ])
    );
    expect(report.opportunities.every((item) => item.estimatedSavingBytes > 0)).toBe(true);
  });

  it("converts BMP to PNG and updates content.hpf manifest references", async () => {
    const bmp = createBmp24(640, 360, [0xcc, 0xcc, 0xcc]);
    const fixture = await createReferencedImageFixture({
      "image1": { path: "BinData/image1.bmp", mediaType: "image/bmp", data: bmp }
    });

    const result = await optimizeHwpxBufferBalanced(fixture);
    const output = await readHwpxPackage(result.output);
    const content = output.entries.find((entry) => entry.path === "Contents/content.hpf")?.data.toString("utf8");

    expect(output.entries.some((entry) => entry.path === "BinData/image1.png")).toBe(true);
    expect(output.entries.some((entry) => entry.path === "BinData/image1.bmp")).toBe(false);
    expect(content).toContain('id="image1"');
    expect(content).toContain('href="BinData/image1.png"');
    expect(content).toContain('media-type="image/png"');
    expect(result.report.actions.applied).toContainEqual(
      expect.objectContaining({ type: "convert-bmp-to-png", target: "BinData/image1.bmp" })
    );
    expect(result.report.opportunities).toContainEqual(
      expect.objectContaining({
        action: "convert-bmp-to-png",
        target: "BinData/image1.bmp",
        confidence: "exact"
      })
    );
  });

  it("updates manifest media types structurally regardless of attribute order", async () => {
    const bmp = createBmp24(320, 180, [0xaa, 0xbb, 0xcc]);
    const fixture = await createHwpxFixture({
      entries: {
        "Contents/content.hpf": `<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest><opf:item media-type="image/bmp" href="BinData/image1.bmp" id="image1" isEmbeded="1"/></opf:manifest></opf:package>`,
        "Contents/section0.xml": `<root><hc:img binaryItemIDRef="image1" /></root>`,
        "BinData/image1.bmp": bmp
      }
    });

    const result = await optimizeHwpxBufferBalanced(fixture);
    const output = await readHwpxPackage(result.output);
    const content = output.entries.find((entry) => entry.path === "Contents/content.hpf")?.data.toString("utf8");

    expect(content).toContain('href="BinData/image1.png"');
    expect(content).toContain('media-type="image/png"');
  });

  it("resizes JPEGs to the document display size budget", async () => {
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

    const result = await optimizeHwpxBufferBalanced(fixture, { allowLarger: true });
    const output = await readHwpxPackage(result.output);
    const image = output.entries.find((entry) => entry.path === "BinData/image1.jpg");
    const metadata = await sharp(image?.data).metadata();

    expect(metadata.width).toBe(192);
    expect(metadata.height).toBe(144);
    expect(result.report.images).toEqual([
      expect.objectContaining({
        path: "BinData/image1.JPG",
        largestDisplay: expect.objectContaining({
          widthPx96: 96,
          heightPx96: 72,
          recommendedWidthPx: 192,
          recommendedHeightPx: 144
        })
      })
    ]);
  });

  it("preserves EXIF orientation through balanced JPEG resize", async () => {
    const physicalLandscape = await sharp({
      create: { width: 2400, height: 1800, channels: 3, background: "#88aacc" }
    })
      .jpeg({ quality: 95 })
      .toBuffer();
    const tagged = await sharp(physicalLandscape)
      .withMetadata({ orientation: 6 })
      .jpeg({ quality: 95 })
      .toBuffer();
    const fixture = await createReferencedImageFixtureWithDisplay({
      id: "image1",
      path: "BinData/image1.jpg",
      mediaType: "image/jpeg",
      data: tagged,
      widthHwpUnit: 7200,
      heightHwpUnit: 5400
    });

    const result = await optimizeHwpxBufferBalanced(fixture, { allowLarger: true });
    const output = await readHwpxPackage(result.output);
    const image = output.entries.find((entry) => entry.path === "BinData/image1.jpg");
    const metadata = await sharp(image?.data).metadata();

    expect(metadata.orientation).toBe(6);
    expect(metadata.width).toBeGreaterThan(0);
    expect(metadata.height).toBeGreaterThan(0);
  });

  it("resizes PNGs to the document display size budget in balanced mode", async () => {
    const png = await sharp({
      create: {
        width: 4000,
        height: 3000,
        channels: 3,
        background: "#44aa88"
      }
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    const fixture = await createReferencedImageFixtureWithDisplay({
      id: "image1",
      path: "BinData/image1.png",
      mediaType: "image/png",
      data: png,
      widthHwpUnit: 7200,
      heightHwpUnit: 5400
    });

    const result = await optimizeHwpxBufferBalanced(fixture, { allowLarger: true });
    const output = await readHwpxPackage(result.output);
    const image = output.entries.find((entry) => entry.path === "BinData/image1.png");
    const metadata = await sharp(image?.data).metadata();

    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(192);
    expect(metadata.height).toBe(144);
    expect(result.report.actions.applied).toContainEqual(
      expect.objectContaining({ type: "resize-png", target: "BinData/image1.png" })
    );
    expect(result.report.actions.applied).not.toContainEqual(
      expect.objectContaining({ type: "optimize-png", target: "BinData/image1.png" })
    );
  });

  it("does not resize PNGs in safe mode", async () => {
    const png = await sharp({
      create: {
        width: 4000,
        height: 3000,
        channels: 3,
        background: "#44aa88"
      }
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    const fixture = await createReferencedImageFixtureWithDisplay({
      id: "image1",
      path: "BinData/image1.png",
      mediaType: "image/png",
      data: png,
      widthHwpUnit: 7200,
      heightHwpUnit: 5400
    });

    const result = await optimizeHwpxBufferSafe(fixture);
    const output = await readHwpxPackage(result.output);
    const image = output.entries.find((entry) => entry.path === "BinData/image1.png");
    const metadata = await sharp(image?.data).metadata();

    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(4000);
    expect(metadata.height).toBe(3000);
    expect(result.report.actions.applied).not.toContainEqual(
      expect.objectContaining({ type: "resize-png", target: "BinData/image1.png" })
    );
  });

  it("consolidates duplicate image references in balanced mode", async () => {
    const png = await sharp({
      create: {
        width: 120,
        height: 80,
        channels: 3,
        background: "#44aa88"
      }
    })
      .png()
      .toBuffer();
    const fixture = await createHwpxFixture({
      entries: {
        "Contents/content.hpf": `<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest><opf:item id="image1" href="BinData/image1.png" media-type="image/png"/><opf:item id="image2" href="BinData/image2.png" media-type="image/png"/></opf:manifest></opf:package>`,
        "Contents/section0.xml": `<root><hp:pic><hc:img binaryItemIDRef="image1"/></hp:pic><hp:pic><hc:img binaryItemIDRef="image2"/></hp:pic></root>`,
        "BinData/image1.png": png,
        "BinData/image2.png": png
      }
    });

    const result = await optimizeHwpxBufferBalanced(fixture, { allowLarger: true });
    const output = await readHwpxPackage(result.output);
    const content = output.entries.find((entry) => entry.path === "Contents/content.hpf")?.data.toString("utf8");
    const section = output.entries.find((entry) => entry.path === "Contents/section0.xml")?.data.toString("utf8");

    expect(output.entries.some((entry) => entry.path === "BinData/image1.png")).toBe(true);
    expect(output.entries.some((entry) => entry.path === "BinData/image2.png")).toBe(false);
    expect(content).toContain('id="image1"');
    expect(content).not.toContain('id="image2"');
    expect(section).toContain('binaryItemIDRef="image1"');
    expect(section).not.toContain('binaryItemIDRef="image2"');
    expect(result.report.actions.applied).toContainEqual(
      expect.objectContaining({ type: "consolidate-duplicate-images", target: "BinData/image2.png" })
    );
  });

  it("consolidates same-visual image references when decoded pixels match across formats", async () => {
    const png = await sharp({
      create: {
        width: 32,
        height: 24,
        channels: 3,
        background: "#44aa88"
      }
    })
      .png()
      .toBuffer();
    const bmp = createBmp24(32, 24, [0x44, 0xaa, 0x88]);
    const fixture = await createHwpxFixture({
      entries: {
        "Contents/content.hpf": `<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest><opf:item id="image1" href="BinData/image1.png" media-type="image/png"/><opf:item id="image2" href="BinData/image2.bmp" media-type="image/bmp"/></opf:manifest></opf:package>`,
        "Contents/section0.xml": `<root><hp:pic><hc:img binaryItemIDRef="image1"/></hp:pic><hp:pic><hc:img binaryItemIDRef="image2"/></hp:pic></root>`,
        "BinData/image1.png": png,
        "BinData/image2.bmp": bmp
      }
    });

    const report = await analyzeHwpxBuffer(fixture);
    expect(report.sameVisualDuplicateImages).toEqual([
      expect.objectContaining({
        paths: ["BinData/image1.png", "BinData/image2.bmp"],
        wastedBytes: bmp.byteLength
      })
    ]);
    expect(report.opportunities).toContainEqual(
      expect.objectContaining({
        action: "consolidate-duplicate-images",
        target: "BinData/image2.bmp",
        visualImpact: "none"
      })
    );

    const result = await optimizeHwpxBufferBalanced(fixture, { allowLarger: true });
    const output = await readHwpxPackage(result.output);
    const content = output.entries.find((entry) => entry.path === "Contents/content.hpf")?.data.toString("utf8");
    const section = output.entries.find((entry) => entry.path === "Contents/section0.xml")?.data.toString("utf8");

    expect(output.entries.some((entry) => entry.path === "BinData/image1.png")).toBe(true);
    expect(output.entries.some((entry) => entry.path === "BinData/image2.bmp")).toBe(false);
    expect(content).toContain('id="image1"');
    expect(content).not.toContain('id="image2"');
    expect(section).toContain('binaryItemIDRef="image1"');
    expect(section).not.toContain('binaryItemIDRef="image2"');
    expect(result.report.actions.applied).toContainEqual(
      expect.objectContaining({ type: "consolidate-duplicate-images", target: "BinData/image2.bmp" })
    );
  });

  it("keeps same-visual consolidation canonical when byte-identical groups overlap", async () => {
    const png = await sharp({
      create: {
        width: 32,
        height: 24,
        channels: 3,
        background: "#44aa88"
      }
    })
      .png()
      .toBuffer();
    const bmp = createBmp24(32, 24, [0x44, 0xaa, 0x88]);
    const fixture = await createHwpxFixture({
      entries: {
        "Contents/content.hpf": `<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest><opf:item id="image1" href="BinData/image1.png" media-type="image/png"/><opf:item id="image2" href="BinData/image2.bmp" media-type="image/bmp"/><opf:item id="image3" href="BinData/image3.bmp" media-type="image/bmp"/></opf:manifest></opf:package>`,
        "Contents/section0.xml": `<root><hc:img binaryItemIDRef="image2"/><hc:img binaryItemIDRef="image3"/></root>`,
        "BinData/image1.png": png,
        "BinData/image2.bmp": bmp,
        "BinData/image3.bmp": bmp
      }
    });

    const result = await optimizeHwpxBufferBalanced(fixture, { allowLarger: true });
    const output = await readHwpxPackage(result.output);
    const content = output.entries.find((entry) => entry.path === "Contents/content.hpf")?.data.toString("utf8");
    const section = output.entries.find((entry) => entry.path === "Contents/section0.xml")?.data.toString("utf8");

    expect(output.entries.some((entry) => entry.path === "BinData/image1.png")).toBe(true);
    expect(output.entries.some((entry) => entry.path === "BinData/image2.bmp")).toBe(false);
    expect(output.entries.some((entry) => entry.path === "BinData/image3.bmp")).toBe(false);
    expect(content).toContain('id="image1"');
    expect(content).not.toContain('id="image2"');
    expect(content).not.toContain('id="image3"');
    expect(section).toContain('binaryItemIDRef="image1"');
    expect(section).not.toContain('binaryItemIDRef="image2"');
    expect(section).not.toContain('binaryItemIDRef="image3"');
  });

  it("updates generic manifest id references when consolidating duplicates", async () => {
    const png = await sharp({
      create: {
        width: 32,
        height: 24,
        channels: 3,
        background: "#44aa88"
      }
    })
      .png()
      .toBuffer();
    const fixture = await createHwpxFixture({
      entries: {
        "Contents/content.hpf": `<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest><opf:item id="image1" href="BinData/image1.png" media-type="image/png"/><opf:item id="image2" href="BinData/image2.png" media-type="image/png"/></opf:manifest></opf:package>`,
        "Contents/section0.xml": `<root><hp:customPicture targetRef="image2"/><hp:ctrl id="image2">not a manifest item</hp:ctrl></root>`,
        "BinData/image1.png": png,
        "BinData/image2.png": png
      }
    });

    const result = await optimizeHwpxBufferBalanced(fixture, { allowLarger: true });
    const output = await readHwpxPackage(result.output);
    const section = output.entries.find((entry) => entry.path === "Contents/section0.xml")?.data.toString("utf8");

    expect(section).toContain('targetRef="image1"');
    expect(section).not.toContain('targetRef="image2"');
    expect(section).toContain('<hp:ctrl id="image2">not a manifest item</hp:ctrl>');
  });

  it("consolidates duplicates declared with relative percent-encoded manifest hrefs", async () => {
    const png = await sharp({
      create: {
        width: 32,
        height: 24,
        channels: 3,
        background: "#44aa88"
      }
    })
      .png()
      .toBuffer();
    const fixture = await createHwpxFixture({
      entries: {
        "Contents/content.hpf": `<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest><opf:item id="image1" href="../BinData/image%201.png" media-type="image/png"/><opf:item id="image2" href="../BinData/image%202.png" media-type="image/png"/></opf:manifest></opf:package>`,
        "Contents/section0.xml": `<root><hp:pic><hc:img binaryItemIDRef="image2"/></hp:pic></root>`,
        "BinData/image 1.png": png,
        "BinData/image 2.png": png
      }
    });

    const result = await optimizeHwpxBufferBalanced(fixture, { allowLarger: true });
    const output = await readHwpxPackage(result.output);
    const content = output.entries.find((entry) => entry.path === "Contents/content.hpf")?.data.toString("utf8");
    const section = output.entries.find((entry) => entry.path === "Contents/section0.xml")?.data.toString("utf8");

    expect(output.entries.some((entry) => entry.path === "BinData/image 1.png")).toBe(true);
    expect(output.entries.some((entry) => entry.path === "BinData/image 2.png")).toBe(false);
    expect(content).toContain('id="image1"');
    expect(content).not.toContain('id="image2"');
    expect(section).toContain('binaryItemIDRef="image1"');
    expect(result.report.actions.applied).toContainEqual(
      expect.objectContaining({ type: "consolidate-duplicate-images", target: "BinData/image 2.png" })
    );
  });

  it("rewrites direct duplicate image hrefs instead of removing visible XML nodes", async () => {
    const png = await sharp({
      create: {
        width: 32,
        height: 24,
        channels: 3,
        background: "#44aa88"
      }
    })
      .png()
      .toBuffer();
    const fixture = await createHwpxFixture({
      entries: {
        "Contents/content.hpf": `<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest><opf:item id="image1" href="BinData/image1.png" media-type="image/png"/><opf:item id="image2" href="BinData/image2.png" media-type="image/png"/></opf:manifest></opf:package>`,
        "Contents/section0.xml": `<root><draw:image xlink:href="BinData/image2.png"/></root>`,
        "BinData/image1.png": png,
        "BinData/image2.png": png
      }
    });

    const result = await optimizeHwpxBufferBalanced(fixture, { allowLarger: true });
    const output = await readHwpxPackage(result.output);
    const section = output.entries.find((entry) => entry.path === "Contents/section0.xml")?.data.toString("utf8");

    expect(output.entries.some((entry) => entry.path === "BinData/image2.png")).toBe(false);
    expect(section).toContain("<draw:image");
    expect(section).toContain('xlink:href="BinData/image1.png"');
    expect(section).not.toContain('xlink:href="BinData/image2.png"');
  });

  it("rewrites non-href direct duplicate image path attributes", async () => {
    const png = await sharp({
      create: {
        width: 32,
        height: 24,
        channels: 3,
        background: "#44aa88"
      }
    })
      .png()
      .toBuffer();
    const fixture = await createHwpxFixture({
      entries: {
        "Contents/content.hpf": `<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest><opf:item id="image1" href="BinData/image1.png" media-type="image/png"/><opf:item id="image2" href="BinData/image2.png" media-type="image/png"/></opf:manifest></opf:package>`,
        "Contents/section0.xml": `<root><custom:image src="BinData/image2.png"/></root>`,
        "BinData/image1.png": png,
        "BinData/image2.png": png
      }
    });

    const result = await optimizeHwpxBufferBalanced(fixture, { allowLarger: true });
    const output = await readHwpxPackage(result.output);
    const section = output.entries.find((entry) => entry.path === "Contents/section0.xml")?.data.toString("utf8");

    expect(output.entries.some((entry) => entry.path === "BinData/image2.png")).toBe(false);
    expect(section).toContain("<custom:image");
    expect(section).toContain('src="BinData/image1.png"');
    expect(section).not.toContain('src="BinData/image2.png"');
  });

  it("resizes BMPs to the document display size budget while converting to PNG", async () => {
    const bmp = createBmp24(400, 200, [0xcc, 0xcc, 0xcc]);
    const fixture = await createReferencedImageFixtureWithDisplay({
      id: "image1",
      path: "BinData/image1.bmp",
      mediaType: "image/bmp",
      data: bmp,
      widthHwpUnit: 7500,
      heightHwpUnit: 3750
    });

    const result = await optimizeHwpxBufferBalanced(fixture);
    const output = await readHwpxPackage(result.output);
    const image = output.entries.find((entry) => entry.path === "BinData/image1.png");
    const metadata = await sharp(image?.data).metadata();

    expect(metadata.width).toBe(200);
    expect(metadata.height).toBe(100);
  });

  it("converts TIFF to PNG and updates content.hpf manifest references", async () => {
    const tiff = await sharp({
      create: {
        width: 640,
        height: 360,
        channels: 3,
        background: "#d8dde6"
      }
    })
      .tiff({ compression: "none" })
      .toBuffer();
    const fixture = await createReferencedImageFixture({
      image1: { path: "BinData/image1.tiff", mediaType: "image/tiff", data: tiff }
    });

    const result = await optimizeHwpxBufferBalanced(fixture);
    const output = await readHwpxPackage(result.output);
    const content = output.entries.find((entry) => entry.path === "Contents/content.hpf")?.data.toString("utf8");
    const image = output.entries.find((entry) => entry.path === "BinData/image1.png");
    const metadata = await sharp(image?.data).metadata();

    expect(output.entries.some((entry) => entry.path === "BinData/image1.tiff")).toBe(false);
    expect(image).toBeDefined();
    expect(metadata.format).toBe("png");
    expect(content).toContain('href="BinData/image1.png"');
    expect(content).toContain('media-type="image/png"');
    expect(result.report.actions.applied).toContainEqual(
      expect.objectContaining({ type: "convert-tiff-to-png", target: "BinData/image1.tiff" })
    );
  });

  it("does not report TIFF conversion when PNG output would not be smaller", async () => {
    const raw = Buffer.alloc(100 * 100 * 3);
    for (let index = 0; index < raw.length; index += 1) {
      raw[index] = (index * 37) % 256;
    }
    const tiff = await sharp(raw, { raw: { width: 100, height: 100, channels: 3 } })
      .tiff({ compression: "jpeg", quality: 30 })
      .toBuffer();
    const fixture = await createReferencedImageFixture({
      image1: { path: "BinData/tiny.tif", mediaType: "image/tiff", data: tiff }
    });

    const report = await analyzeHwpxBuffer(fixture);

    expect(report.opportunities).not.toContainEqual(
      expect.objectContaining({ action: "convert-tiff-to-png", target: "BinData/tiny.tif" })
    );
  });

  it("reports PNG optimization and shapeComment cleanup as advanced opportunities", async () => {
    const png = await sharp({
      create: {
        width: 320,
        height: 180,
        channels: 3,
        background: "#44aa88"
      }
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    const fixture = await createReferencedImageFixture(
      {
        image1: { path: "BinData/image1.png", mediaType: "image/png", data: png }
      },
      `<hp:shapeComment>그림입니다.
원본 그림의 이름: IMG_1234.JPG
원본 그림의 크기: 가로 5712pixel, 세로 4284pixel</hp:shapeComment>`
    );

    const report = await analyzeHwpxBuffer(fixture);

    expect(report.opportunities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "optimize-png",
          target: "BinData/image1.png",
          defaultEnabledIn: ["safe", "balanced", "aggressive"]
        }),
        expect.objectContaining({ action: "clean-shape-comment", target: "Contents/section0.xml" })
      ])
    );
  });

  it("strips JPEG metadata in balanced mode without resizing", async () => {
    const jpeg = await createJpegWithLargeMetadata({
      width: 320,
      height: 180,
      metadataBytes: 16_384
    });
    const fixture = await createReferencedImageFixture({
      image1: { path: "BinData/photo.jpg", mediaType: "image/jpeg", data: jpeg }
    });

    const result = await optimizeHwpxBufferBalanced(fixture);
    const output = await readHwpxPackage(result.output);
    const image = output.entries.find((entry) => entry.path === "BinData/photo.jpg");
    const metadata = await sharp(image?.data).metadata();

    expect(image?.data.includes(Buffer.from("http://ns.adobe.com/xap/1.0/"))).toBe(false);
    expect(image?.size).toBeLessThan(jpeg.byteLength);
    expect(metadata.format).toBe("jpeg");
    expect(metadata.width).toBe(320);
    expect(metadata.height).toBe(180);
    expect(result.report.actions.applied).toContainEqual(
      expect.objectContaining({ type: "strip-metadata", target: "BinData/photo.jpg" })
    );
  });

  it("does not report strip-metadata separately for JPEGs that will be resized", async () => {
    const jpeg = await createJpegWithLargeMetadata({
      width: 2400,
      height: 1800,
      metadataBytes: 16_384
    });
    const fixture = await createReferencedImageFixtureWithDisplay({
      id: "image1",
      path: "BinData/photo.jpg",
      mediaType: "image/jpeg",
      data: jpeg,
      widthHwpUnit: 7200,
      heightHwpUnit: 5400
    });

    const report = await analyzeHwpxBuffer(fixture);

    expect(report.opportunities).toContainEqual(
      expect.objectContaining({ action: "resize-jpeg", target: "BinData/photo.jpg" })
    );
    expect(report.opportunities).not.toContainEqual(
      expect.objectContaining({ action: "strip-metadata", target: "BinData/photo.jpg" })
    );
  });

  it("reports strip-metadata when an oversized JPEG would not shrink by resizing", async () => {
    const jpeg = await createJpegWithLargeMetadata({
      width: 4000,
      height: 1,
      metadataBytes: 256
    });
    const fixture = await createReferencedImageFixture({
      image1: { path: "BinData/wide.jpg", mediaType: "image/jpeg", data: jpeg }
    });

    const report = await analyzeHwpxBuffer(fixture);

    expect(report.opportunities).not.toContainEqual(
      expect.objectContaining({ action: "resize-jpeg", target: "BinData/wide.jpg" })
    );
    expect(report.opportunities).toContainEqual(
      expect.objectContaining({ action: "strip-metadata", target: "BinData/wide.jpg" })
    );
  });

  it("applies strip-metadata without resizing when resize would not shrink an oversized JPEG", async () => {
    const jpeg = await createJpegWithLargeMetadata({
      width: 4000,
      height: 1,
      metadataBytes: 256
    });
    const fixture = await createReferencedImageFixture({
      image1: { path: "BinData/wide.jpg", mediaType: "image/jpeg", data: jpeg }
    });

    const result = await optimizeHwpxBufferBalanced(fixture, { allowLarger: true });
    const output = await readHwpxPackage(result.output);
    const image = output.entries.find((entry) => entry.path === "BinData/wide.jpg");
    const metadata = await sharp(image?.data).metadata();

    expect(metadata.width).toBe(4000);
    expect(metadata.height).toBe(1);
    expect(result.report.actions.applied).toContainEqual(
      expect.objectContaining({ type: "strip-metadata", target: "BinData/wide.jpg" })
    );
    expect(result.report.actions.applied).not.toContainEqual(
      expect.objectContaining({ type: "resize-jpeg", target: "BinData/wide.jpg" })
    );
  });

  it("applies only selected advanced actions", async () => {
    const fixture = await createReferencedImageFixture(
      {
        image1: { path: "BinData/image1.png", mediaType: "image/png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }
      },
      `<hp:shapeComment>그림입니다.
원본 그림의 이름: IMG_1234.JPG
원본 그림의 크기: 가로 5712pixel, 세로 4284pixel</hp:shapeComment>`
    );

    const result = await optimizeHwpxBufferBalanced(fixture, { actions: ["clean-shape-comment"] });
    const output = await readHwpxPackage(result.output);
    const section = output.entries.find((entry) => entry.path === "Contents/section0.xml")?.data.toString("utf8");

    expect(section).toContain("<hp:shapeComment>그림입니다.</hp:shapeComment>");
    expect(section).not.toContain("IMG_1234");
    expect(section).not.toContain("5712pixel");
    expect(result.report.actions.applied).toContainEqual(
      expect.objectContaining({ type: "clean-shape-comment", target: "Contents/section0.xml" })
    );
  });

  it("does not record clean-shape-comment as applied when manifest changes alone touched the XML", async () => {
    const bmp = createBmp24(120, 80, [0xaa, 0xbb, 0xcc]);
    const fixture = await createHwpxFixture({
      entries: {
        "Contents/content.hpf": `<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest><opf:item id="image1" href="BinData/image1.bmp" media-type="image/bmp" isEmbeded="1"/></opf:manifest></opf:package>`,
        "Contents/section0.xml": `<root><hp:pic><hc:img binaryItemIDRef="image1" /></hp:pic><hp:shapeComment>그림입니다.</hp:shapeComment></root>`,
        "BinData/image1.bmp": bmp
      }
    });

    const result = await optimizeHwpxBufferBalanced(fixture, { allowLarger: true });
    const cleanShapeApplied = result.report.actions.applied.filter((action) => action.type === "clean-shape-comment");

    expect(cleanShapeApplied).toEqual([]);
    expect(result.report.actions.applied).toContainEqual(
      expect.objectContaining({ type: "convert-bmp-to-png", target: "BinData/image1.bmp" })
    );
  });

  it("can apply explicit privacy actions even when the package becomes larger", async () => {
    const fixture = await createStoredFixture({
      "Contents/section0.xml": `<root><hp:shapeComment>그림입니다.
원본 그림의 이름: IMG_9999.JPG
원본 그림의 크기: 가로 5712pixel, 세로 4284pixel</hp:shapeComment></root>`,
      "Payload/random.bin": randomBytes(5_000_000)
    });

    const protectedResult = await optimizeHwpxBufferBalanced(fixture, { actions: ["clean-shape-comment"] });
    const protectedOutput = await readHwpxPackage(protectedResult.output);
    const protectedSection = protectedOutput.entries
      .find((entry) => entry.path === "Contents/section0.xml")
      ?.data.toString("utf8");

    const allowedResult = await optimizeHwpxBufferBalanced(fixture, {
      actions: ["clean-shape-comment"],
      allowLarger: true
    });
    const allowedOutput = await readHwpxPackage(allowedResult.output);
    const allowedSection = allowedOutput.entries
      .find((entry) => entry.path === "Contents/section0.xml")
      ?.data.toString("utf8");

    expect(protectedSection).toContain("IMG_9999");
    expect(protectedResult.report.warnings).toContain(
      "Balanced mode did not produce a smaller file; original package bytes returned."
    );
    expect(allowedSection).not.toContain("IMG_9999");
    expect(allowedResult.report.actions.applied).toContainEqual(
      expect.objectContaining({ type: "clean-shape-comment", target: "Contents/section0.xml" })
    );
  });
});

async function createReferencedImageFixture(
  images: Record<string, { path: string; mediaType: string; data: Buffer }>,
  body = ""
): Promise<Buffer> {
  const items = Object.entries(images)
    .map(([id, image]) => `<opf:item id="${id}" href="${image.path}" media-type="${image.mediaType}" isEmbeded="1"/>`)
    .join("");
  const firstId = Object.keys(images)[0];
  const entries: Record<string, string | Buffer> = {
    "Contents/content.hpf": `<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest><opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>${items}</opf:manifest></opf:package>`,
    "Contents/section0.xml": `<root><hc:img binaryItemIDRef="${firstId}" />${body}</root>`
  };
  for (const image of Object.values(images)) {
    entries[image.path] = image.data;
  }
  return createHwpxFixture({ entries });
}

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

async function createStoredFixture(entries: Record<string, string | Buffer>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [path, value] of Object.entries({
    "Contents/content.hpf": '<opf:package xmlns:opf="http://www.idpf.org/2007/opf" />',
    "Contents/section0.xml": "<root />",
    ...entries
  })) {
    zip.file(path, value, { compression: "STORE" });
  }
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "STORE" }));
}

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

async function createJpegWithLargeMetadata(input: {
  width: number;
  height: number;
  metadataBytes: number;
}): Promise<Buffer> {
  const jpeg = await sharp({
    create: {
      width: input.width,
      height: input.height,
      channels: 3,
      background: "#88aacc"
    }
  })
    .jpeg({ quality: 95 })
    .toBuffer();
  const xmpPayload = Buffer.concat([
    Buffer.from("http://ns.adobe.com/xap/1.0/\0"),
    Buffer.alloc(input.metadataBytes, "x")
  ]);
  return Buffer.concat([jpeg.subarray(0, 2), jpegSegment(0xe1, xmpPayload), jpeg.subarray(2)]);
}

function jpegSegment(marker: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header[0] = 0xff;
  header[1] = marker;
  header.writeUInt16BE(payload.byteLength + 2, 2);
  return Buffer.concat([header, payload]);
}
