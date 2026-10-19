import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createPackageSizeEstimate, projectPackageSizeFromOpportunities } from "../src/projectPackageSize.js";
import { evaluatePackageSizeEstimate } from "../src/planning.js";
import { readHwpxPackage } from "../src/reader.js";
import { createHwpxFixture } from "./fixtures.js";
import type { OptimizationOpportunity } from "../src/types.js";

function opportunity(action: OptimizationOpportunity["action"], target: string, before: number, after: number): OptimizationOpportunity {
  return { id: `${action}:${target}`, label: action, action, target, beforeSize: before, afterSize: after,
    estimatedSavingBytes: before - after, confidence: "estimated", risk: "medium", visualImpact: "low", defaultEnabledIn: ["balanced"] };
}

describe("ZIP size projections", () => {
  it("preserves exact source length when no changes are predicted, including ZIP metadata", async () => {
    const input = await createHwpxFixture({ entries: { "BinData/a.bin": Buffer.alloc(100_000, 42) } });
    const pkg = await readHwpxPackage(input);
    expect(pkg.sourceSize).toBe(input.length);
    expect(pkg.entries.every(entry => entry.compressedSize !== undefined)).toBe(true);
    expect(projectPackageSizeFromOpportunities(pkg, [])).toBe(input.length);
  });

  it("does not subtract raw BMP savings from a highly compressed ZIP", async () => {
    const data = Buffer.alloc(1_000_000);
    const input = await createHwpxFixture({ entries: { "BinData/a.bmp": data } });
    const pkg = await readHwpxPackage(input);
    const opp = opportunity("convert-bmp-to-png", "BinData/a.bmp", data.length, 100_000);
    const projected = projectPackageSizeFromOpportunities(pkg, [opp]);
    expect(input.length).toBeLessThan(2000);
    expect(projected).toBe(input.length); // Candidate grows ZIP; no-growth fallback.
  });

  it("uses measured candidate DEFLATE bytes, keeps headers, and selects one alternative per resource", async () => {
    const data = Buffer.alloc(100_000, 42);
    const input = await createHwpxFixture({ entries: { "BinData/a.png": data } });
    const pkg = await readHwpxPackage(input);
    const candidate = Buffer.alloc(1000, 42);
    const opp = { ...opportunity("optimize-png", "BinData/a.png", data.length, candidate.length),
      compressedAfterSize: deflateRawSync(candidate, { level: 9 }).length };
    const original = pkg.entries.find(e => e.path === opp.target)!;
    const expected = input.length - original.compressedSize! + opp.compressedAfterSize;
    const estimate = createPackageSizeEstimate(pkg, [opp, { ...opp, action: "resize-png", compressedAfterSize: opp.compressedAfterSize + 4 }]);
    expect(evaluatePackageSizeEstimate(estimate).size).toBe(expected);
    expect(evaluatePackageSizeEstimate(estimate, []).size).toBe(input.length);
    expect(evaluatePackageSizeEstimate(estimate, ["resize-png"]).size).toBe(expected + 4);
  });

  it("does not invent a universal palette ZIP factor for unchanged PNGs", async () => {
    const input = await createHwpxFixture({ entries: { "BinData/a.png": Buffer.alloc(1000) } });
    const pkg = await readHwpxPackage(input);
    expect(projectPackageSizeFromOpportunities(pkg, [], { palettePng: true })).toBe(input.length);
  });
});
