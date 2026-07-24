import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readHwpxPackage } from "@hwpx-optimizer/core";
import { emitHangulSpikeArtifacts } from "../src/spikeHangul.js";

describe("Hangul compatibility spike artifacts", () => {
  it("builds spike HWPX packages readable by core reader", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "hwpx-bench-spike-"));
    try {
      const result = await emitHangulSpikeArtifacts(outDir);

      expect(result.files.some((file) => file.endsWith("jpeg-control.hwpx"))).toBe(true);
      expect(result.files.some((file) => file.endsWith("webp-test.hwpx"))).toBe(true);
      expect(result.files.some((file) => file.endsWith("jpeg-webp-mixed.hwpx"))).toBe(true);
      expect(result.files.some((file) => file.endsWith("CHECKLIST.md"))).toBe(true);

      for (const name of ["jpeg-control.hwpx", "webp-test.hwpx", "jpeg-webp-mixed.hwpx"]) {
        const pkg = await readHwpxPackage(await readFile(join(outDir, name)));
        const images = pkg.entries.filter((entry) => entry.kind === "image");
        expect(images.length).toBeGreaterThanOrEqual(1);
      }

      const webpPkg = await readHwpxPackage(await readFile(join(outDir, "webp-test.hwpx")));
      expect(webpPkg.entries.some((entry) => /\.webp$/i.test(entry.path))).toBe(true);

      const mixedPkg = await readHwpxPackage(await readFile(join(outDir, "jpeg-webp-mixed.hwpx")));
      const mixedImages = mixedPkg.entries.filter((entry) => entry.kind === "image");
      expect(mixedImages.some((entry) => /\.jpe?g$/i.test(entry.path))).toBe(true);
      expect(mixedImages.some((entry) => /\.webp$/i.test(entry.path))).toBe(true);

      if (!result.avifSkipped) {
        const avifPkg = await readHwpxPackage(await readFile(join(outDir, "avif-test.hwpx")));
        expect(avifPkg.entries.some((entry) => /\.avif$/i.test(entry.path))).toBe(true);
      }
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
