import type { HwpxPackage, OptimizationPlan, PackageAnalysis, ReferenceGraph } from "./types.js";

export function createSafeOptimizationPlan(input: {
  pkg: HwpxPackage;
  analysis: PackageAnalysis;
  graph: ReferenceGraph;
}): OptimizationPlan {
  const actions: OptimizationPlan["actions"] = [];

  for (const entry of input.pkg.entries) {
    if (entry.kind === "xml") {
      actions.push({ type: "minify-xml", target: entry.path, risk: "safe" });
    }
  }

  for (const image of input.analysis.images) {
    if (image.hasMetadata && canStripMetadataLosslessly(image.path)) {
      actions.push({ type: "strip-metadata", target: image.path, risk: "safe" });
    }
  }

  for (const resource of input.graph.resources.values()) {
    if (!resource.referenced && resource.path.startsWith("BinData/")) {
      actions.push({ type: "remove-unused", target: resource.path, risk: "safe" });
    }
  }

  actions.push({ type: "repack-zip", target: "*", risk: "safe" });

  return { mode: "safe", actions };
}

function canStripMetadataLosslessly(path: string): boolean {
  return /\.(jpe?g)$/i.test(path);
}
