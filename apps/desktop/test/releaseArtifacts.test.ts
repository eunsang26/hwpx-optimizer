import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

async function createDesktopArchive(omit?: "io-package" | "io-entry"): Promise<void> {
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
