import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createHwpxFixture } from "../../../packages/core/test/fixtures.js";
import { writeManifestFile } from "../src/corpus.js";
import type { BenchReport } from "../src/report.js";

const exec = promisify(execFile);
const benchRoot = fileURLToPath(new URL("../", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function sandbox() {
  const prefix = join(repoRoot, ".tmp", "bench-execution-");
  await mkdir(dirname(prefix), { recursive: true });
  const dir = await mkdtemp(prefix);
  directories.push(dir);
  await cp(join(benchRoot, "src"), join(dir, "src"), { recursive: true });
  await cp(join(benchRoot, "fixtures"), join(dir, "fixtures"), { recursive: true });
  await cp(join(benchRoot, "corpus.manifest.json"), join(dir, "corpus.manifest.json"));
  return dir;
}

async function run(dir: string, env: Record<string, string>) {
  const result = await exec(process.execPath, ["--import", "tsx", "--conditions=development",
    join(dir, "src", "runBench.ts"), "rd", "--profile", "balanced"], {
    cwd: repoRoot, env: { ...process.env, HWPX_BENCH_DIR: "", ...env }, timeout: 20000
  });
  const report = JSON.parse(await readFile(join(dir, "out", "rd-report.json"), "utf8")) as BenchReport;
  return { ...result, report };
}

describe("actual RD report command", () => {
  it("writes per-document reasons and exits zero for a normal NO-GO", async () => {
    const dir = await sandbox();
    // Executables are controlled stand-ins; these JPEG-free inputs never call them.
    await rm(join(dir, "fixtures"), { recursive: true });
    await mkdir(join(dir, "fixtures"));
    await mkdir(join(dir, "corpus"));
    await writeFile(join(dir, "corpus", "broken.hwpx"), "invalid ZIP");
    await writeFile(join(dir, "corpus", "text.hwpx"), await createHwpxFixture({ entries: {} }));
    await writeManifestFile(join(dir, "corpus.manifest.json"), join(dir, "corpus"));
    const { stderr, report } = await run(dir, { HWPX_BENCH_DIR: join(dir, "corpus"),
      HWPX_BENCH_SSIMULACRA2: process.execPath, HWPX_BENCH_JPEGLI: process.execPath });
    expect(stderr.trim()).toBe("NO-GO");
    expect(report).toMatchObject({ go: false, goReason: "document-processing-failed",
      statistics: { documentCount: 2, failedDocumentCount: 1, noDataDocumentCount: 1 } });
    expect(report.documents.find((doc) => doc.relativePath === "broken.hwpx")).toMatchObject({
      status: "error", stats: null, issues: [{ stage: "package", reason: "processing-error" }]
    });
  });

  it("writes INVALID rather than crashing when a configured metric binary is missing", async () => {
    const dir = await sandbox();
    const { stderr, report } = await run(dir, {
      HWPX_BENCH_SSIMULACRA2: join(dir, "missing-metric.exe"),
      HWPX_BENCH_JPEGLI: join(dir, "missing-jpegli.exe")
    });
    expect(stderr.trim()).toBe("INVALID");
    expect(report).toMatchObject({ go: false, invalidReasons: ["synthetic-only", "metric-tool-missing"] });
    expect(report.documents.length).toBeGreaterThan(0);
    expect(report.documents.some((doc) => doc.reason === "metric-tool-missing")).toBe(true);
  });
});
