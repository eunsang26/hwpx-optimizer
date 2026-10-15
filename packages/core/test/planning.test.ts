import { describe, expect, it } from "vitest";
import { allocateTargetShareBytes, targetStatusForBytes } from "../src/planning.js";

describe("submission byte contracts", () => {
  it.each([99, 100, 101])("judges %i bytes against a strict 100-byte limit", bytes => {
    expect(targetStatusForBytes(200, bytes, 100)).toBe(bytes < 100 ? "met" : "missed");
    expect(targetStatusForBytes(50, bytes, 100)).toBe(bytes < 100 ? "already-under-target" : "missed");
  });

  it("keeps integer allocation precise beyond safe product precision", () => {
    const input = { targetBytes: 8_000_000_000_001, itemBytes: 7_000_000_001, totalBytes: 19_000_000_001 };
    expect(allocateTargetShareBytes(input)).toBe(Number(BigInt(input.targetBytes) * BigInt(input.itemBytes) / BigInt(input.totalBytes)));
  });

  it("meeting every share implies a strict aggregate pass, including tiny budgets and zero shares", () => {
    const weights = [1, 2, 17, 19, 999];
    const totalBytes = weights.reduce((sum, n) => sum + n, 0);
    for (const targetBytes of [1, 2, 5, 103, 1_000_000]) {
      const ceilings = weights.map(itemBytes => allocateTargetShareBytes({ targetBytes, itemBytes, totalBytes })!);
      expect(ceilings.every(n => Number.isSafeInteger(n) && n >= 1)).toBe(true);
      expect(ceilings.reduce((sum, n) => sum + n - 1, 0)).toBeLessThan(targetBytes);
    }
  });

  it("deducts measured prior outputs and retains a finite ceiling when exhausted", () => {
    expect(allocateTargetShareBytes({ targetBytes: 100, consumedBytes: 80, itemBytes: 1, totalBytes: 2 })).toBe(10);
    expect(allocateTargetShareBytes({ targetBytes: 100, consumedBytes: 101, itemBytes: 1, totalBytes: 2 })).toBe(1);
    expect(allocateTargetShareBytes({ targetBytes: 100, itemBytes: 2, totalBytes: 1 })).toBeUndefined();
  });
});
