import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { createHwpxFixture } from "./fixtures.js";
import { JPEG_QUALITY_FLOOR, optimizeHwpxBufferAggressive, optimizeHwpxBufferBalanced } from "../src/index.js";

async function largeJpegHwpx(): Promise<Buffer> {
  const jpeg = await sharp({
    create: { width: 2400, height: 1800, channels: 3, background: { r: 40, g: 90, b: 160 } }
  })
    .jpeg({ quality: 95, mozjpeg: true })
    .toBuffer();
  return createHwpxFixture({
    entries: {
      "Contents/content.hpf": [
        '<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest>',
        '<opf:item id="image1" href="BinData/image1.jpg" media-type="image/jpeg"/>',
        "</opf:manifest></opf:package>"
      ].join(""),
      "Contents/section0.xml":
        '<root><hp:pic><hp:sz width="20000" height="15000"/><hc:img binaryItemIDRef="image1"/></hp:pic></root>',
      "BinData/image1.jpg": jpeg
    }
  });
}

describe("continuous target JPEG quality", () => {
  it("records plannedJpegQuality for balanced target-fit", async () => {
    const fixture = await largeJpegHwpx();
    const targetBytes = Math.floor(fixture.byteLength * 0.85);
    const result = await optimizeHwpxBufferBalanced(fixture, { allowLarger: true, targetBytes });
    expect(result.report.plannedJpegQuality).toBeTypeOf("number");
    expect(result.report.plannedJpegQuality).toBeGreaterThanOrEqual(JPEG_QUALITY_FLOOR);
    expect(result.report.plannedJpegQuality).toBeLessThanOrEqual(95);
    if (result.report.targetStatus === "met" || result.report.targetStatus === "already-under-target") {
      expect(result.output.byteLength).toBeLessThan(targetBytes);
    } else {
      // Unreachable or still-missed target — search still records a planned quality.
      expect(result.report.plannedJpegQuality).toBeGreaterThanOrEqual(JPEG_QUALITY_FLOOR);
      expect(result.report.plannedJpegQuality).toBeLessThanOrEqual(95);
    }
  });

  it("honors manual jpegQuality without requiring targetBytes", async () => {
    const fixture = await largeJpegHwpx();
    const result = await optimizeHwpxBufferBalanced(fixture, { allowLarger: true, jpegQuality: 72 });
    expect(result.report.plannedJpegQuality).toBe(72);
  });

  it("aggressive mode still compresses when already under a loose target", async () => {
    const fixture = await largeJpegHwpx();
    const looseTarget = fixture.byteLength; // already "under" after any shrink
    const balanced = await optimizeHwpxBufferBalanced(fixture, {
      allowLarger: true,
      targetBytes: Math.floor(fixture.byteLength * 0.9)
    });
    const aggressive = await optimizeHwpxBufferAggressive(fixture, {
      allowLarger: true,
      targetBytes: looseTarget
    });
    expect(aggressive.report.plannedJpegQuality).toBe(JPEG_QUALITY_FLOOR);
    expect(aggressive.output.byteLength).toBeLessThanOrEqual(balanced.output.byteLength);
  });
});
