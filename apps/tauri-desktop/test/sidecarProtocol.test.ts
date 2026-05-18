import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createHwpxFixture } from "../../../packages/core/test/fixtures.js";

describe("Tauri Node sidecar protocol", () => {
  it("responds to a health request over newline-delimited JSON", async () => {
    await expect(runSidecarRequests([{ id: 1, method: "health" }])).resolves.toEqual([{
      id: 1,
      ok: true,
      result: {
        service: "hwpx-tauri-sidecar",
        status: "ok"
      }
    }]);
  });

  it("runs analyze, optimize, and verify through the existing core", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-tauri-sidecar-"));
    try {
      const inputPath = join(dir, "input.hwpx");
      const outputDirectory = join(dir, "out");
      await writeFile(inputPath, await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } }));

      const responses = await runSidecarRequests([
        { id: 1, method: "analyze", params: { filePath: inputPath } },
        { id: 2, method: "optimize", params: { filePath: inputPath, mode: "safe", outputDirectory } }
      ]);

      expect(responses[0]).toMatchObject({ id: 1, ok: true });
      expect(responses[1]).toMatchObject({ id: 2, ok: true });
      const optimizeResult = responses[1]?.result as { outputPath?: string };
      expect(optimizeResult.outputPath).toBe(join(outputDirectory, "input_tauri_optimized.hwpx"));
      await expect(readFile(optimizeResult.outputPath)).resolves.toBeInstanceOf(Buffer);

      await expect(runSidecarRequests([
        { id: 3, method: "verify", params: { filePath: optimizeResult.outputPath } }
      ])).resolves.toEqual([{ id: 3, ok: true, result: { ok: true } }]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

async function runSidecarRequests(requests: Array<{ id: number; method: string; params?: unknown }>): Promise<Array<{
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}>> {
  const child = spawn(process.execPath, [
    "--import",
    "tsx",
    "apps/tauri-desktop/sidecar/index.ts"
  ], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  for (const request of requests) {
    child.stdin.write(`${JSON.stringify(request)}\n`);
  }
  child.stdin.end();

  const [code] = await once(child, "exit");
  if (code !== 0) {
    throw new Error(`sidecar exited with ${code}: ${stderr}`);
  }
  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { id: number; ok: boolean; result?: unknown; error?: string });
}
