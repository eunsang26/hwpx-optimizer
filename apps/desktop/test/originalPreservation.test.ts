import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHwpxFixture } from "../../../packages/core/test/fixtures.js";
import { analyzeDesktopFile, defaultDesktopSettings, optimizeDesktopFile, registerDesktopInput } from "../src/main/desktopService.js";

let directory: string;
let sourcePath: string;
let source: Buffer;
const overwriteSettings = { ...defaultDesktopSettings, saveNextToOriginal: false, preventOverwrite: false };

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "desktop-origin-"));
  sourcePath = join(directory, "source.hwpx");
  source = await createHwpxFixture({ entries: { "BinData/unused.bin": Buffer.alloc(8192) } });
  await writeFile(sourcePath, source);
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("desktop original protection", () => {
  it("protects an earlier selected input even with overwrite prevention disabled", async () => {
    const outputDirectory = join(directory, "selected-folder");
    await mkdir(outputDirectory);
    const earlierInput = join(outputDirectory, "source_optimized.hwpx");
    await writeFile(earlierInput, source);
    await analyzeDesktopFile(earlierInput, { analysisMode: "quick" });
    await expect(optimizeDesktopFile({ filePath: sourcePath, outputDirectory, mode: "safe", settings: overwriteSettings }))
      .rejects.toThrow(/original selected input/);
    expect(await readFile(earlierInput)).toEqual(source);
    expect(await readFile(sourcePath)).toEqual(source);
  });

  it.each(["hardlink", "symlink"])("protects selected inputs through %s output aliases", async kind => {
    const outputDirectory = join(directory, "out");
    await mkdir(outputDirectory);
    const earlierInput = join(directory, "previous.hwpx");
    await writeFile(earlierInput, source);
    const selected = await registerDesktopInput(earlierInput);
    const alias = join(outputDirectory, "source_optimized.hwpx");
    if (kind === "hardlink") await link(earlierInput, alias);
    else await symlink(earlierInput, alias);
    await expect(optimizeDesktopFile({ filePath: sourcePath, outputDirectory, mode: "safe", settings: overwriteSettings,
      protectedInputs: [selected] })).rejects.toThrow(/original selected input/);
    expect(await readFile(earlierInput)).toEqual(source);
    expect(await readFile(alias)).toEqual(source);
  });

  it("protects a selected input in an existing batch output folder", async () => {
    const outputDirectory = join(directory, "output");
    await mkdir(outputDirectory);
    const selectedPath = join(outputDirectory, "source_optimized.hwpx");
    await writeFile(selectedPath, source);
    const protectedInput = await registerDesktopInput(selectedPath);
    await expect(optimizeDesktopFile({ filePath: sourcePath, mode: "safe", outputMode: "batch",
      settings: overwriteSettings, protectedInputs: [protectedInput] })).rejects.toThrow(/original selected input/);
    expect(await readFile(selectedPath)).toEqual(source);
  });

  it("protects an input aliased by a report before either artifact is written", async () => {
    const earlierInput = join(directory, "earlier.hwpx");
    await writeFile(earlierInput, source);
    const selected = await registerDesktopInput(earlierInput);
    const reportPath = join(directory, "source_optimized.hwpx.report.json");
    await link(earlierInput, reportPath);
    await expect(optimizeDesktopFile({ filePath: sourcePath, mode: "safe", protectedInputs: [selected],
      settings: { ...overwriteSettings, saveReport: true } })).rejects.toThrow(/original selected input/);
    expect(await readFile(earlierInput)).toEqual(source);
    await expect(readFile(join(directory, "source_optimized.hwpx"))).rejects.toThrow();
  });

  it("allows overwriting a generated result that has never been selected as input", async () => {
    const initial = await optimizeDesktopFile({ filePath: sourcePath, mode: "safe", settings: overwriteSettings });
    const repeated = await optimizeDesktopFile({ filePath: sourcePath, mode: "safe", settings: overwriteSettings });
    expect(repeated.outputPath).toBe(initial.outputPath);
    expect(await readFile(sourcePath)).toEqual(source);
  });

  it("retains trusted input protection when the service is recreated like a document worker", async () => {
    const previous = join(directory, "previous.hwpx");
    await writeFile(previous, source);
    const selected = await registerDesktopInput(previous);
    await link(previous, join(directory, "source_optimized.hwpx"));
    vi.resetModules();
    const restarted = await import("../src/main/desktopService.js");
    await expect(restarted.optimizeDesktopFile({ filePath: sourcePath, mode: "safe", settings: overwriteSettings,
      protectedInputs: [selected] })).rejects.toThrow(/original selected input/);
    expect(await readFile(previous)).toEqual(source);
  });
});
