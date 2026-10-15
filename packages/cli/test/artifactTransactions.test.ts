import { link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PathClaimRegistry } from "@hwpx-optimizer/io";
import { defaultDesktopSettings, optimizeDesktopFile } from "../../../apps/desktop/src/main/desktopService.js";
import { createHwpxFixture } from "../../core/test/fixtures.js";
import { runBatch, runCli } from "../src/index.js";

let directory: string;
let outputDirectory: string;
let input: string;
let source: Buffer;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "hwpx-adapter-transaction-"));
  outputDirectory = join(directory, "out"); await mkdir(outputDirectory);
  input = join(directory, "document.hwpx");
  source = await createHwpxFixture({ entries: {} }); await writeFile(input, source);
});
afterEach(async () => { vi.restoreAllMocks(); await rm(directory, { recursive: true, force: true }); });

describe.each(["cli", "desktop", "batch"] as const)("%s artifact transaction", (adapter) => {
  it.each([[false, "output"], [false, "report"], [true, "output"], [true, "report"]] as const)(
    "returns failure and restores the previous pair after overwrite=%s/%s publication fails", async (overwrite, failed) => {
      const output = join(outputDirectory, adapter === "desktop" ? "document_optimized.hwpx" : "document.optimized.hwpx");
      const report = `${output}.report.json`;
      const oldOutput = await createHwpxFixture({ entries: { "Contents/section0.xml": "<previous />" } });
      if (overwrite) { await writeFile(output, oldOutput); await writeFile(report, "previous report"); }
      const failedTarget = failed === "output" ? output : report;
      const publish = PathClaimRegistry.prototype.publish;
      vi.spyOn(PathClaimRegistry.prototype, "publish").mockImplementation(async function (stage, target) {
        if (target === failedTarget) throw Object.assign(new Error("injected publication failure"), { code: "EACCES" });
        return publish.call(this, stage, target);
      });
      if (adapter === "desktop") {
        await expect(optimizeDesktopFile({ filePath: input, mode: "safe", outputDirectory,
          settings: { ...defaultDesktopSettings, saveNextToOriginal: false, saveReport: true, preventOverwrite: !overwrite }
        })).rejects.toThrow("injected publication failure");
      } else if (adapter === "cli") {
        expect(await runCli(["optimize", input, "--out", output, "--report", report,
          ...(overwrite ? ["--overwrite"] : [])])).toBe(1);
      } else {
        const summary = await runBatch(directory, { mode: "safe", out: outputDirectory, jobs: "1",
          ...(overwrite ? { overwrite: "true" } : {}) });
        expect(summary).toMatchObject({ optimized: 0, failed: 1 });
        const json = JSON.parse(await readFile(summary.reportPath, "utf8"));
        expect(json.results[0]).toMatchObject({ status: "failed", stage: failed === "report" ? "write-report" : "write-output" });
      }
      if (overwrite) {
        expect((await readFile(output)).equals(oldOutput)).toBe(true);
        expect(await readFile(report, "utf8")).toBe("previous report");
      }
      expect((await readFile(input)).equals(source)).toBe(true);
      expect((await readdir(outputDirectory)).sort()).toEqual([
        ...(overwrite ? [output.slice(outputDirectory.length + 1), report.slice(outputDirectory.length + 1)] : []),
        ...(adapter === "batch" ? ["batch-report.json"] : [])
      ].sort());
    }
  );
});

describe("artifact alias rejection at public boundaries", () => {
  it("CLI rejects the same missing output/report name without leaving a reservation", async () => {
    const output = join(outputDirectory, "same.hwpx");
    expect(await runCli(["optimize", input, "--out", output, "--report", output])).toBe(1);
    expect(await readdir(outputDirectory)).toEqual([]);
    expect((await readFile(input)).equals(source)).toBe(true);
  });
  it.each([["cli", "hardlink"], ["cli", "symlink"], ["desktop", "hardlink"], ["desktop", "symlink"]] as const)(
    "%s rejects a %s between existing output/report destinations", async (adapter, kind) => {
      const output = join(outputDirectory, adapter === "desktop" ? "document_optimized.hwpx" : "output.hwpx");
      const report = `${output}.report.json`;
      await writeFile(output, "previous output");
      if (kind === "hardlink") await link(output, report); else await symlink(output, report, "file");
      if (adapter === "cli") {
        expect(await runCli(["optimize", input, "--out", output, "--report", report, "--overwrite"])).toBe(1);
      } else {
        await expect(optimizeDesktopFile({ filePath: input, mode: "safe", outputDirectory,
          settings: { ...defaultDesktopSettings, saveNextToOriginal: false, saveReport: true, preventOverwrite: false }
        })).rejects.toThrow(/must be distinct/);
      }
      expect(await readFile(output, "utf8")).toBe("previous output");
      expect(await readFile(report, "utf8")).toBe("previous output");
      expect((await readFile(input)).equals(source)).toBe(true);
      expect(await readdir(outputDirectory)).toHaveLength(2);
    }
  );
});
