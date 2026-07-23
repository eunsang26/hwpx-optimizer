import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { applySafeOptimizationPlan } from "../src/optimizer.js";
import type { HwpxPackage, OptimizationPlan } from "../src/types.js";

describe("applySafeOptimizationPlan", () => {
  it("strips XMP and IPTC segments while preserving EXIF orientation in JPEGs", async () => {
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      segment(0xe1, Buffer.from("Exif\0\0orientation-data")),
      segment(0xe1, Buffer.from("http://ns.adobe.com/xap/1.0/\0xmp-data")),
      segment(0xed, Buffer.from("iptc-data")),
      segment(0xe0, Buffer.from("JFIF\0keep")),
      Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x02, 0x03, 0x04, 0xff, 0xd9])
    ]);
    const pkg: HwpxPackage = {
      entries: [{ path: "BinData/photo.jpg", data: jpeg, size: jpeg.byteLength, kind: "image" }]
    };
    const plan: OptimizationPlan = {
      mode: "safe",
      actions: [{ type: "strip-metadata", target: "BinData/photo.jpg", risk: "safe" }]
    };

    const result = await applySafeOptimizationPlan({ pkg, plan });
    const optimized = result.pkg.entries[0].data;

    expect(optimized.includes(Buffer.from("Exif"))).toBe(true);
    expect(optimized.includes(Buffer.from("orientation-data"))).toBe(true);
    expect(optimized.includes(Buffer.from("http://ns.adobe.com/xap/1.0/"))).toBe(false);
    expect(optimized.includes(Buffer.from("iptc-data"))).toBe(false);
    expect(optimized.includes(Buffer.from("JFIF"))).toBe(true);
    expect(optimized.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(optimized.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
    expect(optimized.byteLength).toBeLessThan(jpeg.byteLength);
  });

  it("skips JPEG metadata stripping when no removable segment is present", async () => {
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      segment(0xe0, Buffer.from("JFIF\0keep")),
      Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x02, 0x03, 0x04, 0xff, 0xd9])
    ]);
    const pkg: HwpxPackage = {
      entries: [{ path: "BinData/photo.jpg", data: jpeg, size: jpeg.byteLength, kind: "image" }]
    };
    const plan: OptimizationPlan = {
      mode: "safe",
      actions: [{ type: "strip-metadata", target: "BinData/photo.jpg", risk: "safe" }]
    };

    const result = await applySafeOptimizationPlan({ pkg, plan });

    expect(result.pkg.entries[0].data).toEqual(jpeg);
    expect(result.applied).not.toContainEqual(expect.objectContaining({ type: "strip-metadata" }));
    expect(result.skipped).toContainEqual(
      expect.objectContaining({ type: "strip-metadata", target: "BinData/photo.jpg" })
    );
  });

  it("optimizes PNG images losslessly when the result is smaller", async () => {
    const png = await sharp({
      create: {
        width: 96,
        height: 72,
        channels: 4,
        background: { r: 20, g: 160, b: 90, alpha: 1 }
      }
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    const pkg: HwpxPackage = {
      entries: [{ path: "BinData/image1.png", data: png, size: png.byteLength, kind: "image" }]
    };
    const plan: OptimizationPlan = {
      mode: "safe",
      actions: [{ type: "optimize-png", target: "BinData/image1.png", risk: "safe" }]
    };

    const result = await applySafeOptimizationPlan({ pkg, plan });
    const optimized = result.pkg.entries[0].data;
    const metadata = await sharp(optimized).metadata();

    expect(optimized.byteLength).toBeLessThan(png.byteLength);
    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(96);
    expect(metadata.height).toBe(72);
    expect(result.applied).toContainEqual(
      expect.objectContaining({ type: "optimize-png", target: "BinData/image1.png" })
    );
  });

  it("skips XML minify when serialized XML would become larger", async () => {
    const xml = Buffer.from("<root />");
    const pkg: HwpxPackage = {
      entries: [{ path: "Contents/section0.xml", data: xml, size: xml.byteLength, kind: "xml" }]
    };
    const plan: OptimizationPlan = {
      mode: "safe",
      actions: [{ type: "minify-xml", target: "Contents/section0.xml", risk: "safe" }]
    };

    const result = await applySafeOptimizationPlan({ pkg, plan });

    expect(result.pkg.entries[0].data).toEqual(xml);
    expect(result.applied).not.toContainEqual(expect.objectContaining({ type: "minify-xml" }));
    expect(result.skipped).toContainEqual(
      expect.objectContaining({ type: "minify-xml", target: "Contents/section0.xml" })
    );
  });

  it("optimizes multiple PNG entries while preserving entry and report order", async () => {
    const paths = ["BinData/a.png", "BinData/b.png", "BinData/c.png"];
    const pngs = await Promise.all(
      [
        { r: 10, g: 20, b: 30 },
        { r: 200, g: 40, b: 90 },
        { r: 15, g: 180, b: 120 }
      ].map((background) =>
        sharp({ create: { width: 80, height: 60, channels: 4, background: { ...background, alpha: 1 } } })
          .png({ compressionLevel: 0 })
          .toBuffer()
      )
    );
    const pkg: HwpxPackage = {
      entries: [
        { path: "Contents/section0.xml", data: Buffer.from("<root />"), size: 8, kind: "xml" },
        ...paths.map((path, index) => ({ path, data: pngs[index], size: pngs[index].byteLength, kind: "image" as const }))
      ]
    };
    const plan: OptimizationPlan = {
      mode: "safe",
      actions: paths.map((target) => ({ type: "optimize-png" as const, target, risk: "safe" as const }))
    };

    const result = await applySafeOptimizationPlan({ pkg, plan });

    // Entry order preserved (XML first, then a, b, c) regardless of concurrent processing.
    expect(result.pkg.entries.map((entry) => entry.path)).toEqual([
      "Contents/section0.xml",
      ...paths
    ]);
    // Every PNG was optimized, and applied actions stay in input order.
    expect(result.applied.map((action) => action.target)).toEqual(paths);
    expect(result.applied.every((action) => action.type === "optimize-png")).toBe(true);
  });

  it("surfaces optimizer failures as user-visible warnings", async () => {
    const corruptPng = Buffer.from("not a real png");
    const pkg: HwpxPackage = {
      entries: [{ path: "BinData/broken.png", data: corruptPng, size: corruptPng.byteLength, kind: "image" }]
    };
    const plan: OptimizationPlan = {
      mode: "safe",
      actions: [{ type: "optimize-png", target: "BinData/broken.png", risk: "safe" }]
    };

    const result = await applySafeOptimizationPlan({ pkg, plan });

    expect(result.skipped).toContainEqual(
      expect.objectContaining({ type: "optimize-png", target: "BinData/broken.png" })
    );
    expect(result.warnings.some((warning) => warning.includes("BinData/broken.png"))).toBe(true);
  });

  it("optimizes PNGs when imageConcurrency is forced to 1", async () => {
    const png = await sharp({ create: { width: 64, height: 48, channels: 4, background: { r: 5, g: 90, b: 200, alpha: 1 } } })
      .png({ compressionLevel: 0 })
      .toBuffer();
    const pkg: HwpxPackage = { entries: [{ path: "BinData/x.png", data: png, size: png.byteLength, kind: "image" }] };
    const plan: OptimizationPlan = { mode: "safe", actions: [{ type: "optimize-png", target: "BinData/x.png", risk: "safe" }] };

    const result = await applySafeOptimizationPlan({ pkg, plan, imageConcurrency: 1 });

    expect(result.pkg.entries[0].data.byteLength).toBeLessThan(png.byteLength);
    expect(result.applied).toContainEqual(expect.objectContaining({ type: "optimize-png", target: "BinData/x.png" }));
  });
});

function segment(marker: number, payload: Buffer): Buffer {
  const header = Buffer.from([0xff, marker, 0x00, payload.byteLength + 2]);
  return Buffer.concat([header, payload]);
}
