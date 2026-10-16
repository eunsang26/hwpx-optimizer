import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import asar from "@electron/asar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const checker = resolve("scripts/check-release-artifacts.mjs");
let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "hwpx-release-artifacts-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

async function createDesktopArchive(omit?: "io-package" | "io-entry" | "font" | "license" | "changed-font" | "changed-license" | "index"): Promise<void> {
  const source = join(directory, "app");
  for (const name of ["core", "io"]) {
    const root = join(source, "node_modules", "@hwpx-optimizer", name);
    for (const file of ["package.json", "dist/index.js"]) {
      if (name === "io" && ((omit === "io-package" && file === "package.json") ||
          (omit === "io-entry" && file === "dist/index.js"))) continue;
      const path = join(root, file);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, file === "package.json" ? '{"type":"module"}' : "export {};\n");
    }
  }
  for (const file of ["index.html", "styles.css", "renderer.js", "preload.cjs", "main.cjs", "main.js"]) {
    if (file === "index.html" && omit === "index") continue;
    const path = join(source, "apps/desktop/dist", file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file === "index.html" ? "<!doctype html><title>fixture</title>" : "/* synthetic fixture */");
  }
  const fontFolder = join(source, "apps/desktop/dist/fonts");
  await mkdir(fontFolder, { recursive: true });
  for (const [kind, file] of [["font", "PretendardVariable.woff2"], ["license", "OFL.txt"]] as const) {
    if (omit === kind) continue;
    if (omit === `changed-${kind}`) await writeFile(join(fontFolder, file), "changed asset");
    else await copyFile(resolve("apps/desktop/src/fonts", file), join(fontFolder, file));
  }
  await mkdir(join(directory, "release"));
  await asar.createPackage(source, join(directory, "release", "app.asar"));
}

describe("packaged desktop workspace runtimes", () => {
  it("accepts an actual ASAR containing core and shared filesystem runtime entries", async () => {
    await createDesktopArchive();
    const result = await execFileAsync(process.execPath, [checker], { cwd: directory });
    expect(result.stdout).toContain("Release artifact check passed.");
  });
  it.each(["io-package", "io-entry"] as const)("rejects an actual ASAR missing %s", async (omit) => {
    await createDesktopArchive(omit);
    await expect(execFileAsync(process.execPath, [checker], { cwd: directory }))
      .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("missing node_modules/@hwpx-optimizer/io/") });
  });
});


describe("packaged offline font assets", () => {
  it.each(["font", "license", "changed-font", "changed-license"] as const)("rejects an actual ASAR with %s omitted or replaced", async kind => {
    await createDesktopArchive(kind);
    await expect(execFileAsync(process.execPath, [checker], { cwd: directory }))
      .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("Required desktop font assets are missing or changed") });
  });
});


describe("desktop renderer entry", () => {
  it("rejects an actual ASAR without its HTML entry even if fonts are bundled", async () => {
    await createDesktopArchive("index");
    await expect(execFileAsync(process.execPath, [checker], { cwd: directory }))
      .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("Required desktop boot assets are missing or empty") });
  });
});
