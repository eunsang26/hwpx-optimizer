import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { RawImage } from "./types.js";
import { JPEGLI_ENV } from "./types.js";

/** cjpegli argv: INPUT OUTPUT -q QUALITY (--quiet). See libjpegli-tools man page. */
export function resolveJpegliBin(): string | null {
  const fromEnv = process.env[JPEGLI_ENV]?.trim();
  if (fromEnv) return fromEnv;
  try {
    return execFileSync("which", ["cjpegli"], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

function rawToPpm(raw: RawImage): Buffer {
  const header = Buffer.from(`P6\n${raw.width} ${raw.height}\n255\n`, "ascii");
  return Buffer.concat([header, raw.data]);
}

export async function encodeRawWithJpegli(
  raw: RawImage,
  quality: number,
  bin: string
): Promise<{ bytes: Buffer; encodeMs: number }> {
  const dir = await mkdtemp(join(tmpdir(), "hwpx-bench-jpegli-"));
  const inPath = join(dir, "in.ppm");
  const outPath = join(dir, "out.jpg");
  try {
    await writeFile(inPath, rawToPpm(raw));
    const start = performance.now();
    await new Promise<void>((resolve, reject) => {
      const child = spawn(bin, [inPath, outPath, "-q", String(quality), "--quiet"], {
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`cjpegli exited ${code}: ${stderr.trim()}`));
      });
    });
    const encodeMs = performance.now() - start;
    const bytes = await readFile(outPath);
    return { bytes, encodeMs };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
