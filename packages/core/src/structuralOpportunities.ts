import { minifyXmlBuffer } from "./xmlMinify.js";
import { findImageConsolidationGroups } from "./imageDuplicates.js";
import type {
  HwpxPackage,
  OptimizationOpportunity,
  PackageAnalysis
} from "./types.js";

export async function detectStructuralOptimizationOpportunities(
  pkg: HwpxPackage,
  analysis: PackageAnalysis,
  options: { imageConcurrency?: number } = {}
): Promise<OptimizationOpportunity[]> {
  const opportunities: OptimizationOpportunity[] = [];
  const duplicateMemberPaths = new Set(
    (
      await findImageConsolidationGroups(pkg, {
        imageConcurrency: options.imageConcurrency
      })
    ).flatMap((group) => group.paths)
  );
  const riskyResourcePaths = new Set(analysis.riskyResources.map((resource) => resource.path));

  for (const entry of pkg.entries) {
    if (entry.kind !== "xml") continue;
    try {
      const minified = minifyXmlBuffer(entry.data);
      if (minified.byteLength >= entry.size) continue;
      opportunities.push({
        id: `minify-xml:${entry.path}`,
        label: "Minify document XML",
        action: "minify-xml",
        target: entry.path,
        estimatedSavingBytes: entry.size - minified.byteLength,
        beforeSize: entry.size,
        afterSize: minified.byteLength,
        confidence: "exact",
        risk: "safe",
        visualImpact: "none",
        defaultEnabledIn: ["safe", "balanced", "aggressive"]
      });
    } catch {
      // Malformed or unsupported XML is left untouched and remains visible to
      // the verifier instead of becoming a misleading optimization candidate.
    }
  }

  for (const resource of analysis.unusedBinData) {
    if (
      resource.size <= 0 ||
      resource.kind === "font" ||
      resource.kind === "ole" ||
      riskyResourcePaths.has(resource.path) ||
      duplicateMemberPaths.has(resource.path)
    ) {
      continue;
    }
    opportunities.push({
      id: `remove-unused:${resource.path}`,
      label: "Remove unused BinData",
      action: "remove-unused",
      target: resource.path,
      estimatedSavingBytes: resource.size,
      beforeSize: resource.size,
      afterSize: 0,
      confidence: "exact",
      risk: "safe",
      visualImpact: "none",
      defaultEnabledIn: ["safe", "balanced", "aggressive"]
    });
  }

  return opportunities.sort((left, right) => right.estimatedSavingBytes - left.estimatedSavingBytes);
}
