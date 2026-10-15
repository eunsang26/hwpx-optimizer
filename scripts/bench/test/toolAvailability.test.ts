import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeRawWithJpegli, JpegliToolMissingError } from "../src/jpegliCli.js";
import { MetricToolMissingError, scoreSsimulacra2 } from "../src/ssimulacra2.js";

afterEach(() => vi.unstubAllEnvs());

describe("unavailable external tools", () => {
  it("classifies an actual missing metric executable as tooling invalidity", async () => {
    vi.stubEnv("HWPX_BENCH_SSIMULACRA2", join(tmpdir(), randomUUID(), "missing-metric.exe"));
    await expect(scoreSsimulacra2(Buffer.from("ref"), Buffer.from("dist")))
      .rejects.toBeInstanceOf(MetricToolMissingError);
  });

  it("classifies an actual missing jpegli executable as tooling invalidity", async () => {
    const raw = { data: Buffer.alloc(3, 120), width: 1, height: 1, channels: 3 as const };
    await expect(encodeRawWithJpegli(raw, 88, join(tmpdir(), randomUUID(), "missing-jpegli.exe")))
      .rejects.toBeInstanceOf(JpegliToolMissingError);
  });
});
