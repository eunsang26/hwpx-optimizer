import { describe, expect, it } from "vitest";
import { analyzeHwpxBuffer, optimizeHwpxBufferBalanced, optimizeHwpxBufferSafe } from "../src/optimize.js";
import { verifyHwpxOutput } from "../src/verifier.js";
import { createReportLikeHwpxFixture } from "./fixtures.js";

describe("report-like HWPX regression fixture", () => {
  it("keeps analysis, optimization, and verification stable for a realistic report shape", async () => {
    const input = await createReportLikeHwpxFixture();

    const analysis = await analyzeHwpxBuffer(input, { analysisMode: "deep" });
    const safe = await optimizeHwpxBufferSafe(input);
    const balanced = await optimizeHwpxBufferBalanced(input, { targetBytes: Math.max(1, input.byteLength - 1024) });

    expect(analysis.images.length).toBeGreaterThanOrEqual(4);
    expect(analysis.duplicateImages).toEqual([
      expect.objectContaining({ paths: ["BinData/logo1.png", "BinData/logo2.png"] })
    ]);
    expect(analysis.unusedBinData).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "BinData/unused.bin" })])
    );
    expect(analysis.riskyResources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "font" }),
        expect.objectContaining({ kind: "ole" })
      ])
    );

    expect(safe.report.actions.applied).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "remove-unused", target: "BinData/unused.bin" })])
    );
    expect(balanced.output.byteLength).toBeLessThanOrEqual(input.byteLength);
    await expect(verifyHwpxOutput(safe.output, { original: input, mode: "safe" })).resolves.toBeUndefined();
    await expect(verifyHwpxOutput(balanced.output, { original: input, mode: "balanced" })).resolves.toBeUndefined();
  }, 15_000);
});
