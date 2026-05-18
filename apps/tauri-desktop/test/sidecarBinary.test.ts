import { spawn } from "node:child_process";
import { once } from "node:events";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Tauri sidecar binary preparation", () => {
  it("creates a target-triple Node sidecar binary that can run the built sidecar entry", async () => {
    await run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build", "-w", "@hwpx-optimizer/tauri-desktop"]);
    await run(process.execPath, ["scripts/prepare-tauri-sidecar.mjs"]);
    const triple = process.platform === "linux" && process.arch === "x64"
      ? "x86_64-unknown-linux-gnu"
      : undefined;
    if (!triple) return;

    const sidecarPath = join("apps", "tauri-desktop", "src-tauri", "binaries", `hwpx-sidecar-${triple}`);
    await expect(access(sidecarPath)).resolves.toBeUndefined();
    await expect(runSidecarBinary(sidecarPath, "apps/tauri-desktop/dist/sidecar/index.js")).resolves.toEqual({
      id: 1,
      ok: true,
      result: {
        service: "hwpx-tauri-sidecar",
        status: "ok"
      }
    });
  });
});

async function run(command: string, args: string[]): Promise<void> {
  const child = spawn(command, args, { cwd: process.cwd(), stdio: "inherit" });
  const [code] = await once(child, "exit");
  if (code !== 0) throw new Error(`${command} ${args.join(" ")} exited with ${code}`);
}

async function runSidecarBinary(sidecarPath: string, sidecarEntry: string): Promise<unknown> {
  const child = spawn(sidecarPath, [sidecarEntry], {
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
  child.stdin.write(`${JSON.stringify({ id: 1, method: "health" })}\n`);
  child.stdin.end();
  const [code] = await once(child, "exit");
  if (code !== 0) throw new Error(`sidecar exited with ${code}: ${stderr}`);
  return JSON.parse(stdout.trim());
}
