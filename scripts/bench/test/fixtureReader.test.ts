import { describe, expect, it } from "vitest";
import { readHwpxPackage } from "@hwpx-optimizer/core";
import { buildSyntheticPhotoHwpx } from "../src/buildFixture.js";

describe("bench fixtures", () => {
  it("buildSyntheticPhotoHwpx is readable without rewriting the tracked fixture", async () => {
    const buf = await buildSyntheticPhotoHwpx();
    const pkg = await readHwpxPackage(buf);
    const images = pkg.entries.filter((e) => e.kind === "image");
    expect(images.length).toBeGreaterThanOrEqual(1);
    expect(images.some((e) => /\.jpe?g$/i.test(e.path))).toBe(true);
  });
});
