import { createHash } from "node:crypto";
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
  const duplicateTargets = new Set(
    input.plan.actions.filter((action) => action.type === "consolidate-duplicate-images").map((action) => action.target)
  );
  const consolidated = consolidateDuplicateImages(input.pkg, duplicateTargets);
  const applied: AppliedAction[] = [...consolidated.applied];
  const skipped: AppliedAction[] = [...consolidated.skipped];
  const transformTargets = new Set(
    input.plan.actions
      .filter((action) => action.type === "convert-bmp-to-png" || action.type === "resize-jpeg" || action.type === "optimize-png")
      .map((action) => action.target)
  );
  const pathUpdates = new Map<string, string>();
  const mediaTypeUpdates = new Map<string, string>();
  const resizeBudgets = getRecommendedImagePixelBudgets(consolidated.pkg, profile.displayScale);

  const transformedEntries = [];
  for (const entry of consolidated.pkg.entries) {
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
      if (transformed.data.byteLength >= entry.data.byteLength) {
        transformedEntries.push(entry);
        skipped.push({
          type: action.type,
          target: entry.path,
          beforeSize: entry.size,
          afterSize: transformed.data.byteLength
        });
        continue;
      }
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

function consolidateDuplicateImages(
  pkg: HwpxPackage,
  targets: Set<string>
): { pkg: HwpxPackage; applied: AppliedAction[]; skipped: AppliedAction[] } {
  if (targets.size === 0) return { pkg, applied: [], skipped: [] };

  const imagesByHash = new Map<string, Array<{ path: string; size: number }>>();
  for (const entry of pkg.entries) {
    if (entry.kind !== "image") continue;
    const hash = createHash("sha256").update(entry.data).digest("hex");
    const group = imagesByHash.get(hash) ?? [];
    group.push({ path: entry.path, size: entry.size });
    imagesByHash.set(hash, group);
  }

  const canonicalByDuplicatePath = new Map<string, string>();
  const duplicateSizes = new Map<string, number>();
  for (const group of imagesByHash.values()) {
    if (group.length < 2) continue;
    const sorted = group.sort((left, right) => left.path.localeCompare(right.path));
    const canonical = sorted[0]?.path;
    if (!canonical) continue;
    for (const duplicate of sorted.slice(1)) {
      if (!targets.has(duplicate.path)) continue;
      canonicalByDuplicatePath.set(duplicate.path, canonical);
      duplicateSizes.set(duplicate.path, duplicate.size);
    }
  }

  const manifest = extractManifestItems(pkg);
  const idUpdates = new Map<string, string>();
  const removeIds = new Set<string>();
  const removePaths = new Set<string>();
  const applied: AppliedAction[] = [];
  const skipped: AppliedAction[] = [];

  for (const target of targets) {
    const canonicalPath = canonicalByDuplicatePath.get(target);
    const duplicateId = manifest.idByPath.get(target);
    const canonicalId = canonicalPath ? manifest.idByPath.get(canonicalPath) : undefined;
    if (!canonicalPath || !duplicateId || !canonicalId) {
      skipped.push({ type: "consolidate-duplicate-images", target, beforeSize: duplicateSizes.get(target) });
      continue;
    }
    idUpdates.set(duplicateId, canonicalId);
    removeIds.add(duplicateId);
    removePaths.add(target);
    applied.push({
      type: "consolidate-duplicate-images",
      target,
      beforeSize: duplicateSizes.get(target),
      afterSize: 0
    });
  }

  if (removePaths.size === 0) return { pkg, applied, skipped };

  const entries = pkg.entries
    .filter((entry) => !removePaths.has(entry.path))
    .map((entry) => {
      if (entry.kind !== "xml") return entry;
      const updated = updateDuplicateImageXml(entry.data.toString("utf8"), idUpdates, removeIds, removePaths);
      if (updated === entry.data.toString("utf8")) return entry;
      const data = Buffer.from(updated);
      return { ...entry, data, size: data.byteLength };
    });

  return { pkg: { entries }, applied, skipped };
}

function extractManifestItems(pkg: HwpxPackage): { idByPath: Map<string, string> } {
  const idByPath = new Map<string, string>();
  for (const entry of pkg.entries) {
    if (entry.kind !== "xml") continue;
    try {
      const document = parseXml(entry.data.toString("utf8"));
      collectManifestItems(document, idByPath);
    } catch {
      continue;
    }
  }
  return { idByPath };
}

function updateManifestReferences(
  xml: string,
  pathUpdates: Map<string, string>,
  mediaTypeUpdates: Map<string, string>
): string {
  if (pathUpdates.size === 0) return xml;

  try {
    const document = parseXml(xml);
    const changed = updateHrefAttributes(document, pathUpdates, mediaTypeUpdates);
    if (!changed) return xml;
    return buildXml(document);
  } catch {
    return xml;
  }
}

type XmlNode = Record<string, unknown>;

function parseXml(xml: string): XmlNode[] {
  const parser = new XMLParser({ ignoreAttributes: false, preserveOrder: true, attributeNamePrefix: "" });
  return parser.parse(xml) as XmlNode[];
}

function buildXml(document: XmlNode[]): string {
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    preserveOrder: true,
    attributeNamePrefix: "",
    suppressEmptyNode: true
  });
  return builder.build(document);
}

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

function updateDuplicateImageXml(xml: string, idUpdates: Map<string, string>, removeIds: Set<string>, removePaths: Set<string>): string {
  try {
    const document = parseXml(xml);
    const changed = updateDuplicateImageNodes(document, idUpdates, removeIds, removePaths);
    return changed ? buildXml(document) : xml;
  } catch {
    return xml;
  }
}

function updateDuplicateImageNodes(
  nodes: unknown,
  idUpdates: Map<string, string>,
  removeIds: Set<string>,
  removePaths: Set<string>
): boolean {
  if (!Array.isArray(nodes)) return false;

  let changed = false;
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (!node || typeof node !== "object") continue;
    const item = node as XmlNode;
    const attributes = item[":@"];
    if (attributes && typeof attributes === "object") {
      const attrs = attributes as Record<string, unknown>;
      const href = attrs.href;
      const id = attrs.id;
      if ((typeof href === "string" && removePaths.has(href)) || (typeof id === "string" && removeIds.has(id))) {
        nodes.splice(index, 1);
        changed = true;
        continue;
      }
      const binaryItemIDRef = attrs.binaryItemIDRef;
      if (typeof binaryItemIDRef === "string") {
        const updatedId = idUpdates.get(binaryItemIDRef);
        if (updatedId) {
          attrs.binaryItemIDRef = updatedId;
          changed = true;
        }
      }
    }

    for (const value of Object.values(item)) {
      if (Array.isArray(value) && updateDuplicateImageNodes(value, idUpdates, removeIds, removePaths)) {
        changed = true;
      }
    }
  }

  return changed;
}

function collectManifestItems(nodes: unknown, idByPath: Map<string, string>): void {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const item = node as XmlNode;
    const attributes = item[":@"];
    if (attributes && typeof attributes === "object") {
      const attrs = attributes as Record<string, unknown>;
      if (typeof attrs.id === "string" && typeof attrs.href === "string") {
        idByPath.set(attrs.href, attrs.id);
      }
    }
    for (const value of Object.values(item)) {
      if (Array.isArray(value)) collectManifestItems(value, idByPath);
    }
  }
}
