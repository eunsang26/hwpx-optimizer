import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createHwpxFixture } from "../../core/test/fixtures.js";
import { runCli } from "../src/index.js";

describe("runCli", () => {
  it("analyzes a file and writes a report", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-opt-"));
    const inputPath = join(dir, "input.hwpx");
    const reportPath = join(dir, "report.json");
    await writeFile(inputPath, await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } }));

    const code = await runCli(["analyze", inputPath, "--report", reportPath]);

    expect(code).toBe(0);
    const report = JSON.parse(await readFile(reportPath, "utf8")) as { originalSize: number };
    expect(report.originalSize).toBeGreaterThan(0);
  });

  it("optimizes a file and writes output plus report", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-opt-"));
    const inputPath = join(dir, "input.hwpx");
    const outputPath = join(dir, "output.hwpx");
    const reportPath = join(dir, "report.json");
    await writeFile(inputPath, await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } }));

    const code = await runCli(["optimize", inputPath, "--mode", "safe", "--out", outputPath, "--report", reportPath]);

    expect(code).toBe(0);
    expect((await readFile(outputPath)).byteLength).toBeGreaterThan(0);
    const report = JSON.parse(await readFile(reportPath, "utf8")) as { optimizedSize: number };
    expect(report.optimizedSize).toBeGreaterThan(0);
  });
});
