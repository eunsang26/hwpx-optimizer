import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PathClaimRegistry } from "../src/pathClaims.js";
import { runBatch } from "../src/index.js";
import { verifyHwpxOutput } from "../../core/src/verifier.js";
import { createHwpxFixture } from "../../core/test/fixtures.js";

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "hwpx-cli-exclusive-")); });
afterEach(async () => { vi.restoreAllMocks(); await rm(directory, { recursive: true, force: true }); });

function cli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, ["--import", "tsx", "--conditions=development",
    resolve("packages/cli/src/index.ts"), ...args], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout!.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr!.on("data", (chunk) => { stderr += String(chunk); });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

describe("CLI exclusive artifact boundaries", () => {
  it("keeps originals and every successful pair intact across competing CLI processes", async () => {
    const input = join(directory, "input.hwpx");
    const output = join(directory, "output.hwpx");
    const report = join(directory, "report.json");
    const source = await createHwpxFixture({ entries: {} });
    await writeFile(input, source);
    const results = await Promise.all(Array.from({ length: 4 }, () => cli([
      "optimize", input, "--out", output, "--report", report
    ])));
    expect(results.some((result) => result.code === 0)).toBe(true);
    const successPaths: string[] = [];
    for (const result of results) {
      if (result.code !== 0) {
        expect(result.stderr).toMatch(/EEXIST|already exists|reservation changed/i);
        continue;
      }
      const outputPath = /^Output: (.+)$/m.exec(result.stdout)?.[1]!.trim();
      const reportPath = /^Report: (.+)$/m.exec(result.stdout)?.[1]!.trim();
      expect(outputPath).toBeTruthy(); expect(reportPath).toBeTruthy();
      successPaths.push(outputPath!);
      await verifyHwpxOutput(await readFile(outputPath!));
      expect(JSON.parse(await readFile(reportPath!, "utf8")).originalSize).toBe(source.length);
    }
    expect(new Set(successPaths).size).toBe(successPaths.length);
    expect(await readFile(input)).toEqual(source);
    expect((await readdir(directory)).some((name) => name.includes(".tmp-"))).toBe(false);
  }, 30_000);
  it("preserves a user summary replacement appearing just before batch publication", async () => {
    const input = join(directory, "input.hwpx");
    await writeFile(input, await createHwpxFixture({ entries: {} }));
    const outputDirectory = join(directory, "output");
    const publish = PathClaimRegistry.prototype.publish;
    vi.spyOn(PathClaimRegistry.prototype, "publish").mockImplementation(async function (stage, path) {
      if (path === join(outputDirectory, "batch-report.json")) {
        await rmdir(path);
        await writeFile(path, "user summary");
      }
      return publish.call(this, stage, path);
    });
    await expect(runBatch(directory, { out: outputDirectory, jobs: "1" })).rejects.toThrow(/reservation changed/);
    expect(await readFile(join(outputDirectory, "batch-report.json"), "utf8")).toBe("user summary");
    await verifyHwpxOutput(await readFile(join(outputDirectory, "input.optimized.hwpx")));
    expect((await readdir(outputDirectory)).some((name) => name.includes(".lock"))).toBe(false);
  });
});
