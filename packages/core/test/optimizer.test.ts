import { describe, expect, it } from "vitest";
import { applySafeOptimizationPlan } from "../src/optimizer.js";
import type { HwpxPackage, OptimizationPlan } from "../src/types.js";

describe("applySafeOptimizationPlan", () => {
  it("strips JPEG metadata segments without re-encoding image bytes", async () => {
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      segment(0xe1, Buffer.from("Exif\0\0metadata")),
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

    expect(optimized.includes(Buffer.from("Exif"))).toBe(false);
    expect(optimized.includes(Buffer.from("JFIF"))).toBe(true);
    expect(optimized.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(optimized.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
  });
});

function segment(marker: number, payload: Buffer): Buffer {
  const header = Buffer.from([0xff, marker, 0x00, payload.byteLength + 2]);
  return Buffer.concat([header, payload]);
}
