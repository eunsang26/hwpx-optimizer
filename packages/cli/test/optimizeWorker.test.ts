import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runOptimizeJob } from "../src/optimizeWorker.js";
import { createReportLikeHwpxFixture } from "../../core/test/fixtures.js";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "optjob-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("runOptimizeJob", () => {
  it("optimizes to temp artifacts and reports savings", async () => {
    const src = join(dir, "in.hwpx");
    await writeFile(src, await createReportLikeHwpxFixture());
    const tempOut = join(dir, "out.hwpx.tmp");
    const tempReport = join(dir, "out.report.json.tmp");
    const result = await runOptimizeJob({ sourcePath: src, tempOutputPath: tempOut, tempReportPath: tempReport, mode: "safe", options: {} });
    expect(result.status).toBe("optimized");
    expect((await readFile(tempOut)).byteLength).toBeGreaterThan(0);
    expect(JSON.parse(await readFile(tempReport, "utf8")).optimizedSize).toBeGreaterThan(0);
  });
  it("returns a failed result for an unreadable input", async () => {
    const result = await runOptimizeJob({ sourcePath: join(dir, "missing.hwpx"), tempOutputPath: join(dir, "o.tmp"), tempReportPath: join(dir, "r.tmp"), mode: "safe", options: {} });
    expect(result.status).toBe("failed");
    expect(result.stage).toBe("read-input");
  });
});
