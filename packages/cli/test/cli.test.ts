import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createHwpxFixture } from "../../core/test/fixtures.js";
import { isCliEntrypoint, runCli } from "../src/index.js";

describe("runCli", () => {
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

  it("batch-optimizes HWPX files and records per-file failures", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-opt-"));
    const inputDir = join(dir, "docs");
    const outDir = join(dir, "optimized");
    await mkdir(inputDir);
    await writeFile(join(inputDir, "good.hwpx"), await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } }));
    await writeFile(join(inputDir, "bad.hwpx"), Buffer.from("not a zip"));

    const code = await runCli(["batch", inputDir, "--mode", "safe", "--out", outDir]);

    expect(code).toBe(0);
    expect((await readFile(join(outDir, "good.optimized.hwpx"))).byteLength).toBeGreaterThan(0);
    const summary = JSON.parse(await readFile(join(outDir, "batch-report.json"), "utf8")) as {
      results: Array<{ input: string; status: "optimized" | "failed"; error?: string }>;
    };
    expect(summary.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ input: "good.hwpx", status: "optimized" }),
        expect.objectContaining({ input: "bad.hwpx", status: "failed", error: expect.any(String) })
      ])
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
