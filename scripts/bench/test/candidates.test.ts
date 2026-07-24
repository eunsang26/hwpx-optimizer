import { describe, expect, it } from "vitest";
import { balancedImageProfile } from "@hwpx-optimizer/core";
import {
  encodeJpegli,
  encodeMozjpeg,
  encodePng,
  encodeWebp,
  resolveJpegliBin
} from "../src/candidates.js";

const raw = { data: Buffer.alloc(64 * 64 * 3, 120), width: 64, height: 64, channels: 3 as const };

describe("encode candidates", () => {
  it("encodeMozjpeg shrinks vs uncompressed raw byte length", async () => {
    const enc = await encodeMozjpeg(raw, 88);
    expect(enc.bytes.byteLength).toBeGreaterThan(100);
    expect(enc.bytes.byteLength).toBeLessThan(raw.data.byteLength);
    expect(enc.candidate).toBe("mozjpeg");
  });

  it.skipIf(!resolveJpegliBin())("encodeJpegli returns jpeg", async () => {
    const enc = await encodeJpegli(raw, 88);
    expect(enc.bytes.byteLength).toBeGreaterThan(100);
    expect(enc.bytes[0]).toBe(0xff);
    expect(enc.bytes[1]).toBe(0xd8);
    expect(enc.candidate).toBe("jpegli");
  });

  it("encodePng returns png", async () => {
    const enc = await encodePng(raw, balancedImageProfile);
    expect(enc.bytes.byteLength).toBeGreaterThan(100);
    expect(enc.bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(enc.candidate).toBe("png");
  });

  it("encodeWebp returns webp", async () => {
    const enc = await encodeWebp(raw, 80);
    expect(enc.bytes.byteLength).toBeGreaterThan(50);
    expect(enc.bytes.subarray(0, 4).toString()).toBe("RIFF");
    expect(enc.candidate).toBe("webp");
  });
});
