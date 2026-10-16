import { link, lstat, mkdir, mkdtemp, readFile, readlink, readdir, rename, rm, rmdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactSaveError, writeArtifactSet, writeStagedFile } from "../src/index.js";

let directory: string;
let output: string;
let report: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "hwpx-transaction-"));
  output = join(directory, "output.hwpx"); report = join(directory, "report.json");
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
function artifacts() { return [{ target: output, data: "new document" }, { target: report, data: "new report" }]; }
async function seed() { await writeFile(output, "old document"); await writeFile(report, "old report"); }
async function expectOriginalPair() {
  expect(await readFile(output, "utf8")).toBe("old document");
  expect(await readFile(report, "utf8")).toBe("old report");
  expect((await readdir(directory)).sort()).toEqual(["output.hwpx", "report.json"]);
}

describe("document and report save transaction", () => {
  it.each([false, true])("publishes the complete pair with overwrite=%s and leaves no temporary files", async (overwrite) => {
    if (overwrite) await seed();
    expect(await writeArtifactSet(artifacts(), { overwrite })).toEqual([]);
    expect(await readFile(output, "utf8")).toBe("new document");
    expect(await readFile(report, "utf8")).toBe("new report");
    expect((await readdir(directory)).sort()).toEqual(["output.hwpx", "report.json"]);
  });
  it.each([[false, "output"], [false, "report"], [true, "output"], [true, "report"]] as const)(
    "rolls back the whole pair after %s/%s publication fails", async (overwrite, failed) => {
      if (overwrite) await seed();
      const failedTarget = failed === "output" ? output : report;
      await expect(writeArtifactSet(artifacts(), { overwrite, operations: {
        publish: async (stage, target, claims) => {
          if (target === failedTarget) throw Object.assign(new Error("publication denied"), { code: "EACCES" });
          return claims.publish(stage, target);
        }
      } })).rejects.toMatchObject({ name: "ArtifactSaveError", failedTarget, recoveryPaths: [] });
      if (overwrite) await expectOriginalPair();
      else expect(await readdir(directory)).toEqual([]);
    }
  );
  it("retains both old files and cleans the first stage when writing the second stage fails", async () => {
    await seed();
    let writes = 0;
    await expect(writeArtifactSet(artifacts(), { overwrite: true, operations: { write: async (path, data) => {
      if (++writes === 2) throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
      return writeStagedFile(path, data);
    } } })).rejects.toMatchObject({ code: "ENOSPC" });
    await expectOriginalPair();
  });
  it("restores the first old file when moving the second old file to backup fails", async () => {
    await seed();
    await expect(writeArtifactSet(artifacts(), { overwrite: true, operations: { move: async (source, target) => {
      if (source === report) throw new Error("backup rename denied");
      await rename(source, target);
    } } })).rejects.toThrow("backup rename denied");
    await expectOriginalPair();
  });
  it.each(["same", "hardlink", "symlink", "directory-symlink", "dangling-symlink"])(
    "rejects %s aliases before staging or changing either file", async (kind) => {
      if (kind !== "dangling-symlink") await writeFile(output, "existing document");
      if (kind === "same") report = join(directory, ".", "output.hwpx");
      if (kind === "hardlink") await link(output, report);
      if (kind === "symlink" || kind === "dangling-symlink") await symlink(output, report, "file");
      if (kind === "directory-symlink") {
        await symlink(directory, join(directory, "alias"), "junction");
        report = join(directory, "alias", "output.hwpx");
      }
      const before = (await readdir(directory)).sort();
      await expect(writeArtifactSet(artifacts(), { overwrite: true })).rejects.toThrow(/must be distinct/);
      expect((await readdir(directory)).sort()).toEqual(before);
      if (kind !== "dangling-symlink") expect(await readFile(output, "utf8")).toBe("existing document");
    }
  );
  it("rejects a directory destination before moving a valid existing document", async () => {
    await writeFile(output, "old document"); await mkdir(report);
    await expect(writeArtifactSet(artifacts(), { overwrite: true })).rejects.toThrow(/over directory/);
    expect(await readFile(output, "utf8")).toBe("old document");
    expect((await lstat(report)).isDirectory()).toBe(true);
    expect(await readdir(directory)).toHaveLength(2);
  });
  it("restores an existing symbolic link itself on failure and never changes its referent", async () => {
    const referent = join(directory, "external.txt");
    await writeFile(referent, "referent"); await symlink(referent, output, "file"); await writeFile(report, "old report");
    await expect(writeArtifactSet(artifacts(), { overwrite: true, operations: {
      publish: async (stage, target, claims) => {
        if (target === report) throw new Error("report denied");
        return claims.publish(stage, target);
      }
    } })).rejects.toThrow("report denied");
    expect(await readlink(output)).toBe(referent);
    expect(await readFile(referent, "utf8")).toBe("referent");
    expect(await readFile(report, "utf8")).toBe("old report");
    expect(await readdir(directory)).toHaveLength(3);
  });
  it.each(["output", "report"])("preserves a new user %s and retains the displaced old file for manual recovery", async (kind) => {
    await seed();
    const replaced = kind === "output" ? output : report;
    let failure: unknown;
    try {
      await writeArtifactSet(artifacts(), { overwrite: true, operations: {
        publish: async (stage, target, claims) => {
          if (target === report) {
            if (kind === "report") await rmdir(replaced); else await rm(replaced);
            await writeFile(replaced, "user replacement");
            throw new Error("report publication denied");
          }
          return claims.publish(stage, target);
        }
      } });
    } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(ArtifactSaveError);
    const error = failure as ArtifactSaveError;
    expect(error.message).toContain("Rollback incomplete");
    expect(error.recoveryPaths).toHaveLength(1);
    expect(await readFile(join(error.recoveryPaths[0]!, "previous"), "utf8")).toBe(kind === "output" ? "old document" : "old report");
    expect(await readFile(replaced, "utf8")).toBe("user replacement");
    expect(await readFile(kind === "output" ? report : output, "utf8")).toBe(kind === "output" ? "old report" : "old document");
  });
  it("reports retained backup-directory contents as a cleanup warning after a successful commit", async () => {
    await seed();
    let backupDirectory = "";
    const warnings = await writeArtifactSet(artifacts(), { overwrite: true, operations: { move: async (source, target) => {
      await rename(source, target);
      if (source === output) { backupDirectory = dirname(target); await writeFile(join(backupDirectory, "user.txt"), "notes"); }
    } } });
    expect(warnings.join(" ")).toContain(backupDirectory);
    expect(await readFile(join(backupDirectory, "user.txt"), "utf8")).toBe("notes");
    expect(await readdir(backupDirectory)).toEqual(["user.txt"]);
    expect(await readFile(output, "utf8")).toBe("new document");
    expect(await readFile(report, "utf8")).toBe("new report");
  });
});
