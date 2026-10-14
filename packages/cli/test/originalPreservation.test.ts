import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHwpxFixture } from "../../core/test/fixtures.js";
import { runCli } from "../src/index.js";

let directory: string;
let input: string;
let original: Buffer;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "hwpx-origin-"));
  input = join(directory, "original.hwpx");
  original = await createHwpxFixture({ entries: {} });
  await writeFile(input, original);
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("CLI original file identity", () => {
  it.each(["analyze", "report", "optimize"])("%s refuses a hardlinked report target before writing", async command => {
    const alias = join(directory, "report.json");
    await link(input, alias);
    const code = await runCli([command, input, "--report", alias, "--overwrite"]);
    expect(code).toBe(1);
    expect(await readFile(input)).toEqual(original);
    expect(await readFile(alias)).toEqual(original);
  });

  it("refuses a hardlinked optimized-document target", async () => {
    const alias = join(directory, "out.hwpx");
    await link(input, alias);
    expect(await runCli(["optimize", input, "--out", alias, "--overwrite"])).toBe(1);
    expect(await readFile(input)).toEqual(original);
    expect(await readFile(alias)).toEqual(original);
  });

  it.each(["output", "report"])("batch refuses a hardlinked %s target", async kind => {
    const outputDirectory = join(directory, "out");
    await mkdir(outputDirectory);
    const alias = join(outputDirectory, `original.optimized.hwpx${kind === "report" ? ".report.json" : ""}`);
    await link(input, alias);
    expect(await runCli(["batch", directory, "--out", outputDirectory, "--overwrite", "--jobs", "1"])).toBe(1);
    expect(await readFile(input)).toEqual(original);
    expect(await readFile(alias)).toEqual(original);
  });

  it("retains the original through a symbolic report alias", async () => {
    const alias = join(directory, "report.txt");
    await symlink(input, alias);
    expect(await runCli(["report", input, "--out", alias, "--overwrite"])).toBe(1);
    expect(await readFile(input)).toEqual(original);
  });

  it.each(["analyze", "report"])("%s can overwrite a different existing report", async command => {
    const path = join(directory, "report.txt");
    await writeFile(path, "old report");
    expect(await runCli([command, input, "--report", path, "--overwrite"])).toBe(0);
    expect(await readFile(input)).toEqual(original);
    expect(await readFile(path, "utf8")).not.toBe("old report");
  });

  it("uses a new report name for a hardlinked existing target without overwrite", async () => {
    const alias = join(directory, "report.json");
    await link(input, alias);
    expect(await runCli(["analyze", input, "--report", alias])).toBe(0);
    expect(await readFile(input)).toEqual(original);
    expect(JSON.parse(await readFile(join(directory, "report-2.json"), "utf8"))).toHaveProperty("originalSize");
  });
});
