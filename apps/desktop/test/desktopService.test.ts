import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createHwpxFixture } from "../../../packages/core/test/fixtures.js";
import {
  analyzeDesktopFile,
  defaultDesktopSettings,
  normalizeDesktopSettings,
  optimizeDesktopFile,
  previewImageDiffs,
  persistentDesktopSettingsPatch,
  verifyDesktopFile,
  warmDesktopCore,
  writeDesktopBatchReport
} from "../src/main/desktopService.js";
import type { DesktopSettings } from "../src/main/desktopService.js";

describe("desktop service", () => {
  it("defines submission UI defaults in desktop settings", () => {
    const settings: DesktopSettings = defaultDesktopSettings;

    expect(settings.defaultMode).toBe("balanced");
    expect(settings.submissionLimit).toEqual({ id: "mb40" });
    expect(settings.preservationPreference).toBe("recommended");
    expect(settings.batchTargetMode).toBe("per-file");
    expect(settings.saveReport).toBe(false);
  });

  it("migrates legacy recommended safe defaults to balanced mode", () => {
    expect(
      normalizeDesktopSettings({
        defaultMode: "safe",
        preservationPreference: "recommended"
      }).defaultMode
    ).toBe("balanced");
  });

  it("migrates legacy mb41 submission limit to mb40", () => {
    expect(
      normalizeDesktopSettings({
        submissionLimit: { id: "mb41" }
      }).submissionLimit
    ).toEqual({ id: "mb40" });
  });

  it("analyzes, optimizes, skips report by default, and preserves the source file", async () => {
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
    expect(result.outputPath).toBe(join(dir, "input_optimized.hwpx"));
    expect(result.reportPath).toBeUndefined();
    expect((await readFile(result.outputPath)).byteLength).toBeGreaterThan(0);
    await expect(verifyDesktopFile(result.outputPath)).resolves.toEqual({ ok: true });
  });

  it("uses quick analysis by default for lower-latency desktop planning", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-desktop-"));
    const inputPath = join(dir, "input.hwpx");
    const png = await import("sharp").then(({ default: sharp }) =>
      sharp({
        create: {
          width: 16,
          height: 10,
          channels: 3,
          background: "#000000"
        }
      })
        .png()
        .toBuffer()
    );
    await writeFile(
      inputPath,
      await createHwpxFixture({
        entries: {
          "Contents/section0.xml": '<root><img href="BinData/image1.png" /><img href="BinData/image2.png" /></root>',
          "BinData/image1.png": png,
          "BinData/image2.png": png
        }
      })
    );

    const analysis = await analyzeDesktopFile(inputPath);

    expect(analysis.report.performance?.stages.map((stage) => stage.name)).toContain("analyze");
    expect(analysis.report.sameVisualDuplicateImages).toEqual([]);
    expect(analysis.report.nearDuplicateImages).toEqual([]);
  });

  it("can warm the desktop core module before the first document operation", async () => {
    await expect(warmDesktopCore()).resolves.toEqual({ ok: true });
  });

  it("writes a report only when explicitly enabled", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-desktop-"));
    const inputPath = join(dir, "input.hwpx");
    const original = await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } });
    await writeFile(inputPath, original);

    const result = await optimizeDesktopFile({
      filePath: inputPath,
      mode: "safe",
      settings: { ...defaultDesktopSettings, saveReport: true }
    });

    expect(result.reportPath).toBe(`${result.outputPath}.report.json`);
    expect(JSON.parse(await readFile(result.reportPath!, "utf8")).originalSize).toBe(original.byteLength);
  });

  it("reports granular optimization progress", async () => {
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
      "Analyzing document structure",
      "Planning safe changes",
      "Applying safe document cleanup",
      "Packing optimized document",
      "Verifying optimized document",
      "Preparing output file",
      "Writing optimized document",
      "Finalizing optimized document"
    ]);
    expect(progress.map((item) => item.percent)).toEqual([10, 25, 40, 52, 72, 82, 88, 95, 99]);
  });

  it("redacts persisted settings that would store local paths or unknown keys", () => {
    expect(
      persistentDesktopSettingsPatch({
        saveReport: true,
        submissionLimit: { id: "mb40" },
        saveNextToOriginal: false,
        outputDirectory: "/private/reports",
        recentFiles: ["/private/input.hwpx"],
        reportPath: "/private/input.report.json"
      })
    ).toEqual({
      saveReport: true,
      submissionLimit: { id: "mb40" }
    });
  });

  it("persists valid batch target mode settings", () => {
    expect(
      persistentDesktopSettingsPatch({
        batchTargetMode: "per-file"
      })
    ).toEqual({ batchTargetMode: "per-file" });
  });

  it("prevents overwriting existing optimized files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-desktop-"));
    const inputPath = join(dir, "input.hwpx");
    await writeFile(inputPath, await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } }));
    await writeFile(join(dir, "input_optimized.hwpx"), Buffer.from("existing"));

    const result = await optimizeDesktopFile({
      filePath: inputPath,
      mode: "safe",
      settings: defaultDesktopSettings
    });

    expect(result.outputPath).toBe(join(dir, "input_optimized-2.hwpx"));
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

    expect(result.outputPath).toBe(join(outputDirectory, "input_optimized.hwpx"));
  });

  it("does not leave final output files when report finalization fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-desktop-"));
    const inputPath = join(dir, "input.hwpx");
    const outputPath = join(dir, "input_optimized.hwpx");
    await writeFile(inputPath, await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } }));
    await mkdir(`${outputPath}.report.json`);

    await expect(
      optimizeDesktopFile({
        filePath: inputPath,
        mode: "safe",
        settings: { ...defaultDesktopSettings, saveReport: true }
      })
    ).rejects.toThrow();

    await expect(readFile(outputPath)).rejects.toThrow();
    expect((await readdir(dir)).filter((name) => name.includes(".tmp-"))).toEqual([]);
  });

  it("writes batch output to a dedicated output folder by default", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-desktop-"));
    const inputPath = join(dir, "input.hwpx");
    await writeFile(inputPath, await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } }));

    const result = await optimizeDesktopFile({
      filePath: inputPath,
      mode: "safe",
      outputMode: "batch",
      settings: defaultDesktopSettings
    });

    expect(result.outputPath).toBe(join(dir, "output", "input_optimized.hwpx"));
  });

  it("writes batch output under a dedicated output folder inside a configured directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-desktop-"));
    const outputDirectory = join(dir, "selected");
    const inputPath = join(dir, "input.hwpx");
    await mkdir(outputDirectory);
    await writeFile(inputPath, await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } }));

    const result = await optimizeDesktopFile({
      filePath: inputPath,
      mode: "safe",
      outputDirectory,
      outputMode: "batch",
      settings: defaultDesktopSettings
    });

    expect(result.outputPath).toBe(join(outputDirectory, "output", "input_optimized.hwpx"));
  });

  it("writes a non-overwriting desktop batch report", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-desktop-batch-"));
    await writeFile(join(dir, "batch-report.json"), "existing");

    const result = await writeDesktopBatchReport({
      reportDirectory: dir,
      mode: "balanced",
      settings: defaultDesktopSettings,
      items: [
        {
          input: "input.hwpx",
          status: "done",
          output: join(dir, "input_optimized.hwpx"),
          savedBytes: 1024,
          savedPercent: 12.5
        },
        {
          input: "broken.hwpx",
          status: "failed",
          error: "Invalid HWPX package"
        }
      ]
    });

    expect(result.reportPath).toBe(join(dir, "batch-report-2.json"));
    const report = JSON.parse(await readFile(result.reportPath, "utf8")) as {
      mode: string;
      totals: { done: number; failed: number; savedBytes: number };
      items: Array<{ input: string; status: string }>;
    };
    expect(report.mode).toBe("balanced");
    expect(report.totals).toMatchObject({ done: 1, failed: 1, cancelled: 0, savedBytes: 1024 });
    expect(report.items).toHaveLength(2);
    expect(await readFile(join(dir, "batch-report.json"), "utf8")).toBe("existing");
  });

  it("writes aggregate target status into desktop batch reports", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-desktop-batch-"));

    const result = await writeDesktopBatchReport({
      reportDirectory: dir,
      mode: "balanced",
      settings: defaultDesktopSettings,
      batchTargetBytes: 2_000,
      items: [
        {
          input: "a.hwpx",
          status: "done",
          output: join(dir, "a_optimized.hwpx"),
          originalSize: 3_000,
          optimizedSize: 1_400,
          savedBytes: 1_600,
          savedPercent: 53.33
        },
        {
          input: "b.hwpx",
          status: "done",
          output: join(dir, "b_optimized.hwpx"),
          originalSize: 2_000,
          optimizedSize: 900,
          savedBytes: 1_100,
          savedPercent: 55
        }
      ]
    });

    const report = JSON.parse(await readFile(result.reportPath, "utf8")) as {
      totals: {
        batchTargetBytes: number;
        batchTargetStatus: string;
        batchTargetMissReason?: string;
        totalOriginalSize: number;
        totalOptimizedSize: number;
      };
    };
    expect(report.totals.batchTargetBytes).toBe(2_000);
    expect(report.totals.batchTargetStatus).toBe("missed");
    expect(report.totals.batchTargetMissReason).toContain("aggregate");
    expect(report.totals.totalOriginalSize).toBe(5_000);
    expect(report.totals.totalOptimizedSize).toBe(2_300);
  });

  it("treats an exact aggregate size as missed under 미만 semantics", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-desktop-batch-eq-"));

    const result = await writeDesktopBatchReport({
      reportDirectory: dir,
      mode: "balanced",
      settings: defaultDesktopSettings,
      batchTargetBytes: 2_300,
      items: [
        {
          input: "a.hwpx",
          status: "done",
          output: join(dir, "a_optimized.hwpx"),
          originalSize: 3_000,
          optimizedSize: 1_400,
          savedBytes: 1_600,
          savedPercent: 53.33
        },
        {
          input: "b.hwpx",
          status: "done",
          output: join(dir, "b_optimized.hwpx"),
          originalSize: 2_000,
          optimizedSize: 900,
          savedBytes: 1_100,
          savedPercent: 55
        }
      ]
    });

    const report = JSON.parse(await readFile(result.reportPath, "utf8")) as {
      totals: { batchTargetStatus: string; totalOptimizedSize: number; batchTargetBytes: number };
    };
    expect(report.totals.totalOptimizedSize).toBe(2_300);
    expect(report.totals.batchTargetBytes).toBe(2_300);
    expect(report.totals.batchTargetStatus).toBe("missed");
  });

  it("does not mark aggregate desktop batch targets as met when any item is incomplete", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-desktop-batch-"));

    const result = await writeDesktopBatchReport({
      reportDirectory: dir,
      mode: "balanced",
      settings: defaultDesktopSettings,
      batchTargetBytes: 10_000,
      items: [
        {
          input: "a.hwpx",
          status: "done",
          output: join(dir, "a_optimized.hwpx"),
          originalSize: 3_000,
          optimizedSize: 1_400,
          savedBytes: 1_600,
          savedPercent: 53.33
        },
        {
          input: "broken.hwpx",
          status: "failed",
          originalSize: 4_000,
          error: "Invalid HWPX package"
        }
      ]
    });

    const report = JSON.parse(await readFile(result.reportPath, "utf8")) as {
      totals: {
        batchTargetBytes: number;
        batchTargetStatus: string;
        batchTargetMissReason?: string;
        totalOriginalSize: number;
        totalOptimizedSize: number;
      };
    };
    expect(report.totals.batchTargetBytes).toBe(10_000);
    expect(report.totals.batchTargetStatus).toBe("missed");
    expect(report.totals.batchTargetMissReason).toContain("failed or were cancelled");
    expect(report.totals.totalOriginalSize).toBe(7_000);
    expect(report.totals.totalOptimizedSize).toBe(5_400);
  });

  it("rejects invalid batch report payload values at runtime", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-desktop-batch-"));

    await expect(
      writeDesktopBatchReport({
        reportDirectory: dir,
        mode: "maximum" as never,
        settings: defaultDesktopSettings,
        items: []
      })
    ).rejects.toThrow(/invalid batch report mode/i);

    await expect(
      writeDesktopBatchReport({
        reportDirectory: dir,
        mode: "balanced",
        settings: defaultDesktopSettings,
        items: [{ input: "a.hwpx", status: "complete" as never }]
      })
    ).rejects.toThrow(/invalid batch report item status/i);

    await expect(
      writeDesktopBatchReport({
        reportDirectory: dir,
        mode: "balanced",
        settings: defaultDesktopSettings,
        items: [{ input: "a.hwpx", status: "done", savedBytes: Number.POSITIVE_INFINITY }]
      })
    ).rejects.toThrow(/invalid batch report number/i);
  });

  it("rejects image preview requests that would require loading too many bytes at once", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-desktop-"));
    const originalPath = join(dir, "original.hwpx");
    const optimizedPath = join(dir, "optimized.hwpx");
    await writeFile(originalPath, Buffer.alloc(8));
    await writeFile(optimizedPath, Buffer.alloc(8));

    await expect(previewImageDiffs(originalPath, optimizedPath, { maxInputBytes: 10 })).rejects.toThrow(
      "too large for image preview"
    );
  });

  it("rejects optimization inputs over the configured local processing limit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-desktop-"));
    const inputPath = join(dir, "large.hwpx");
    await writeFile(inputPath, Buffer.alloc(16));

    await expect(
      optimizeDesktopFile({
        filePath: inputPath,
        mode: "safe",
        settings: defaultDesktopSettings,
        maxInputBytes: 10
      })
    ).rejects.toThrow("exceeds the supported local processing limit");
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

  it("passes submission limits to core optimization as target bytes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-desktop-"));
    const inputPath = join(dir, "input.hwpx");
    await writeFile(inputPath, await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } }));

    const result = await optimizeDesktopFile({
      filePath: inputPath,
      mode: "balanced",
      settings: {
        ...defaultDesktopSettings,
        submissionLimit: { id: "custom", customBytes: 1 }
      }
    });

    expect(result.report.targetBytes).toBe(1);
    expect(result.report.targetStatus).toBe("missed");
  });

  it("allows desktop optimization calls to override the saved submission limit target", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-desktop-"));
    const inputPath = join(dir, "input.hwpx");
    await writeFile(inputPath, await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } }));

    const result = await optimizeDesktopFile({
      filePath: inputPath,
      mode: "balanced",
      settings: defaultDesktopSettings,
      targetBytes: 1
    });

    expect(result.report.targetBytes).toBe(1);
    expect(result.report.targetStatus).toBe("missed");
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
