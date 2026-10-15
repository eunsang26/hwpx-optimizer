import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const prune = createRequire(import.meta.url)(resolve("scripts/prune-electron-locales.cjs")).default as
  (context: { electronPlatformName: string; appOutDir: string }) => Promise<void>;
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hwpx-locale-package-"));
  await mkdir(join(root, "locales"));
  for (const name of ["ko.pak", "en-US.pak", "de.pak"]) await writeFile(join(root, "locales", name), `synthetic ${name}`);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("Windows startup locale pruning", () => {
  it("retains Korean and en-US bytes and removes only the other runtime locale", async () => {
    const originals = await Promise.all(["ko.pak", "en-US.pak"].map(name => readFile(join(root, "locales", name))));
    await prune({ electronPlatformName: "win32", appOutDir: root });
    expect((await readdir(join(root, "locales"))).sort()).toEqual(["en-US.pak", "ko.pak"]);
    expect(await readFile(join(root, "locales/ko.pak"))).toEqual(originals[0]);
    expect(await readFile(join(root, "locales/en-US.pak"))).toEqual(originals[1]);
  });
  it.each(["ko.pak", "en-US.pak"])("rejects missing %s before removing other files", async name => {
    await rm(join(root, "locales", name));
    await expect(prune({ electronPlatformName: "win32", appOutDir: root })).rejects.toThrow(name);
    expect(await readFile(join(root, "locales/de.pak"), "utf8")).toBe("synthetic de.pak");
  });
  it.each(["ko.pak", "en-US.pak"])("rejects empty %s before removing other files", async name => {
    await writeFile(join(root, "locales", name), "");
    await expect(prune({ electronPlatformName: "win32", appOutDir: root })).rejects.toThrow(name);
    expect(await readFile(join(root, "locales/de.pak"), "utf8")).toBe("synthetic de.pak");
  });
  it("rejects a missing locale directory instead of skipping the guard", async () => {
    await rm(join(root, "locales"), { recursive: true });
    await expect(prune({ electronPlatformName: "win32", appOutDir: root })).rejects.toThrow("locale directory is missing");
  });
  it("leaves non-Windows packages alone", async () => {
    await prune({ electronPlatformName: "linux", appOutDir: root });
    expect((await readdir(join(root, "locales"))).sort()).toEqual(["de.pak", "en-US.pak", "ko.pak"]);
  });
});
