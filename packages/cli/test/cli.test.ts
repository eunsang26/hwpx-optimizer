import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import JSZip from "jszip";
import { createHwpxFixture, createReportLikeHwpxFixture } from "../../core/test/fixtures.js";
import {
  isCliEntrypoint,
  optimizeByMode,
  parseBatchJobs,
  printAnalysisSummaryForTest,
  renderHumanReport,
  runBatch,
  runCli
} from "../src/index.js";
import type { OptimizationReport } from "@hwpx-optimizer/core";

async function unzipEntryNames(buf: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buf);
  return Object.keys(zip.files).sort();
}

describe("runCli", () => {
  it("documents target options anywhere they are accepted", async () => {
    const errors: string[] = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation((message?: unknown) => {
      errors.push(String(message));
    });

    const code = await runCli([]);
    errorSpy.mockRestore();

    expect(code).toBe(1);
    const usage = errors.join("\n");
    expect(usage).toContain("analyze <file.hwpx> [--report report.json] [--analysis-mode quick|deep]");
    expect(usage).toContain(
      "batch <directory> --mode safe|balanced|aggressive [--target-bytes bytes|--target-mb mb] [--batch-target-bytes bytes|--batch-target-mb mb]"
    );
    expect(usage).toContain("[--jobs count]");
  });

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
    expect(text).toContain("Remove JPEG XMP/IPTC/comment segments while preserving EXIF orientation");
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

  it("accepts deep analysis mode for precision diagnostics", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-opt-"));
    const inputPath = join(dir, "input.hwpx");
    const reportPath = join(dir, "report.json");
    const png = await sharp({
      create: { width: 16, height: 10, channels: 3, background: "#000000" }
    })
      .png()
      .toBuffer();
    const input = await createHwpxFixture({
      entries: {
        "Contents/section0.xml": "<root />",
        "BinData/a.png": png,
        "BinData/b.bmp": createBmp24(16, 10)
      }
    });
    await writeFile(inputPath, input);

    const code = await runCli(["analyze", inputPath, "--report", reportPath, "--analysis-mode", "deep"]);

    expect(code).toBe(0);
    const report = JSON.parse(await readFile(reportPath, "utf8")) as {
      sameVisualDuplicateImages: Array<{ paths: string[] }>;
    };
    expect(report.sameVisualDuplicateImages).toEqual([
      expect.objectContaining({ paths: ["BinData/a.png", "BinData/b.bmp"] })
    ]);
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

  it("rejects output flags without path values", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-opt-"));
    const inputPath = join(dir, "input.hwpx");
    await writeFile(inputPath, await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } }));
    const errors: string[] = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation((message?: unknown) => {
      errors.push(String(message));
    });

    const optimizeCode = await runCli(["optimize", inputPath, "--mode", "safe", "--out", "--overwrite"]);
    const reportCode = await runCli(["report", inputPath, "--out"]);
    errorSpy.mockRestore();

    expect(optimizeCode).toBe(1);
    expect(reportCode).toBe(1);
    expect(errors.join("\n")).toContain("Missing value for --out");
  });

  it("accepts --target-bytes and records target status in optimization reports", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-opt-"));
    const inputPath = join(dir, "input.hwpx");
    const outputPath = join(dir, "output.hwpx");
    const reportPath = join(dir, "report.json");
    await writeFile(inputPath, await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } }));

    const code = await runCli([
      "optimize",
      inputPath,
      "--mode",
      "balanced",
      "--target-bytes",
      "1",
      "--out",
      outputPath,
      "--report",
      reportPath
    ]);

    expect(code).toBe(0);
    const report = JSON.parse(await readFile(reportPath, "utf8")) as {
      targetBytes: number;
      targetStatus: string;
      targetMissReason?: string;
    };
    expect(report.targetBytes).toBe(1);
    expect(report.targetStatus).toBe("missed");
    expect(report.targetMissReason).toContain("quality-preserving");
  });

  it("accepts --target-mb and rejects invalid target values", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-opt-"));
    const inputPath = join(dir, "input.hwpx");
    await writeFile(inputPath, await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } }));
    const errors: string[] = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation((message?: unknown) => {
      errors.push(String(message));
    });

    const ok = await runCli(["optimize", inputPath, "--mode", "safe", "--target-mb", "10"]);
    const bad = await runCli(["optimize", inputPath, "--mode", "safe", "--target-bytes", "0"]);
    errorSpy.mockRestore();

    expect(ok).toBe(0);
    expect(bad).toBe(1);
    expect(errors.join("\n")).toContain("--target-bytes must be a positive number");
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

  it("includes result insights in human-readable report command output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-opt-"));
    const inputPath = join(dir, "shape.hwpx");
    const reportPath = join(dir, "report.txt");
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

    const code = await runCli(["report", inputPath, "--out", reportPath]);

    expect(code).toBe(0);
    const text = await readFile(reportPath, "utf8");
    expect(text).toContain("결과 해석:");
    expect(text).toContain("가장 큰 절감 후보: clean-shape-comment");
  });

  it("accepts --report as an alias for human-readable report output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-opt-"));
    const inputPath = join(dir, "input.hwpx");
    const reportPath = join(dir, "custom-report.txt");
    await writeFile(inputPath, await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } }));

    const code = await runCli(["report", inputPath, "--report", reportPath, "--overwrite"]);

    expect(code).toBe(0);
    await expect(readFile(reportPath, "utf8")).resolves.toContain("HWPX Optimization Report");
  });

  it("includes target and diagnostic sections in human reports", () => {
    const text = renderHumanReport("/x/input.hwpx", {
      ...minimalReport,
      originalSize: 12 * 1024 * 1024,
      targetBytes: 10 * 1024 * 1024,
      targetStatus: "missed",
      targetMissReason: "No quality-preserving candidate reached the target.",
      nearDuplicateImages: [
        {
          hash: "near",
          paths: ["BinData/a.jpg", "BinData/b.jpg"],
          count: 2,
          totalBytes: 100,
          wastedBytes: 40,
          maxDistance: 3,
          reason: "Review manually."
        }
      ],
      resourceDiagnostics: [
        {
          type: "large-ole",
          kind: "ole",
          paths: ["BinData/a.ole"],
          sizeBytes: 123,
          reason: "Large OLE resource."
        }
      ]
    });

    expect(text).toContain("Target: 10.00 MiB (missed)");
    expect(text).toContain("Near-duplicate image candidates: 1");
    expect(text).toContain("Resource diagnostics: 1");
  });

  it("adds concise result insights to human reports", () => {
    const text = renderHumanReport("/x/input.hwpx", {
      ...minimalReport,
      originalSize: 20 * 1024 * 1024,
      targetBytes: 10 * 1024 * 1024,
      targetStatus: "missed",
      targetMissReason: "No quality-preserving candidate reached the target.",
      opportunityGroups: [
        {
          action: "resize-jpeg",
          label: "Resize JPEG",
          count: 2,
          estimatedSavingBytes: 8 * 1024 * 1024,
          beforeSize: 12,
          afterSize: 4,
          confidence: "estimated",
          risk: "medium",
          visualImpact: "medium",
          defaultEnabledIn: ["balanced", "aggressive"],
          targets: ["BinData/a.jpg", "BinData/b.jpg"]
        }
      ],
      actions: {
        planned: [],
        applied: [],
        skipped: [{ type: "resize-png", target: "BinData/c.png", beforeSize: 10, afterSize: 12 }]
      },
      performance: {
        totalMs: 1234,
        stages: [
          { name: "read", durationMs: 10 },
          { name: "analyze", durationMs: 900 },
          { name: "write", durationMs: 324 }
        ]
      }
    });

    expect(text).toContain("결과 해석:");
    expect(text).toContain("- 목표 미달: No quality-preserving candidate reached the target.");
    expect(text).toContain("- 가장 큰 절감 후보: resize-jpeg 2개, 약 8.00 MiB");
    expect(text).toContain("- 보류된 작업: resize-png 1개");
    expect(text).toContain("- 처리 시간: 총 1.23s, 최장 단계 analyze 900.0ms");
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
      totals: { optimized: number; failed: number; totalSavedBytes: number };
      results: Array<{ input: string; status: "optimized" | "failed"; error?: string }>;
    };
    expect(summary.totals).toMatchObject({ optimized: 1, failed: 1 });
    expect(summary.totals.totalSavedBytes).toBeGreaterThanOrEqual(0);
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

  it("records the configured batch worker limit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-opt-"));
    const inputDir = join(dir, "docs");
    const outDir = join(dir, "optimized");
    await mkdir(inputDir);
    await writeFile(join(inputDir, "one.hwpx"), await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } }));
    await writeFile(join(inputDir, "two.hwpx"), await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } }));

    const code = await runCli(["batch", inputDir, "--mode", "safe", "--out", outDir, "--jobs", "2"]);

    expect(code).toBe(0);
    const summary = JSON.parse(await readFile(join(outDir, "batch-report.json"), "utf8")) as {
      jobs: number;
      results: Array<{ input: string; status: "optimized" | "failed" }>;
    };
    expect(summary.jobs).toBe(2);
    expect(summary.results).toHaveLength(2);
    expect(summary.results.every((result) => result.status === "optimized")).toBe(true);
  });

  it("allocates aggregate batch targets across files and records total target status", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-opt-"));
    const inputDir = join(dir, "docs");
    const outDir = join(dir, "optimized");
    await mkdir(inputDir);
    await writeFile(join(inputDir, "small.hwpx"), await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } }));
    await writeFile(
      join(inputDir, "large.hwpx"),
      await createHwpxFixture({
        entries: {
          "Contents/section0.xml": "<root />",
          "BinData/pad.bin": Buffer.alloc(4096, 1)
        }
      })
    );

    const code = await runCli(["batch", inputDir, "--mode", "safe", "--batch-target-bytes", "100", "--out", outDir]);

    expect(code).toBe(0);
    const summary = JSON.parse(await readFile(join(outDir, "batch-report.json"), "utf8")) as {
      totals: {
        optimized: number;
        failed: number;
        batchTargetBytes: number;
        batchTargetStatus: string;
        batchTargetMissReason?: string;
        totalOriginalSize: number;
        totalOptimizedSize: number;
      };
    };
    const smallReport = JSON.parse(await readFile(join(outDir, "small.optimized.hwpx.report.json"), "utf8")) as {
      targetBytes: number;
    };
    const largeReport = JSON.parse(await readFile(join(outDir, "large.optimized.hwpx.report.json"), "utf8")) as {
      targetBytes: number;
    };
    expect(summary.totals.optimized).toBe(2);
    expect(summary.totals.failed).toBe(0);
    expect(summary.totals.batchTargetBytes).toBe(100);
    expect(summary.totals.batchTargetStatus).toBe("missed");
    expect(summary.totals.batchTargetMissReason).toContain("aggregate");
    expect(summary.totals.totalOriginalSize).toBeGreaterThan(summary.totals.batchTargetBytes);
    expect(summary.totals.totalOptimizedSize).toBeGreaterThan(summary.totals.batchTargetBytes);
    expect(smallReport.targetBytes + largeReport.targetBytes).toBeLessThanOrEqual(100);
    expect(largeReport.targetBytes).toBeGreaterThan(smallReport.targetBytes);
  });

  it("does not mark aggregate batch targets as met when any input fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-opt-"));
    const inputDir = join(dir, "docs");
    const outDir = join(dir, "optimized");
    await mkdir(inputDir);
    await writeFile(join(inputDir, "valid.hwpx"), await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } }));
    await writeFile(join(inputDir, "broken.hwpx"), Buffer.from("not a zip"));

    const code = await runCli(["batch", inputDir, "--mode", "safe", "--batch-target-bytes", "1000000", "--out", outDir]);

    expect(code).toBe(1);
    const summary = JSON.parse(await readFile(join(outDir, "batch-report.json"), "utf8")) as {
      totals: {
        optimized: number;
        failed: number;
        batchTargetBytes: number;
        batchTargetStatus: string;
        batchTargetMissReason?: string;
        totalOriginalSize: number;
        totalOptimizedSize: number;
      };
    };
    expect(summary.totals.optimized).toBe(1);
    expect(summary.totals.failed).toBe(1);
    expect(summary.totals.batchTargetBytes).toBe(1_000_000);
    expect(summary.totals.batchTargetStatus).toBe("missed");
    expect(summary.totals.batchTargetMissReason).toContain("failed");
    expect(summary.totals.totalOriginalSize).toBeGreaterThan(0);
    expect(summary.totals.totalOptimizedSize).toBeGreaterThan(0);
  });

  it("rejects mixing per-file and aggregate batch targets", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-opt-"));
    const inputDir = join(dir, "docs");
    await mkdir(inputDir);

    const code = await runCli(["batch", inputDir, "--mode", "safe", "--target-mb", "1", "--batch-target-mb", "2"]);

    expect(code).toBe(1);
  });

  it("rejects aggregate batch targets that cannot allocate at least one byte per file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-opt-"));
    const inputDir = join(dir, "docs");
    await mkdir(inputDir);
    await writeFile(join(inputDir, "one.hwpx"), await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } }));
    await writeFile(join(inputDir, "two.hwpx"), await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } }));

    const code = await runCli(["batch", inputDir, "--mode", "safe", "--batch-target-bytes", "1"]);

    expect(code).toBe(1);
  });

  it("rejects invalid batch worker limits", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-opt-"));
    const inputDir = join(dir, "docs");
    await mkdir(inputDir);

    const code = await runCli(["batch", inputDir, "--mode", "safe", "--jobs", "0"]);

    expect(code).toBe(1);
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

  it("never overwrites any batch input file when output directory overlaps", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-opt-"));
    const inputDir = join(dir, "docs");
    await mkdir(inputDir);
    await writeFile(join(inputDir, "good.hwpx"), await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } }));
    const existingInput = await createHwpxFixture({ entries: { "Contents/section0.xml": "<existing />" } });
    await writeFile(join(inputDir, "good.optimized.hwpx"), existingInput);

    const code = await runCli(["batch", inputDir, "--mode", "safe", "--out", inputDir, "--overwrite"]);

    expect(code).toBe(1);
    expect(await readFile(join(inputDir, "good.optimized.hwpx"))).toEqual(existingInput);
  });

  it("batch output matches sequential optimizeByMode (semantic parity) and records jobs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "batch-"));
    const outDir = join(dir, "out");
    await writeFile(join(dir, "one.hwpx"), await createReportLikeHwpxFixture());
    await writeFile(join(dir, "two.hwpx"), await createReportLikeHwpxFixture());

    await runBatch(dir, { mode: "safe", out: outDir, jobs: "2" });

    const files = (await readdir(outDir)).filter((f) => f.endsWith(".optimized.hwpx"));
    expect(files.length).toBe(2);
    // semantic parity: unzip an output and the sequential result, compare entry data
    const seq = await optimizeByMode(await createReportLikeHwpxFixture(), "safe", {}, undefined);
    const batchOut = await readFile(join(outDir, files.sort()[0]));
    expect(await unzipEntryNames(batchOut)).toEqual(await unzipEntryNames(seq.output));

    const report = JSON.parse(await readFile(join(outDir, "batch-report.json"), "utf8"));
    expect(report.totals.optimized).toBe(2);
    expect(report.jobsRequested).toBe(2);
    expect(report.jobsEffective).toBe(2);
    await rm(dir, { recursive: true, force: true });
  });
});

describe("parseBatchJobs", () => {
  it("maps 'max' to the core count", () => {
    expect(parseBatchJobs("max")).toBe(availableParallelism());
  });
  it("honors an explicit number above 4", () => {
    expect(parseBatchJobs("8")).toBe(8);
  });
  it("rejects invalid values", () => {
    expect(() => parseBatchJobs("0")).toThrow(/positive integer or "max"/);
    expect(() => parseBatchJobs("-2")).toThrow(/positive integer or "max"/);
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

function createBmp24(width: number, height: number): Buffer {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelDataSize = rowSize * height;
  const fileSize = 54 + pixelDataSize;
  const buffer = Buffer.alloc(fileSize);
  buffer.write("BM", 0, "ascii");
  buffer.writeUInt32LE(fileSize, 2);
  buffer.writeUInt32LE(54, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(pixelDataSize, 34);
  return buffer;
}
