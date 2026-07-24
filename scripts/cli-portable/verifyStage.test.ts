import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { REQUIRED_WIN_SHARP_FILES } from "./constants.mjs";
import { renderDropHereBat, renderHwpxOptCmd } from "./launchers.mjs";
import { verifyCliPortableStage } from "./verifyStage.mjs";

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function buildValidStage(stageRoot: string): Promise<void> {
  await mkdir(join(stageRoot, "node"), { recursive: true });
  await writeFile(join(stageRoot, "node", "node.exe"), Buffer.alloc(1_000_001));

  const appRoot = join(stageRoot, "app");
  await mkdir(appRoot, { recursive: true });
  await writeJson(join(appRoot, "package.json"), { type: "module" });

  const cliDist = join(appRoot, "cli", "dist");
  await mkdir(cliDist, { recursive: true });
  await writeFile(join(cliDist, "index.js"), "export {};\n", "utf8");
  await writeFile(join(cliDist, "optimizeWorker.js"), "export {};\n", "utf8");

  const coreDist = join(appRoot, "core", "dist");
  await mkdir(coreDist, { recursive: true });
  await writeFile(join(coreDist, "index.js"), "export {};\n", "utf8");

  const corePkg = join(appRoot, "node_modules", "@hwpx-optimizer", "core");
  await mkdir(corePkg, { recursive: true });
  await writeJson(join(corePkg, "package.json"), { type: "module" });

  const cliPkg = join(appRoot, "node_modules", "@hwpx-optimizer", "cli");
  await mkdir(cliPkg, { recursive: true });
  await writeJson(join(cliPkg, "package.json"), { type: "module" });

  const sharpLib = join(appRoot, "node_modules", "@img", "sharp-win32-x64", "lib");
  await mkdir(sharpLib, { recursive: true });
  for (const file of REQUIRED_WIN_SHARP_FILES) {
    await writeFile(join(sharpLib, file), "", "utf8");
  }

  await writeFile(join(stageRoot, "drop-here.bat"), renderDropHereBat(), "utf8");
  await writeFile(join(stageRoot, "hwpx-opt.cmd"), renderHwpxOptCmd(), "utf8");
  await writeFile(join(stageRoot, "사용법.txt"), "usage\n", "utf8");
  await writeFile(join(stageRoot, "TERMS.txt"), "terms\n", "utf8");
}

describe("verifyCliPortableStage", () => {
  it("rejects an incomplete stage layout", async () => {
    const stageRoot = await mkdtemp(join(tmpdir(), "hwpx-opt-stage-invalid-"));
    try {
      await expect(verifyCliPortableStage(stageRoot)).rejects.toThrow(/node\.exe/i);
    } finally {
      await rm(stageRoot, { recursive: true, force: true });
    }
  });

  it("accepts a minimal valid stage with required stubs", async () => {
    const stageRoot = await mkdtemp(join(tmpdir(), "hwpx-opt-stage-valid-"));
    try {
      await buildValidStage(stageRoot);
      await expect(verifyCliPortableStage(stageRoot)).resolves.toBeUndefined();
    } finally {
      await rm(stageRoot, { recursive: true, force: true });
    }
  });
});
