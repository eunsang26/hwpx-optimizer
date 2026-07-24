import { describe, expect, it } from "vitest";
import { interpolateIsoQuality, isoQualityJpegliBytes } from "../src/rdCurve.js";
import { SSIMULACRA2_MATCH_TOLERANCE } from "../src/types.js";

describe("iso-quality interpolation", () => {
  it("interpolates jpegli bytes at matching score", () => {
    const moz = [{ quality: 88, bytes: 1000, score: 80, encodeMs: 10 }];
    const jl = [
      { quality: 80, bytes: 700, score: 78, encodeMs: 12 },
      { quality: 90, bytes: 900, score: 82, encodeMs: 14 }
    ];
    const hit = interpolateIsoQuality(moz, jl, 88, 0.5);
    expect(hit.status).toBe("ok");
    if (hit.status === "ok") {
      expect(hit.bytes).toBeGreaterThan(700);
      expect(hit.bytes).toBeLessThan(900);
      expect(hit.targetScore).toBe(80);
      expect(hit.quality).toBeCloseTo(85, 5);
    }
  });

  it("returns curve-miss when jpegli scores do not bracket target", () => {
    const moz = [{ quality: 88, bytes: 1000, score: 80, encodeMs: 10 }];
    const jl = [
      { quality: 80, bytes: 700, score: 70, encodeMs: 12 },
      { quality: 90, bytes: 900, score: 75, encodeMs: 14 }
    ];
    const hit = interpolateIsoQuality(moz, jl, 88, 0.5);
    expect(hit.status).toBe("no-data");
    if (hit.status === "no-data") {
      expect(hit.reason).toBe("curve-miss");
    }
  });

  it("isoQualityJpegliBytes uses SSIMULACRA2_MATCH_TOLERANCE", () => {
    const moz = [{ quality: 88, bytes: 1000, score: 80, encodeMs: 10 }];
    const jl = [
      { quality: 80, bytes: 700, score: 78, encodeMs: 12 },
      { quality: 90, bytes: 900, score: 82, encodeMs: 14 }
    ];
    const hit = isoQualityJpegliBytes(moz, jl, 88);
    expect(hit.status).toBe("ok");
    expect(SSIMULACRA2_MATCH_TOLERANCE).toBe(0.5);
  });
});
