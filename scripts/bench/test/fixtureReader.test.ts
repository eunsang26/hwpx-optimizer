import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readHwpxPackage } from "@hwpx-optimizer/core";
import { buildSyntheticPhotoHwpx } from "../src/buildFixture.js";

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/photo.hwpx");

describe("bench fixtures", () => {
  it("buildSyntheticPhotoHwpx is readable by core reader with an image entry", async () => {
    const buf = await buildSyntheticPhotoHwpx();
    await mkdir(dirname(fixturePath), { recursive: true });
    await writeFile(fixturePath, buf);
    const pkg = await readHwpxPackage(buf);
    const images = pkg.entries.filter((e) => e.kind === "image");
    expect(images.length).toBeGreaterThanOrEqual(1);
    expect(images.some((e) => /\.jpe?g$/i.test(e.path))).toBe(true);
  });
});
