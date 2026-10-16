import { rmdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyHwpxOutput } from "../../../packages/core/src/verifier.js";
import { createHwpxFixture } from "../../../packages/core/test/fixtures.js";
import { defaultDesktopSettings, optimizeDesktopFile, writeDesktopBatchReport } from "../src/main/desktopService.js";

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "hwpx-desktop-exclusive-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("desktop exclusive artifact boundaries", () => {
  it("produces distinct verified document/report pairs for simultaneous saves", async () => {
    const source = await createHwpxFixture({ entries: {} });
    const input = join(directory, "input.hwpx");
    await writeFile(input, source);
    const results = await Promise.all(Array.from({ length: 6 }, () => optimizeDesktopFile({
      filePath: input, mode: "safe", settings: { ...defaultDesktopSettings, saveReport: true }
    })));
    expect(new Set(results.map((result) => result.outputPath)).size).toBe(6);
    expect(new Set(results.map((result) => result.reportPath)).size).toBe(6);
    for (const result of results) {
      await verifyHwpxOutput(await readFile(result.outputPath));
      expect(JSON.parse(await readFile(result.reportPath!, "utf8")).originalSize).toBe(source.length);
    }
    expect(await readFile(input)).toEqual(source);
    expect(await readdir(directory)).toHaveLength(13);
  });
  it.each(["output", "report"])("preserves a user file replacing the %s reservation before writing", async (kind) => {
    const source = await createHwpxFixture({ entries: {} });
    const input = join(directory, "input.hwpx");
    const output = join(directory, "input_optimized.hwpx");
    const report = `${output}.report.json`;
    const replaced = kind === "output" ? output : report;
    await writeFile(input, source);
    await expect(optimizeDesktopFile({ filePath: input, mode: "safe",
      settings: { ...defaultDesktopSettings, saveReport: true }
    }, (progress) => {
      if (progress.percent === 95 && progress.item === "Writing optimized document") {
        rmdirSync(replaced);
        writeFileSync(replaced, "user file");
      }
    })).rejects.toThrow(/reservation changed/);
    expect(await readFile(input)).toEqual(source);
    expect(await readFile(replaced, "utf8")).toBe("user file");
    expect((await readdir(directory)).sort()).toEqual(["input.hwpx", replaced.slice(directory.length + 1)].sort());
  });
  it("keeps an existing report and allocates a separate name for the new report", async () => {
    const input = join(directory, "input.hwpx");
    await writeFile(input, await createHwpxFixture({ entries: {} }));
    const report = join(directory, "input_optimized.hwpx.report.json");
    await writeFile(report, "existing report");
    const result = await optimizeDesktopFile({ filePath: input, mode: "safe",
      settings: { ...defaultDesktopSettings, saveReport: true }
    });
    expect(result.reportPath).not.toBe(report);
    expect(await readFile(report, "utf8")).toBe("existing report");
    expect(JSON.parse(await readFile(result.reportPath!, "utf8")).originalSize).toBeGreaterThan(0);
  });
  it("publishes distinct batch summaries concurrently", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => writeDesktopBatchReport({
      reportDirectory: directory, mode: "safe", settings: defaultDesktopSettings, items: []
    })));
    expect(new Set(results.map((result) => result.reportPath)).size).toBe(6);
    for (const result of results) expect(JSON.parse(await readFile(result.reportPath, "utf8")).mode).toBe("safe");
    expect(await readdir(directory)).toHaveLength(6);
  });
});
