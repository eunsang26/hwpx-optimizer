import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { SSIMULACRA2_ENV } from "./types.js";

export class MetricToolMissingError extends Error {
  constructor(message = "ssimulacra2 CLI not found") {
    super(message);
    this.name = "MetricToolMissingError";
  }
}

export function resolveSsimulacra2Bin(): string | null {
  const fromEnv = process.env[SSIMULACRA2_ENV]?.trim();
  if (fromEnv) return fromEnv;
  try {
    return execFileSync("which", ["ssimulacra2"], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

function parseScore(stdout: string): number {
  const match = stdout.match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
  if (!match) {
    throw new Error(`ssimulacra2 stdout did not contain a score: ${stdout.trim()}`);
  }
  return Number.parseFloat(match[0]!);
}

export async function scoreSsimulacra2(referencePng: Buffer, distortedJpeg: Buffer): Promise<number> {
  const bin = resolveSsimulacra2Bin();
  if (!bin) {
    throw new MetricToolMissingError(
      "ssimulacra2 CLI not found (set HWPX_BENCH_SSIMULACRA2 or install ssimulacra2 on PATH)"
    );
  }

  const dir = await mkdtemp(join(tmpdir(), "hwpx-bench-ssim-"));
  const refPath = join(dir, "ref.png");
  const distPath = join(dir, "dist.jpg");
  try {
    await writeFile(refPath, referencePng);
    await writeFile(distPath, distortedJpeg);
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(bin, [refPath, distPath], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      let stderr = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        out += chunk.toString();
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve(out);
        else reject(new Error(`ssimulacra2 exited ${code}: ${stderr.trim() || out.trim()}`));
      });
    });
    return parseScore(stdout);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
