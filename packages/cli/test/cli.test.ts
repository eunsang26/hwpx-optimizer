import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createHwpxFixture } from "../../core/test/fixtures.js";
import { runCli } from "../src/index.js";

describe("runCli", () => {
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
});
