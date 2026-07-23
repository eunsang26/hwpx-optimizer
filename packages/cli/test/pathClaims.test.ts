import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, stat, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PathClaimRegistry } from "../src/pathClaims.js";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "claims-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("PathClaimRegistry", () => {
  it("claims the preferred path when free", async () => {
    const reg = new PathClaimRegistry();
    const p = await reg.claim(join(dir, "a.hwpx"));
    expect(p).toBe(join(dir, "a.hwpx"));
    expect((await stat(p)).size).toBe(0);
  });
  it("suffixes when the preferred path is taken", async () => {
    await writeFile(join(dir, "a.hwpx"), "x");
    const reg = new PathClaimRegistry();
    const p = await reg.claim(join(dir, "a.hwpx"));
    expect(p).toBe(join(dir, "a (1).hwpx"));
  });
  it("does not hand out the same path twice", async () => {
    const reg = new PathClaimRegistry();
    const p1 = await reg.claim(join(dir, "a.hwpx"));
    const p2 = await reg.claim(join(dir, "a.hwpx"));
    expect(p1).not.toBe(p2);
  });
  it("releaseAll removes 0-byte placeholders", async () => {
    const reg = new PathClaimRegistry();
    await reg.claim(join(dir, "a.hwpx"));
    await reg.releaseAll();
    expect(await readdir(dir)).toEqual([]);
  });
});
