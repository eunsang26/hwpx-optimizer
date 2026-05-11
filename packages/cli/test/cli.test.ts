import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createHwpxFixture } from "../../core/test/fixtures.js";
import { isCliEntrypoint, printAnalysisSummaryForTest, renderHumanReport, runCli } from "../src/index.js";
import type { OptimizationReport } from "@hwpx-optimizer/core";

describe("runCli", () => {
  it("prints the action catalog with list-actions", async () => {
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      logs.push(String(message));
    });

    const code = await runCli(["list-actions"]);
    logSpy.mockRestore();

    expect(code).toBe(0);
    const text = logs.join("\n");
    expect(text).toContain("Available --actions keys");
    expect(text).toContain("strip-metadata");
    expect(text).toContain("convert-bmp-to-png");
    expect(text).toContain("clean-shape-comment");
    expect(text).toContain("consolidate-duplicate-images");
    expect(text).toContain("repack-zip");
  });

  it("recognizes workspace bin symlinks as CLI entrypoints", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-opt-bin-"));
    const target = join(dir, "index.js");
    const link = join(dir, "hwpx-opt");
    await writeFile(target, "#!/usr/bin/env node\n");
    await symlink(target, link);

    expect(isCliEntrypoint(pathToFileURL(target).href, link)).toBe(true);
  });

  it("analyzes a file and writes a report", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-opt-"));
    const inputPath = join(dir, "input.hwpx");
    const reportPath = join(dir, "report.json");
    await writeFile(
      inputPath,
      await createHwpxFixture({
        entries: {
          "Contents/section0.xml": `<root><hp:shapeComment>그림입니다.
원본 그림의 이름: IMG_1234.JPG
원본 그림의 크기: 가로 5712pixel, 세로 4284pixel</hp:shapeComment></root>`
        }
      })
    );
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      logs.push(String(message));
    });

    const code = await runCli(["analyze", inputPath, "--report", reportPath]);
    logSpy.mockRestore();

    expect(code).toBe(0);
    const report = JSON.parse(await readFile(reportPath, "utf8")) as {
      originalSize: number;
      opportunityGroups: Array<{ action: string; count: number }>;
    };
    expect(report.originalSize).toBeGreaterThan(0);
    expect(report.opportunityGroups).toEqual([
      expect.objectContaining({ action: "clean-shape-comment", count: 1 })
    ]);
    expect(logs.join("\n")).toContain("Original:");
    expect(logs.join("\n")).toContain("Opportunities:");
    expect(logs.join("\n")).toContain("clean-shape-comment: 1 target");
    expect(logs.join("\n")).toContain("Suggested: hwpx-opt optimize");
  });

  it("prints non-overlapping total potential savings in human reports", () => {
    const text = renderHumanReport("/x/input.hwpx", {
      ...minimalReport,
      originalSize: 20 * 1024 * 1024,
      opportunityGroups: [
        {
          action: "resize-jpeg",
          label: "Resize JPEG",
          count: 1,
          estimatedSavingBytes: 10 * 1024 * 1024,
          beforeSize: 15,
          afterSize: 5,
          confidence: "estimated",
          risk: "medium",
          visualImpact: "medium",
          defaultEnabledIn: ["balanced", "aggressive"],
          targets: ["BinData/a.jpg"]
        },
        {
          action: "strip-metadata",
          label: "Strip metadata",
          count: 1,
          estimatedSavingBytes: 9 * 1024 * 1024,
          beforeSize: 10,
          afterSize: 1,
          confidence: "estimated",
          risk: "safe",
          visualImpact: "none",
          defaultEnabledIn: ["balanced", "aggressive"],
          targets: ["BinData/a.jpg"]
        }
      ]
    });

    expect(text).toContain("Potential saving (non-overlap): 10.00 MiB");
    expect(text).not.toContain("Potential saving (non-overlap): 19.00 MiB");
  });

  it("prints non-overlapping total potential savings in analyze summaries", () => {
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      logs.push(String(message));
    });

    printAnalysisSummaryForTest("/x/input.hwpx", {
      ...minimalReport,
      originalSize: 20 * 1024 * 1024,
      opportunityGroups: [
        {
          action: "resize-jpeg",
          label: "Resize JPEG",
          count: 1,
          estimatedSavingBytes: 10 * 1024 * 1024,
          beforeSize: 15,
          afterSize: 5,
          confidence: "estimated",
          risk: "medium",
          visualImpact: "medium",
          defaultEnabledIn: ["balanced", "aggressive"],
          targets: ["BinData/a.jpg"]
        },
        {
          action: "strip-metadata",
          label: "Strip metadata",
          count: 1,
          estimatedSavingBytes: 9 * 1024 * 1024,
          beforeSize: 10,
          afterSize: 1,
          confidence: "estimated",
          risk: "safe",
          visualImpact: "none",
          defaultEnabledIn: ["balanced", "aggressive"],
          targets: ["BinData/a.jpg"]
        }
      ]
    });
    logSpy.mockRestore();

    const text = logs.join("\n");
    expect(text).toContain("Potential saving (non-overlap): 10.00 MiB");
    expect(text).not.toContain("Potential saving (non-overlap): 19.00 MiB");
  });

  it("rejects files over the configured input size limit before reading them", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-opt-"));
    const inputPath = join(dir, "large.hwpx");
    await writeFile(inputPath, Buffer.alloc(16));
    const errors: string[] = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation((message?: unknown) => {
      errors.push(String(message));
    });

    const code = await runCli(["verify", inputPath, "--max-input-bytes", "10"]);
    errorSpy.mockRestore();

    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("exceeds the supported local processing limit");
  });

  it("does not overwrite existing analysis reports by default", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-opt-"));
    const inputPath = join(dir, "input.hwpx");
    const reportPath = join(dir, "report.json");
    await writeFile(inputPath, await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } }));
    await writeFile(reportPath, "existing");

    const code = await runCli(["analyze", inputPath, "--report", reportPath]);

    expect(code).toBe(0);
    expect(await readFile(reportPath, "utf8")).toBe("existing");
    expect((await readFile(join(dir, "report-2.json"))).byteLength).toBeGreaterThan(0);
  });

  it("never overwrites the original input file with an analysis report", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-opt-"));
    const inputPath = join(dir, "input.hwpx");
    const original = await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } });
    await writeFile(inputPath, original);

    const code = await runCli(["analyze", inputPath, "--report", inputPath, "--overwrite"]);

    expect(code).toBe(1);
    expect(await readFile(inputPath)).toEqual(original);
  });

  it("prints the protected document policy when analysis rejects a protected HWPX", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-opt-"));
    const inputPath = join(dir, "protected.hwpx");
    await writeFile(
      inputPath,
      await createHwpxFixture({
        entries: {
          "_xmlsignatures/sig1.xml": "<Signature />"
        }
      })
    );
    const errors: string[] = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation((message?: unknown) => {
      errors.push(String(message));
    });

    const code = await runCli(["analyze", inputPath]);
    errorSpy.mockRestore();

    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("보안 처리된 문서는 최적화 대상이 아닙니다");
    expect(errors.join("\n")).toContain("해제하거나 우회하지 않습니다");
  });

  it("optimizes a file and writes output plus report", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-opt-"));
    const inputPath = join(dir, "input.hwpx");
    const outputPath = join(dir, "output.hwpx");
    const reportPath = join(dir, "report.json");
    await writeFile(inputPath, await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } }));

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      logs.push(String(message));
    });

    const code = await runCli(["optimize", inputPath, "--mode", "safe", "--out", outputPath, "--report", reportPath]);
    logSpy.mockRestore();

    expect(code).toBe(0);
    expect((await readFile(outputPath)).byteLength).toBeGreaterThan(0);
    const report = JSON.parse(await readFile(reportPath, "utf8")) as { optimizedSize: number };
    expect(report.optimizedSize).toBeGreaterThan(0);
    expect(logs.join("\n")).toContain("Saved:");
    expect(logs.join("\n")).toContain("Applied:");
  });

  it("does not overwrite existing optimized output files by default", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-opt-"));
    const inputPath = join(dir, "input.hwpx");
    const existingOutput = join(dir, "input.optimized.hwpx");
    await writeFile(inputPath, await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } }));
    await writeFile(existingOutput, "existing");

    const code = await runCli(["optimize", inputPath, "--mode", "safe"]);

    expect(code).toBe(0);
    expect(await readFile(existingOutput, "utf8")).toBe("existing");
    expect((await readFile(join(dir, "input.optimized-2.hwpx"))).byteLength).toBeGreaterThan(0);
    expect((await readFile(join(dir, "input.optimized-2.hwpx.report.json"))).byteLength).toBeGreaterThan(0);
  });

  it("overwrites existing output files only when requested", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-opt-"));
    const inputPath = join(dir, "input.hwpx");
    const outputPath = join(dir, "output.hwpx");
    await writeFile(inputPath, await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } }));
    await writeFile(outputPath, "existing");

    const code = await runCli(["optimize", inputPath, "--mode", "safe", "--out", outputPath, "--overwrite"]);

    expect(code).toBe(0);
    expect(await readFile(outputPath, "utf8")).not.toBe("existing");
  });

  it("never overwrites the original input file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-opt-"));
    const inputPath = join(dir, "input.hwpx");
    const original = await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } });
    await writeFile(inputPath, original);

    const code = await runCli(["optimize", inputPath, "--mode", "safe", "--out", inputPath, "--overwrite"]);

    expect(code).toBe(1);
    expect(await readFile(inputPath)).toEqual(original);
  });

  it("never overwrites the original input file with an optimization report", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-opt-"));
    const inputPath = join(dir, "input.hwpx");
    const outputPath = join(dir, "output.hwpx");
    const original = await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } });
    await writeFile(inputPath, original);

    const code = await runCli([
      "optimize",
      inputPath,
      "--mode",
      "safe",
      "--out",
      outputPath,
      "--report",
      inputPath,
      "--overwrite"
    ]);

    expect(code).toBe(1);
    expect(await readFile(inputPath)).toEqual(original);
  });

  it("accepts balanced mode", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-opt-"));
    const inputPath = join(dir, "input.hwpx");
    const outputPath = join(dir, "output.hwpx");
    const reportPath = join(dir, "report.json");
    await writeFile(inputPath, await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } }));

    const code = await runCli(["optimize", inputPath, "--mode", "balanced", "--out", outputPath, "--report", reportPath]);

    expect(code).toBe(0);
    const report = JSON.parse(await readFile(reportPath, "utf8")) as { originalSize: number };
    expect(report.originalSize).toBeGreaterThan(0);
  });

  it("accepts aggressive mode and records an explicit warning", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-opt-"));
    const inputPath = join(dir, "input.hwpx");
    const outputPath = join(dir, "output.hwpx");
    const reportPath = join(dir, "report.json");
    await writeFile(inputPath, await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } }));

    const code = await runCli(["optimize", inputPath, "--mode", "aggressive", "--out", outputPath, "--report", reportPath]);

    expect(code).toBe(0);
    expect((await readFile(outputPath)).byteLength).toBeGreaterThan(0);
    const report = JSON.parse(await readFile(reportPath, "utf8")) as { warnings: string[] };
    expect(report.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("Aggressive mode prioritizes file size")])
    );
  });

  it("verifies an HWPX file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-opt-"));
    const inputPath = join(dir, "input.hwpx");
    await writeFile(inputPath, await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } }));
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      logs.push(String(message));
    });

    const code = await runCli(["verify", inputPath]);
    logSpy.mockRestore();

    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("Verified:");
  });

  it("writes a human-readable report", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-opt-"));
    const inputPath = join(dir, "input.hwpx");
    const reportPath = join(dir, "report.txt");
    await writeFile(inputPath, await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } }));

    const code = await runCli(["report", inputPath, "--out", reportPath]);

    expect(code).toBe(0);
    const text = await readFile(reportPath, "utf8");
    expect(text).toContain("HWPX Optimization Report");
    expect(text).toContain("Original:");
    expect(text).toContain("Images:");
  });

  it("does not overwrite existing human-readable reports by default", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-opt-"));
    const inputPath = join(dir, "input.hwpx");
    const reportPath = join(dir, "report.txt");
    await writeFile(inputPath, await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } }));
    await writeFile(reportPath, "existing");

    const code = await runCli(["report", inputPath, "--out", reportPath]);

    expect(code).toBe(0);
    expect(await readFile(reportPath, "utf8")).toBe("existing");
    expect(await readFile(join(dir, "report-2.txt"), "utf8")).toContain("HWPX Optimization Report");
  });

  it("never overwrites the original input file with a human-readable report", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-opt-"));
    const inputPath = join(dir, "input.hwpx");
    const original = await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } });
    await writeFile(inputPath, original);

    const code = await runCli(["report", inputPath, "--out", inputPath, "--overwrite"]);

    expect(code).toBe(1);
    expect(await readFile(inputPath)).toEqual(original);
  });

  it("batch-optimizes HWPX files and records per-file failures", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-opt-"));
    const inputDir = join(dir, "docs");
    const outDir = join(dir, "optimized");
    await mkdir(inputDir);
    await writeFile(join(inputDir, "good.hwpx"), await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } }));
    await writeFile(join(inputDir, "bad.hwpx"), Buffer.from("not a zip"));

    const code = await runCli(["batch", inputDir, "--mode", "safe", "--out", outDir]);

    expect(code).toBe(1);
    expect((await readFile(join(outDir, "good.optimized.hwpx"))).byteLength).toBeGreaterThan(0);
    const summary = JSON.parse(await readFile(join(outDir, "batch-report.json"), "utf8")) as {
      results: Array<{ input: string; status: "optimized" | "failed"; error?: string }>;
    };
    expect(summary.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ input: "good.hwpx", status: "optimized" }),
        expect.objectContaining({
          input: "bad.hwpx",
          status: "failed",
          stage: "optimize",
          error: expect.any(String)
        })
      ])
    );
  });

  it("propagates --allow-larger through batch into each file's report", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-opt-"));
    const inputDir = join(dir, "docs");
    const outDir = join(dir, "optimized");
    await mkdir(inputDir);
    await writeFile(
      join(inputDir, "shape.hwpx"),
      await createHwpxFixture({
        entries: {
          "Contents/section0.xml": `<root><hp:shapeComment>그림입니다.
원본 그림의 이름: IMG_5555.JPG
원본 그림의 크기: 가로 5712pixel, 세로 4284pixel</hp:shapeComment></root>`
        }
      })
    );

    const code = await runCli([
      "batch",
      inputDir,
      "--mode",
      "balanced",
      "--actions",
      "clean-shape-comment",
      "--allow-larger",
      "--out",
      outDir
    ]);

    expect(code).toBe(0);
    const reportPath = join(outDir, "shape.optimized.hwpx.report.json");
    const report = JSON.parse(await readFile(reportPath, "utf8")) as {
      actions: { applied: Array<{ type: string }> };
      warnings: string[];
    };
    expect(report.actions.applied).toContainEqual(
      expect.objectContaining({ type: "clean-shape-comment" })
    );
    expect(report.warnings).not.toContain(
      "Balanced mode did not produce a smaller file; original package bytes returned."
    );
  });

  it("does not overwrite existing batch outputs by default", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-opt-"));
    const inputDir = join(dir, "docs");
    const outDir = join(dir, "optimized");
    await mkdir(inputDir);
    await mkdir(outDir);
    await writeFile(join(inputDir, "good.hwpx"), await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } }));
    await writeFile(join(outDir, "good.optimized.hwpx"), "existing");
    await writeFile(join(outDir, "batch-report.json"), "existing batch");

    const code = await runCli(["batch", inputDir, "--mode", "safe", "--out", outDir]);

    expect(code).toBe(0);
    expect(await readFile(join(outDir, "good.optimized.hwpx"), "utf8")).toBe("existing");
    expect(await readFile(join(outDir, "batch-report.json"), "utf8")).toBe("existing batch");
    expect((await readFile(join(outDir, "good.optimized-2.hwpx"))).byteLength).toBeGreaterThan(0);
    expect((await readFile(join(outDir, "batch-report-2.json"))).byteLength).toBeGreaterThan(0);
  });
});

const minimalReport: OptimizationReport = {
  originalSize: 0,
  categorySizes: {
    xml: 0,
    image: 0,
    font: 0,
    ole: 0,
    bindata: 0,
    other: 0
  },
  images: [],
  duplicateImages: [],
  sameVisualDuplicateImages: [],
  unusedBinData: [],
  riskyResources: [],
  actions: { planned: [], applied: [], skipped: [] },
  opportunities: [],
  opportunityGroups: [],
  warnings: []
};
