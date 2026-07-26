import { access } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readHwpxPackage } from "@hwpx-optimizer/core";
import { resolveSpikeTemplatePath } from "../src/spikeFromTemplate.js";
import { emitHangulSpikeArtifacts } from "../src/spikeHangul.js";

const repoRoot = join(import.meta.dirname, "../../..");

async function templateAvailable(): Promise<boolean> {
  try {
    await resolveSpikeTemplatePath();
    return true;
  } catch {
    return false;
  }
}

describe("Hangul compatibility spike artifacts", () => {
  it(
    "builds spike HWPX packages from a real template shell",
    async () => {
      if (!(await templateAvailable())) {
        return;
      }

      const { mkdtemp, readFile, rm } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const outDir = await mkdtemp(join(tmpdir(), "hwpx-bench-spike-"));
      try {
        const result = await emitHangulSpikeArtifacts(outDir);

        expect(result.templatePath.length).toBeGreaterThan(0);
        expect(result.files.some((file) => file.endsWith("jpeg-control.hwpx"))).toBe(true);
        expect(result.files.some((file) => file.endsWith("webp-test.hwpx"))).toBe(true);
        expect(result.files.some((file) => file.endsWith("jpeg-webp-mixed.hwpx"))).toBe(true);

        for (const name of ["jpeg-control.hwpx", "webp-test.hwpx", "jpeg-webp-mixed.hwpx"]) {
          const pkg = await readHwpxPackage(await readFile(join(outDir, name)));
          expect(pkg.entries.some((entry) => entry.path === "version.xml")).toBe(true);
          expect(pkg.entries.some((entry) => entry.path === "Contents/header.xml")).toBe(true);
          expect(pkg.entries.some((entry) => entry.path === "META-INF/container.xml")).toBe(true);
          const images = pkg.entries.filter((entry) => entry.kind === "image" && entry.path.startsWith("BinData/"));
          expect(images.length).toBeGreaterThanOrEqual(1);
        }

        const control = await readHwpxPackage(await readFile(join(outDir, "jpeg-control.hwpx")));
        expect(control.entries.some((entry) => entry.path === "BinData/control.jpg")).toBe(true);

        const webpPkg = await readHwpxPackage(await readFile(join(outDir, "webp-test.hwpx")));
        expect(webpPkg.entries.some((entry) => /\.webp$/i.test(entry.path))).toBe(true);

        const mixedPkg = await readHwpxPackage(await readFile(join(outDir, "jpeg-webp-mixed.hwpx")));
        const mixedImages = mixedPkg.entries.filter(
          (entry) => entry.kind === "image" && entry.path.startsWith("BinData/")
        );
        expect(mixedImages.some((entry) => /\.jpe?g$/i.test(entry.path))).toBe(true);
        expect(mixedImages.some((entry) => /\.webp$/i.test(entry.path))).toBe(true);

        if (!result.avifSkipped) {
          const avifPkg = await readHwpxPackage(await readFile(join(outDir, "avif-test.hwpx")));
          expect(avifPkg.entries.some((entry) => /\.avif$/i.test(entry.path))).toBe(true);
        }
      } finally {
        await rm(outDir, { recursive: true, force: true });
      }
    },
    30_000
  );

  it("resolveSpikeTemplatePath finds repo sample2 when present", async () => {
    try {
      await access(join(repoRoot, "sample2.hwpx"));
    } catch {
      return;
    }
    const path = await resolveSpikeTemplatePath();
    expect(path.endsWith("sample2.hwpx")).toBe(true);
  });
});
