import { link, lstat, mkdtemp, readFile, readdir, rm, rmdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PathClaimRegistry, publishExclusiveFile, removeOwnedArtifact, writeStagedFile } from "../src/index.js";

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "hwpx-publication-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("exclusive artifact publication", () => {
  it("reserves different names across independent concurrent registries and publishes complete bytes", async () => {
    const registries = Array.from({ length: 6 }, () => new PathClaimRegistry());
    const paths = await Promise.all(registries.map((claims) => claims.claim(join(directory, "output.hwpx"))));
    expect(new Set(paths).size).toBe(6);
    for (const path of paths) expect((await lstat(path)).isDirectory()).toBe(true);
    await Promise.all(registries.map(async (claims, index) => {
      const stage = join(directory, `stage-${index}`);
      const content = Buffer.alloc(65536, index);
      const owned = await writeStagedFile(stage, content);
      await claims.publish(stage, paths[index]!);
      await removeOwnedArtifact(owned);
      expect((await readFile(paths[index]!)).equals(content)).toBe(true);
      await claims.releaseAll();
    }));
    expect(await readdir(directory)).toHaveLength(6);
  });
  it("preserves a user file replacing a reserved directory before publication and cleanup", async () => {
    const claims = new PathClaimRegistry();
    const path = await claims.claim(join(directory, "output.hwpx"));
    const stage = join(directory, "stage");
    await writeStagedFile(stage, "verified output");
    await rmdir(path);
    await writeFile(path, "user replacement");
    await expect(claims.publish(stage, path)).rejects.toThrow(/reservation changed/);
    await claims.releaseAll();
    expect(await readFile(path, "utf8")).toBe("user replacement");
  });
  it("preserves data added inside a reservation rather than deleting recursively", async () => {
    const claims = new PathClaimRegistry();
    const path = await claims.claim(join(directory, "output.hwpx"));
    await writeFile(join(path, "notes.txt"), "user notes");
    await claims.releaseAll();
    expect(await readFile(join(path, "notes.txt"), "utf8")).toBe("user notes");
  });
  it("does not replace a file appearing between reservation removal and final creation", async () => {
    const stage = join(directory, "stage");
    const path = join(directory, "output.hwpx");
    await writeStagedFile(stage, "verified output");
    await expect(publishExclusiveFile(stage, path, { link: async (source, target) => {
      await writeFile(target, "new user file");
      await link(source, target);
    } })).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(path, "utf8")).toBe("new user file");
    expect(await readFile(stage, "utf8")).toBe("verified output");
  });
  it("supports filesystems without hardlinks while retaining exclusive creation", async () => {
    const stage = join(directory, "stage");
    const path = join(directory, "output.hwpx");
    const content = Buffer.alloc(512 * 1024);
    for (let index = 0; index < content.length; index += 1) content[index] = (index * 17 + Math.floor(index / 65536)) % 251;
    await writeStagedFile(stage, content);
    const operations = { link: async () => { throw Object.assign(new Error("no links"), { code: "ENOTSUP" }); } };
    await publishExclusiveFile(stage, path, operations);
    expect((await readFile(path)).equals(content)).toBe(true);
    await expect(publishExclusiveFile(stage, path, operations)).rejects.toMatchObject({ code: "EEXIST" });
    expect((await readFile(path)).equals(content)).toBe(true);
  });
  it("preserves modified or replaced artifacts during rollback cleanup", async () => {
    const path = join(directory, "stage");
    const owned = await writeStagedFile(path, "owned bytes");
    await writeFile(path, "user modification");
    await utimes(path, new Date("2020-01-01"), new Date("2020-01-01"));
    await removeOwnedArtifact(owned);
    expect(await readFile(path, "utf8")).toBe("user modification");
    await rm(path);
    await writeFile(path, "new user file");
    await removeOwnedArtifact(owned);
    expect(await readFile(path, "utf8")).toBe("new user file");
  });
  it("never deletes an existing staging file when exclusive creation fails", async () => {
    const path = join(directory, "stage");
    await writeFile(path, "unowned data");
    await expect(writeStagedFile(path, "our data")).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(path, "utf8")).toBe("unowned data");
  });
  it("releases earlier reservations if obtaining the paired report path fails", async () => {
    const claims = new PathClaimRegistry();
    await claims.claimExact(join(directory, "output.hwpx"));
    const report = join(directory, "report.json");
    await writeFile(report, "existing report");
    await expect(claims.claimExact(report)).rejects.toMatchObject({ code: "EEXIST" });
    await claims.releaseAll();
    expect(await readdir(directory)).toEqual(["report.json"]);
    expect(await readFile(report, "utf8")).toBe("existing report");
  });
  it("does not retry a failing ownership journal as though another process claimed the filename", async () => {
    let calls = 0;
    const claims = new PathClaimRegistry(async () => {
      calls += 1;
      throw Object.assign(new Error("journal failure"), { code: "EEXIST" });
    });
    await expect(claims.claim(join(directory, "output.hwpx"))).rejects.toThrow("journal failure");
    expect(calls).toBe(1);
    expect(await readdir(directory)).toEqual([]);
  });
});
