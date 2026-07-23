import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { findImageConsolidationGroups } from "../src/imageDuplicates.js";
import { readHwpxPackage } from "../src/reader.js";
import { createHwpxFixture } from "./fixtures.js";

async function gradientRaw(width: number, height: number): Promise<Buffer> {
  const channels = 3;
  const raw = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * channels;
      const value = Math.round(((x + y) / (width + height - 2)) * 255);
      raw[offset] = value;
      raw[offset + 1] = value;
      raw[offset + 2] = value;
    }
  }
  return raw;
}

describe("findImageConsolidationGroups with dimension pre-filter", () => {
  it("still groups pixel-identical, byte-different images of the same size and leaves unique-size images alone", async () => {
    const raw64 = await gradientRaw(64, 64);
    // Same pixels, different bytes (different PNG compression level).
    const pngA = await sharp(raw64, { raw: { width: 64, height: 64, channels: 3 } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const pngB = await sharp(raw64, { raw: { width: 64, height: 64, channels: 3 } })
      .png({ compressionLevel: 1 })
      .toBuffer();
    // A different image with a unique size — must never be a duplicate candidate.
    const raw40 = await gradientRaw(40, 40);
    const pngC = await sharp(raw40, { raw: { width: 40, height: 40, channels: 3 } })
      .png()
      .toBuffer();

    const fixture = await createHwpxFixture({
      entries: {
        "BinData/a.png": pngA,
        "BinData/b.png": pngB,
        "BinData/c.png": pngC
      }
    });
    const pkg = await readHwpxPackage(fixture);

    const groups = await findImageConsolidationGroups(pkg);
    const identicalGroup = groups.find((group) => group.paths.includes("BinData/a.png"));
    expect(identicalGroup?.paths).toEqual(["BinData/a.png", "BinData/b.png"]);
    expect(groups.some((group) => group.paths.includes("BinData/c.png"))).toBe(false);
  });
});
