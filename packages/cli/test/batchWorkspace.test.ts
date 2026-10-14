import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BatchWorkspace } from "../src/batchWorkspace.js";
import { PathClaimRegistry } from "../src/pathClaims.js";
import { runBatch } from "../src/index.js";
import { createHwpxFixture } from "../../core/test/fixtures.js";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "hwpx-workspace-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("batch workspace ownership", () => {
  it("refuses a second active batch workspace without touching the first", async () => {
    const workspace = await BatchWorkspace.open(dir);
    const stage = workspace.stagePath("job-0.hwpx.tmp");
    await writeFile(stage, "active data");
    await expect(BatchWorkspace.open(dir)).rejects.toThrow(/Another batch/);
    expect(await readFile(stage, "utf8")).toBe("active data");
    await workspace.close();
  });

  it("recovers only recorded placeholders and private staging files after a process exit", async () => {
    const workspace = await BatchWorkspace.open(dir);
    const registry = new PathClaimRegistry(claim => workspace.recordClaim(claim));
    const owned = await registry.claim(join(dir, "owned.hwpx"));
    const preserved = await registry.claim(join(dir, "written.hwpx"));
    await writeFile(preserved, "valid output");
    const unowned = join(dir, "other-program.tmp");
    await writeFile(unowned, "other data");
    await writeFile(workspace.stagePath("job-0.hwpx.tmp"), "partial owned output");
    await markProcessExited(workspace);
    const recovered = await BatchWorkspace.open(dir);
    await expect(readFile(owned)).rejects.toThrow();
    expect(await readFile(preserved, "utf8")).toBe("valid output");
    expect(await readFile(unowned, "utf8")).toBe("other data");
    await recovered.close();
  });

  it("does not unlink a user replacement at a formerly claimed path", async () => {
    const workspace = await BatchWorkspace.open(dir);
    const registry = new PathClaimRegistry(claim => workspace.recordClaim(claim));
    const path = await registry.claim(join(dir, "replaced.hwpx"));
    await rm(path);
    await writeFile(path, "user replacement");
    await markProcessExited(workspace);
    const recovered = await BatchWorkspace.open(dir);
    expect(await readFile(path, "utf8")).toBe("user replacement");
    await recovered.close();
  });

  it("serializes claim records and allows only one concurrent stale recovery", async () => {
    const workspace = await BatchWorkspace.open(dir);
    const registry = new PathClaimRegistry(claim => workspace.recordClaim(claim));
    const paths = await Promise.all(["a", "b", "c"].map(name => registry.claim(join(dir, `${name}.hwpx`))));
    await markProcessExited(workspace);
    const results = await Promise.allSettled([BatchWorkspace.open(dir), BatchWorkspace.open(dir)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    for (const path of paths) await expect(readFile(path)).rejects.toThrow();
    const winner = results.find(result => result.status === "fulfilled")!;
    if (winner.status === "fulfilled") await winner.value.close();
  });

  it("preserves an unrecognized directory that happens to have the lock name", async () => {
    const lock = join(dir, ".hwpx-optimizer-batch.lock");
    await mkdir(lock);
    await writeFile(join(lock, "notes.txt"), "user notes");
    await expect(BatchWorkspace.open(dir)).rejects.toThrow(/Unrecognized/);
    expect(await readFile(join(lock, "notes.txt"), "utf8")).toBe("user notes");
  });

  it("preserves unexpected files in an otherwise owned stale workspace", async () => {
    const workspace = await BatchWorkspace.open(dir);
    const path = join(workspace.directory, "user-notes.txt");
    await writeFile(path, "keep");
    await markProcessExited(workspace);
    await expect(BatchWorkspace.open(dir)).rejects.toThrow(/Unexpected/);
    expect(await readFile(path, "utf8")).toBe("keep");
  });

  it.each([
    { jobs: "0" }, { "batch-target-bytes": "-1" },
    { "target-bytes": "bad" }, { "max-input-bytes": "0.2" }, { actions: "unknown" }
  ])("validates %j before creating or modifying output directories", async (options) => {
    const output = join(dir, "out");
    await expect(runBatch(dir, { out: output, ...options })).rejects.toThrow();
    expect(await readdir(dir)).toEqual([]);
  });

  it("preserves shared .tmp files with the output directory equal to the input directory", async () => {
    await writeFile(join(dir, "original.hwpx"), await createHwpxFixture({ entries: {} }));
    await writeFile(join(dir, "user.tmp"), "user data");
    const result = await runBatch(dir, { out: dir, jobs: "1" });
    expect(result.optimized).toBe(1);
    expect(await readFile(join(dir, "user.tmp"), "utf8")).toBe("user data");
    expect((await readdir(dir)).some(name => name.includes(".lock"))).toBe(false);
  });

  it("records canonical ownership when CLI paths are relative", async () => {
    await writeFile(join(dir, "original.hwpx"), await createHwpxFixture({ entries: {} }));
    const input = relative(process.cwd(), dir);
    const result = await runBatch(input, { out: join(input, "out"), jobs: "1" });
    expect(result.optimized).toBe(1);
    expect((await readdir(join(dir, "out"))).sort()).toEqual([
      "batch-report.json", "original.optimized.hwpx", "original.optimized.hwpx.report.json"
    ]);
  });
});

async function markProcessExited(workspace: BatchWorkspace): Promise<void> {
  const child = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
  const pid = child.pid!;
  await new Promise<void>((resolve, reject) => { child.once("exit", () => resolve()); child.once("error", reject); });
  const path = join(workspace.directory, "owner.json");
  const owner = JSON.parse(await readFile(path, "utf8"));
  await writeFile(path, JSON.stringify({ ...owner, pid }));
}
