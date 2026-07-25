import { describe, expect, it } from "vitest";
import {
  classifyTargetVerdict,
  estimateSizeAtJpegQuality,
  planJpegQualityForTarget
} from "../src/shared/targetPlan.js";

describe("classifyTargetVerdict", () => {
  it("returns pass when expected is under target", () => {
    const result = classifyTargetVerdict({
      expectedBytes: 10 * 1024 * 1024,
      floorExpectedBytes: 8 * 1024 * 1024,
      targetBytes: 40 * 1024 * 1024
    });
    expect(result.verdict).toBe("pass");
    expect(result.label).toBe("제출 가능");
  });

  it("returns need-more when floor would pass but current does not", () => {
    const result = classifyTargetVerdict({
      expectedBytes: 48 * 1024 * 1024,
      floorExpectedBytes: 36 * 1024 * 1024,
      targetBytes: 40 * 1024 * 1024,
      atFloor: false
    });
    expect(result.verdict).toBe("need-more");
    expect(result.label).toBe("더 압축 필요");
    expect(result.detail).toContain("하한 품질");
  });

  it("returns hard-miss only when floor stays over target", () => {
    const result = classifyTargetVerdict({
      expectedBytes: 50 * 1024 * 1024,
      floorExpectedBytes: 45 * 1024 * 1024,
      targetBytes: 40 * 1024 * 1024,
      atFloor: true
    });
    expect(result.verdict).toBe("hard-miss");
    expect(result.label).toBe("기준 미달");
    expect(result.detail).toContain("하한 품질");
  });

  it("treats size equal to the target as not passing under 미만 semantics", () => {
    const result = classifyTargetVerdict({
      expectedBytes: 40 * 1024 * 1024,
      floorExpectedBytes: 40 * 1024 * 1024,
      targetBytes: 40 * 1024 * 1024,
      atFloor: true
    });
    expect(result.verdict).toBe("hard-miss");
  });
});

describe("estimateSizeAtJpegQuality", () => {
  it("estimates smaller size at lower quality", () => {
    const high = estimateSizeAtJpegQuality({
      originalBytes: 70_000_000,
      baselineExpectedBytes: 20_000_000,
      baselineQuality: 88,
      quality: 88,
      floor: 60,
      ceiling: 95,
      jpegBaselineBytes: 8_000_000
    });
    const low = estimateSizeAtJpegQuality({
      originalBytes: 70_000_000,
      baselineExpectedBytes: 20_000_000,
      baselineQuality: 88,
      quality: 60,
      floor: 60,
      ceiling: 95,
      jpegBaselineBytes: 8_000_000
    });
    expect(low).toBeLessThan(high);
  });

  it("does not explode package size when raising quality above the baseline", () => {
    const baseline = 5_000_000;
    const raised = estimateSizeAtJpegQuality({
      originalBytes: 90_000_000,
      baselineExpectedBytes: baseline,
      baselineQuality: 88,
      quality: 95,
      floor: 60,
      ceiling: 95,
      jpegBaselineBytes: 500_000
    });
    // Structural wins stay fixed — only a modest JPEG bump is allowed.
    expect(raised).toBeGreaterThanOrEqual(baseline);
    expect(raised).toBeLessThan(baseline * 1.25);
    expect(raised).toBeLessThan(20_000_000);
  });
});

describe("planJpegQualityForTarget", () => {
  it("keeps or raises quality when baseline already meets the target", () => {
    const planned = planJpegQualityForTarget({
      originalBytes: 70_000_000,
      baselineExpectedBytes: 18_000_000,
      baselineQuality: 88,
      targetBytes: 40_000_000,
      floor: 60,
      ceiling: 95,
      jpegBaselineBytes: 6_000_000
    });
    expect(planned.meets).toBe(true);
    expect(planned.quality).toBeGreaterThanOrEqual(88);
    expect(planned.expectedBytes).toBeLessThan(40_000_000);
    expect(planned.expectedBytes).toBeLessThan(25_000_000);
  });

  it("lowers quality when baseline misses but floor can meet", () => {
    const planned = planJpegQualityForTarget({
      originalBytes: 70_000_000,
      baselineExpectedBytes: 45_000_000,
      baselineQuality: 88,
      targetBytes: 40_000_000,
      floor: 60,
      ceiling: 95,
      jpegBaselineBytes: 20_000_000
    });
    expect(planned.meets).toBe(true);
    expect(planned.quality).toBeLessThan(88);
    expect(planned.quality).toBeGreaterThanOrEqual(60);
    expect(planned.expectedBytes).toBeLessThan(40_000_000);
  });

  it("settles on the floor when even max compression misses", () => {
    const planned = planJpegQualityForTarget({
      originalBytes: 70_000_000,
      baselineExpectedBytes: 65_000_000,
      baselineQuality: 88,
      targetBytes: 10_000_000,
      floor: 60,
      ceiling: 95,
      jpegBaselineBytes: 5_000_000
    });
    expect(planned.quality).toBe(60);
    expect(planned.meets).toBe(false);
  });
});
