import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createHwpxFixture } from "../../../packages/core/test/fixtures.js";
import { analyzeDesktopFile, defaultDesktopSettings, optimizeDesktopFile, verifyDesktopFile } from "../src/main/desktopService.js";
import type { DesktopSettings } from "../src/main/desktopService.js";

describe("desktop service", () => {
  it("defines submission UI defaults in desktop settings", () => {
    const settings: DesktopSettings = defaultDesktopSettings;

    expect(settings.submissionLimit).toEqual({ id: "mb20" });
    expect(settings.preservationPreference).toBe("recommended");
  });

  it("analyzes, optimizes, writes a report, and preserves the source file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-desktop-"));
    const inputPath = join(dir, "input.hwpx");
    const original = await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } });
    await writeFile(inputPath, original);

    const analysis = await analyzeDesktopFile(inputPath);
    const result = await optimizeDesktopFile({
      filePath: inputPath,
      mode: "safe",
      settings: defaultDesktopSettings
    });

    expect(analysis.report.originalSize).toBe(original.byteLength);
    expect(await readFile(inputPath)).toEqual(original);
    expect(result.outputPath).toBe(join(dir, "input.optimized.hwpx"));
    expect(result.reportPath).toBe(`${result.outputPath}.report.json`);
    expect((await readFile(result.outputPath)).byteLength).toBeGreaterThan(0);
    expect(JSON.parse(await readFile(result.reportPath!, "utf8")).originalSize).toBe(original.byteLength);
    await expect(verifyDesktopFile(result.outputPath)).resolves.toEqual({ ok: true });
  });

  it("reports staged optimization progress", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-desktop-"));
    const inputPath = join(dir, "input.hwpx");
    await writeFile(inputPath, await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } }));
    const progress: Array<{ percent: number; item: string }> = [];

    await optimizeDesktopFile(
      {
        filePath: inputPath,
        mode: "safe",
        settings: defaultDesktopSettings
      },
      (item) => progress.push(item)
    );

    expect(progress.map((item) => item.item)).toEqual([
      "Reading HWPX package",
      "Optimizing document in safe mode",
      "Writing optimized document",
      "Writing JSON report",
      "Finalizing optimized document"
    ]);
    expect(progress.map((item) => item.percent)).toEqual([10, 35, 70, 82, 92]);
  });

  it("prevents overwriting existing optimized files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-desktop-"));
    const inputPath = join(dir, "input.hwpx");
    await writeFile(inputPath, await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } }));
    await writeFile(join(dir, "input.optimized.hwpx"), Buffer.from("existing"));

    const result = await optimizeDesktopFile({
      filePath: inputPath,
      mode: "safe",
      settings: defaultDesktopSettings
    });

    expect(result.outputPath).toBe(join(dir, "input.optimized-2.hwpx"));
  });

  it("writes to a configured output directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-desktop-"));
    const outputDirectory = join(dir, "out");
    const inputPath = join(dir, "input.hwpx");
    await mkdir(outputDirectory);
    await writeFile(inputPath, await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } }));

    const result = await optimizeDesktopFile({
      filePath: inputPath,
      mode: "safe",
      outputDirectory,
      settings: { ...defaultDesktopSettings, saveNextToOriginal: false }
    });

    expect(result.outputPath).toBe(join(outputDirectory, "input.optimized.hwpx"));
  });

  it("forwards actions through balanced optimization", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-desktop-"));
    const inputPath = join(dir, "shape.hwpx");
    await writeFile(
      inputPath,
      await createHwpxFixture({
        entries: {
          "Contents/section0.xml": `<root><hp:shapeComment>그림입니다.
원본 그림의 이름: IMG_4242.JPG
원본 그림의 크기: 가로 5712pixel, 세로 4284pixel</hp:shapeComment></root>`
        }
      })
    );

    const result = await optimizeDesktopFile({
      filePath: inputPath,
      mode: "balanced",
      settings: defaultDesktopSettings,
      actions: ["clean-shape-comment"]
    });

    expect(result.report.actions.applied).toContainEqual(
      expect.objectContaining({ type: "clean-shape-comment" })
    );
    expect(result.report.actions.applied.some((action) => action.type === "resize-jpeg")).toBe(false);
  });

  it("preserves explicit empty action selections", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-desktop-"));
    const inputPath = join(dir, "shape.hwpx");
    await writeFile(
      inputPath,
      await createHwpxFixture({
        entries: {
          "Contents/section0.xml": `<root><hp:shapeComment>그림입니다.
원본 그림의 이름: IMG_4242.JPG
원본 그림의 크기: 가로 5712pixel, 세로 4284pixel</hp:shapeComment></root>`
        }
      })
    );

    const result = await optimizeDesktopFile({
      filePath: inputPath,
      mode: "balanced",
      settings: defaultDesktopSettings,
      actions: []
    });

    expect(result.report.actions.applied).not.toContainEqual(
      expect.objectContaining({ type: "clean-shape-comment" })
    );
  });

  it("surfaces invalid HWPX failures", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-desktop-"));
    const inputPath = join(dir, "broken.hwpx");
    await writeFile(inputPath, Buffer.from("not a zip"));

    await expect(analyzeDesktopFile(inputPath)).rejects.toThrow("Invalid HWPX package");
  });
});
