import { describe, expect, it } from "vitest";
import { analyzeHwpxPackage } from "../src/analyzer.js";
import { optimizeHwpxBufferSafe, optimizeHwpxBufferBalanced, optimizeHwpxBufferAggressive } from "../src/optimize.js";
import { applySafeOptimizationPlan } from "../src/optimizer.js";
import { createSafeOptimizationPlan } from "../src/planner.js";
import { readHwpxPackage } from "../src/reader.js";
import { buildReferenceGraph } from "../src/referenceGraph.js";
import { detectStructuralOptimizationOpportunities } from "../src/structuralOpportunities.js";
import { createHwpxFixture } from "./fixtures.js";

const protectedFiles = {
  "BinData/font.ttf": Buffer.from("embedded font"),
  "BinData/font.woff2": Buffer.from("web font"),
  "BinData/object.ole": Buffer.from("embedded object")
};

describe("unused resource policy", () => {
  it("keeps fonts and objects out of safe and advanced removal plans", async () => {
    const pkg = await readHwpxPackage(await createHwpxFixture({ entries: {
      ...protectedFiles, "BinData/unused.bin": Buffer.from("unused")
    } }));
    const analysis = await analyzeHwpxPackage(pkg);
    const safe = createSafeOptimizationPlan({ pkg, analysis, graph: buildReferenceGraph(pkg) });
    const advanced = await detectStructuralOptimizationOpportunities(pkg, analysis);
    expect(safe.actions.filter((a) => a.type === "remove-unused").map((a) => a.target))
      .toEqual(["BinData/unused.bin"]);
    expect(advanced.filter((a) => a.action === "remove-unused").map((a) => a.target))
      .toEqual(["BinData/unused.bin"]);
  });
  it.each([
    ["safe", optimizeHwpxBufferSafe], ["balanced", optimizeHwpxBufferBalanced],
    ["aggressive", optimizeHwpxBufferAggressive]
  ] as const)("preserves unreferenced fonts and objects through %s output", async (_mode, optimize) => {
    const input = await createHwpxFixture({ entries: {
      ...protectedFiles, "BinData/unused.bin": Buffer.alloc(16000, 4)
    } });
    const result = await optimize(input);
    const pkg = await readHwpxPackage(result.output);
    for (const [path, data] of Object.entries(protectedFiles)) {
      expect(pkg.entries.find((entry) => entry.path === path)?.data).toEqual(data);
    }
    expect(result.report.actions.applied.some((a) => Object.hasOwn(protectedFiles, a.target) &&
      a.type === "remove-unused")).toBe(false);
  });
  it("enforces preservation even when a caller supplies a removal plan", async () => {
    const pkg = await readHwpxPackage(await createHwpxFixture({ entries: protectedFiles }));
    const result = await applySafeOptimizationPlan({ pkg, plan: { mode: "safe", actions:
      Object.keys(protectedFiles).map((target) => ({ type: "remove-unused", target, risk: "safe" }))
    } });
    expect(result.pkg.entries).toEqual(pkg.entries);
    expect(result.applied).toEqual([]);
    expect(result.skipped).toHaveLength(3);
  });
});
