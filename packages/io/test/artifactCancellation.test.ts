import { lstat, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactSaveError, publishExclusiveFile, writeArtifactSet, writeStagedFile } from "../src/index.js";

let directory: string;
let output: string;
let report: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "hwpx-save-abort-"));
  output = join(directory, "output.hwpx"); report = join(directory, "report.json");
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
const cancelled = () => new DOMException("Optimization cancelled.", "AbortError");
async function oldPair() { await writeFile(output, "previous document"); await writeFile(report, "previous report"); }
async function expectOldPair() {
  expect(await readFile(output, "utf8")).toBe("previous document");
  expect(await readFile(report, "utf8")).toBe("previous report");
  expect((await readdir(directory)).sort()).toEqual(["output.hwpx", "report.json"]);
}
const artifacts = () => [{ target: output, data: "new document" }, { target: report, data: "new report" }];

describe("abortable artifact saves", () => {
  it("does no filesystem work when already aborted", async () => {
    await oldPair();
    await expect(writeArtifactSet(artifacts(), { overwrite: true, signal: AbortSignal.abort(cancelled()) }))
      .rejects.toMatchObject({ name: "AbortError" });
    await expectOldPair();
  });
  it.each([1, 2])("cleans owned stages after cancelling stage write %s", async (cancelAt) => {
    await oldPair();
    const controller = new AbortController();
    let writes = 0;
    await expect(writeArtifactSet(artifacts(), { overwrite: true, signal: controller.signal, operations: {
      write: async (path, data, options) => {
        const stage = await writeStagedFile(path, data, options);
        if (++writes === cancelAt) controller.abort(cancelled());
        return stage;
      }
    } })).rejects.toMatchObject({ name: "AbortError" });
    await expectOldPair();
  });
  it.each([1, 2])("restores both files after cancelling backup rename %s", async (cancelAt) => {
    await oldPair();
    const controller = new AbortController();
    let moves = 0;
    await expect(writeArtifactSet(artifacts(), { overwrite: true, signal: controller.signal, operations: {
      move: async (source, target) => {
        await rename(source, target);
        if (++moves === cancelAt) controller.abort(cancelled());
      }
    } })).rejects.toBeInstanceOf(ArtifactSaveError);
    await expectOldPair();
  });
  it.each([[false, 1], [false, 2], [true, 1], [true, 2]] as const)(
    "rolls the full pair back when cancelled after overwrite=%s publication %s", async (overwrite, cancelAt) => {
      if (overwrite) await oldPair();
      const controller = new AbortController();
      const commitState = { committed: false };
      let publications = 0;
      await expect(writeArtifactSet(artifacts(), { overwrite, signal: controller.signal, commitState, operations: {
        publish: async (stage, target, claims) => {
          const artifact = await claims.publish(stage, target);
          if (++publications === cancelAt) controller.abort(cancelled());
          return artifact;
        }
      } })).rejects.toMatchObject({ name: "ArtifactSaveError", recoveryPaths: [] });
      expect(commitState.committed).toBe(false);
      if (overwrite) await expectOldPair(); else expect(await readdir(directory)).toEqual([]);
    }
  );
  it("removes a partially copied exclusive destination when a filesystem without hardlinks is cancelled", async () => {
    const stage = join(directory, "stage");
    await writeStagedFile(stage, Buffer.alloc(8 * 1024 * 1024, 17));
    const controller = new AbortController();
    const publication = publishExclusiveFile(stage, output, { signal: controller.signal, link: async () => {
      throw Object.assign(new Error("links unsupported"), { code: "ENOTSUP" });
    } });
    // Observe real streaming I/O, then cancel while the exclusive final is partial.
    const rejection = expect(publication).rejects.toMatchObject({ name: "AbortError" });
    let partial = false;
    for (let attempt = 0; attempt < 1000; attempt += 1) {
      try {
        const info = await lstat(output);
        if (info.size > 0 && info.size < 8 * 1024 * 1024) { partial = true; break; }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      await new Promise<void>(resolve => setImmediate(resolve));
    }
    controller.abort(cancelled());
    await rejection;
    expect(partial).toBe(true);
    expect(await readdir(directory)).toEqual(["stage"]);
    expect((await lstat(stage)).size).toBe(8 * 1024 * 1024);
  });
});
