import { XMLBuilder, XMLParser } from "fast-xml-parser";
import { getRecommendedImagePixelBudgets } from "./imageDisplay.js";
import { balancedImageProfile, cleanShapeComments, outputMediaType, transformImageBalancedWithBudget } from "./opportunities.js";
import type { ImageOptimizationProfile } from "./opportunities.js";
import type { AppliedAction, HwpxPackage, OptimizationPlan } from "./types.js";

export async function applyBalancedOptimizationPlan(input: {
  pkg: HwpxPackage;
  plan: OptimizationPlan;
  profile?: ImageOptimizationProfile;
}): Promise<{ pkg: HwpxPackage; applied: AppliedAction[]; skipped: AppliedAction[] }> {
  const profile = input.profile ?? balancedImageProfile;
  const applied: AppliedAction[] = [];
  const skipped: AppliedAction[] = [];
  const transformTargets = new Set(
    input.plan.actions
      .filter((action) => action.type === "convert-bmp-to-png" || action.type === "resize-jpeg" || action.type === "optimize-png")
      .map((action) => action.target)
  );
  const pathUpdates = new Map<string, string>();
  const mediaTypeUpdates = new Map<string, string>();
  const resizeBudgets = getRecommendedImagePixelBudgets(input.pkg, profile.displayScale);

  const transformedEntries = [];
  for (const entry of input.pkg.entries) {
    if (!transformTargets.has(entry.path)) {
      transformedEntries.push(entry);
      continue;
    }

    const action = input.plan.actions.find((item) => item.target === entry.path);
    if (!action || (action.type !== "convert-bmp-to-png" && action.type !== "resize-jpeg" && action.type !== "optimize-png")) {
      transformedEntries.push(entry);
      continue;
    }

    try {
      const transformed = await transformImageBalancedWithBudget(entry.path, entry.data, resizeBudgets.get(entry.path), profile);
      pathUpdates.set(entry.path, transformed.outputPath);
      mediaTypeUpdates.set(transformed.outputPath, outputMediaType(transformed.outputPath));
      transformedEntries.push({
        ...entry,
        path: transformed.outputPath,
        data: transformed.data,
        size: transformed.data.byteLength,
        kind: "image" as const
      });
      applied.push({
        type: action.type,
        target: entry.path,
        beforeSize: entry.size,
        afterSize: transformed.data.byteLength
      });
    } catch {
      transformedEntries.push(entry);
      skipped.push({ type: action.type, target: entry.path, beforeSize: entry.size });
    }
  }

  const entries = transformedEntries.map((entry) => {
    if (entry.kind !== "xml") return entry;
    const text = entry.data.toString("utf8");
    const updatedManifest = updateManifestReferences(text, pathUpdates, mediaTypeUpdates);
    const shouldCleanShapeComment = input.plan.actions.some(
      (action) => action.type === "clean-shape-comment" && action.target === entry.path
    );
    const updated = shouldCleanShapeComment ? cleanShapeComments(updatedManifest) : updatedManifest;
    if (updated === text) return entry;
    const data = Buffer.from(updated);
    if (shouldCleanShapeComment && updated !== updatedManifest) {
      applied.push({
        type: "clean-shape-comment",
        target: entry.path,
        beforeSize: entry.size,
        afterSize: data.byteLength
      });
    }
    return { ...entry, data, size: data.byteLength };
  });

  return { pkg: { entries }, applied, skipped };
}

function updateManifestReferences(
  xml: string,
  pathUpdates: Map<string, string>,
  mediaTypeUpdates: Map<string, string>
): string {
  if (pathUpdates.size === 0) return xml;

  try {
    const parser = new XMLParser({ ignoreAttributes: false, preserveOrder: true, attributeNamePrefix: "" });
    const document = parser.parse(xml) as XmlNode[];
    const changed = updateHrefAttributes(document, pathUpdates, mediaTypeUpdates);
    if (!changed) return xml;
    const builder = new XMLBuilder({
      ignoreAttributes: false,
      preserveOrder: true,
      attributeNamePrefix: "",
      suppressEmptyNode: true
    });
    return builder.build(document);
  } catch {
    return xml;
  }
}

type XmlNode = Record<string, unknown>;

function updateHrefAttributes(
  nodes: unknown,
  pathUpdates: Map<string, string>,
  mediaTypeUpdates: Map<string, string>
): boolean {
  if (!Array.isArray(nodes)) return false;

  let changed = false;
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const item = node as XmlNode;
    const attributes = item[":@"];
    if (attributes && typeof attributes === "object") {
      const attrs = attributes as Record<string, unknown>;
      const href = attrs.href;
      if (typeof href === "string") {
        const updatedPath = pathUpdates.get(href);
        if (updatedPath) {
          attrs.href = updatedPath;
          const updatedMediaType = mediaTypeUpdates.get(updatedPath);
          if (updatedMediaType) attrs["media-type"] = updatedMediaType;
          changed = true;
        }
      }
    }

    for (const value of Object.values(item)) {
      if (Array.isArray(value) && updateHrefAttributes(value, pathUpdates, mediaTypeUpdates)) {
        changed = true;
      }
    }
  }

  return changed;
}
