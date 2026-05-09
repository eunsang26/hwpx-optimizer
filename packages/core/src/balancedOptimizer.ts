import { XMLBuilder, XMLParser } from "fast-xml-parser";
import { mapLimit } from "./concurrency.js";
import { findImageConsolidationGroups } from "./imageDuplicates.js";
import { getRecommendedImagePixelBudgets } from "./imageDisplay.js";
import { balancedImageProfile, cleanShapeComments, outputMediaType, transformImageActionWithBudget } from "./opportunities.js";
import type { ImageOptimizationProfile, TransformImageAction } from "./opportunities.js";
import type { AppliedAction, HwpxEntry, HwpxPackage, OptimizationPlan } from "./types.js";
import { getStringAttribute, getXmlAttributes, isXmlNode, setAttribute } from "./xmlNode.js";
import type { XmlNode } from "./xmlNode.js";

const IMAGE_TRANSFORM_CONCURRENCY = 4;

export async function applyBalancedOptimizationPlan(input: {
  pkg: HwpxPackage;
  plan: OptimizationPlan;
  profile?: ImageOptimizationProfile;
}): Promise<{ pkg: HwpxPackage; applied: AppliedAction[]; skipped: AppliedAction[] }> {
  const profile = input.profile ?? balancedImageProfile;
  const duplicateTargets = new Set(
    input.plan.actions.filter((action) => action.type === "consolidate-duplicate-images").map((action) => action.target)
  );
  const consolidated = await consolidateDuplicateImages(input.pkg, duplicateTargets);
  const applied: AppliedAction[] = [...consolidated.applied];
  const skipped: AppliedAction[] = [...consolidated.skipped];
  const transformTargets = new Set(
    input.plan.actions
      .filter(
        (action) =>
          action.type === "convert-bmp-to-png" ||
          action.type === "convert-tiff-to-png" ||
          action.type === "resize-jpeg" ||
          action.type === "resize-png" ||
          action.type === "strip-metadata" ||
          action.type === "optimize-png"
      )
      .map((action) => action.target)
  );
  const pathUpdates = new Map<string, string>();
  const mediaTypeUpdates = new Map<string, string>();
  const resizeBudgets = getRecommendedImagePixelBudgets(consolidated.pkg, profile.displayScale);

  type TransformTask = { index: number; entry: HwpxEntry; action: TransformImageAction };
  type TransformOutcome =
    | { index: number; entry: HwpxEntry; action: TransformImageAction; status: "transformed"; outputPath: string; data: Buffer }
    | { index: number; entry: HwpxEntry; action: TransformImageAction; status: "skipped"; size?: number };

  const transformedEntries = new Array<HwpxEntry>(consolidated.pkg.entries.length);
  const tasks: TransformTask[] = [];
  for (const [index, entry] of consolidated.pkg.entries.entries()) {
    if (!transformTargets.has(entry.path)) {
      transformedEntries[index] = entry;
      continue;
    }

    const action = input.plan.actions.find((item) => item.target === entry.path);
    if (
      !action ||
      (action.type !== "convert-bmp-to-png" &&
        action.type !== "convert-tiff-to-png" &&
        action.type !== "resize-jpeg" &&
        action.type !== "resize-png" &&
        action.type !== "strip-metadata" &&
        action.type !== "optimize-png")
    ) {
      transformedEntries[index] = entry;
      continue;
    }

    tasks.push({ index, entry, action: action.type });
  }

  const outcomes = await mapLimit(tasks, IMAGE_TRANSFORM_CONCURRENCY, async (task): Promise<TransformOutcome> => {
    try {
      const transformed = await transformImageActionWithBudget(
        task.entry.path,
        task.entry.data,
        task.action,
        resizeBudgets.get(task.entry.path),
        profile
      );
      if (transformed.data.byteLength >= task.entry.data.byteLength) {
        return { ...task, status: "skipped", size: transformed.data.byteLength };
      }
      return { ...task, status: "transformed", outputPath: transformed.outputPath, data: transformed.data };
    } catch {
      return { ...task, status: "skipped" };
    }
  });

  for (const outcome of outcomes) {
    if (outcome.status === "skipped") {
      transformedEntries[outcome.index] = outcome.entry;
      skipped.push({
        type: outcome.action,
        target: outcome.entry.path,
        beforeSize: outcome.entry.size,
        ...(outcome.size === undefined ? {} : { afterSize: outcome.size })
      });
      continue;
    }
    pathUpdates.set(outcome.entry.path, outcome.outputPath);
    mediaTypeUpdates.set(outcome.outputPath, outputMediaType(outcome.outputPath));
    transformedEntries[outcome.index] = {
      ...outcome.entry,
      path: outcome.outputPath,
      data: outcome.data,
      size: outcome.data.byteLength,
      kind: "image"
    };
    applied.push({
      type: outcome.action,
      target: outcome.entry.path,
      beforeSize: outcome.entry.size,
      afterSize: outcome.data.byteLength
    });
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

async function consolidateDuplicateImages(
  pkg: HwpxPackage,
  targets: Set<string>
): Promise<{ pkg: HwpxPackage; applied: AppliedAction[]; skipped: AppliedAction[] }> {
  if (targets.size === 0) return { pkg, applied: [], skipped: [] };

  const canonicalByDuplicatePath = new Map<string, string>();
  const duplicateSizes = new Map<string, number>();
  const imageSizes = new Map(pkg.entries.filter((entry) => entry.kind === "image").map((entry) => [entry.path, entry.size]));
  for (const group of await findImageConsolidationGroups(pkg)) {
    for (const duplicatePath of group.paths) {
      if (duplicatePath === group.canonicalPath || !targets.has(duplicatePath)) continue;
      canonicalByDuplicatePath.set(duplicatePath, group.canonicalPath);
      duplicateSizes.set(duplicatePath, imageSizes.get(duplicatePath) ?? 0);
    }
  }

  const manifest = extractManifestItems(pkg);
  const idUpdates = new Map<string, string>();
  const duplicatePathUpdates = new Map<string, string>();
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
    duplicatePathUpdates.set(target, canonicalPath);
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
      const updated = updateDuplicateImageXml(entry.data.toString("utf8"), idUpdates, duplicatePathUpdates, removeIds, removePaths);
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
    if (!isXmlNode(node)) continue;
    const attrs = getXmlAttributes(node);
    if (attrs) {
      const href = getStringAttribute(attrs, "href");
      if (href) {
        const updatedPath = pathUpdates.get(href);
        if (updatedPath) {
          setAttribute(attrs, "href", updatedPath);
          const updatedMediaType = mediaTypeUpdates.get(updatedPath);
          if (updatedMediaType) setAttribute(attrs, "media-type", updatedMediaType);
          changed = true;
        }
      }
    }

    for (const value of Object.values(node)) {
      if (Array.isArray(value) && updateHrefAttributes(value, pathUpdates, mediaTypeUpdates)) {
        changed = true;
      }
    }
  }

  return changed;
}

function updateDuplicateImageXml(
  xml: string,
  idUpdates: Map<string, string>,
  duplicatePathUpdates: Map<string, string>,
  removeIds: Set<string>,
  removePaths: Set<string>
): string {
  try {
    const document = parseXml(xml);
    const changed = updateDuplicateImageNodes(document, idUpdates, duplicatePathUpdates, removeIds, removePaths);
    return changed ? buildXml(document) : xml;
  } catch {
    return xml;
  }
}

function updateDuplicateImageNodes(
  nodes: unknown,
  idUpdates: Map<string, string>,
  duplicatePathUpdates: Map<string, string>,
  removeIds: Set<string>,
  removePaths: Set<string>
): boolean {
  if (!Array.isArray(nodes)) return false;

  let changed = false;
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (!isXmlNode(node)) continue;
    const attrs = getXmlAttributes(node);
    if (attrs) {
      const hrefKey = findHrefAttributeKey(attrs);
      const href = hrefKey ? getStringAttribute(attrs, hrefKey) : undefined;
      const id = getStringAttribute(attrs, "id");
      if (id && removeIds.has(id) && href && isRemovedPackagePath(href, removePaths)) {
        nodes.splice(index, 1);
        changed = true;
        continue;
      }
      for (const key of findPackagePathAttributeKeys(attrs)) {
        const value = attrs[key];
        if (typeof value !== "string") continue;
        const updatedPath = findUpdatedPackagePath(value, duplicatePathUpdates);
        if (updatedPath) {
          setAttribute(attrs, key, updatedPath);
          changed = true;
        }
      }
      for (const key of Object.keys(attrs)) {
        if (!isIdReferenceAttribute(key)) continue;
        const value = attrs[key];
        if (typeof value !== "string") continue;
        const updatedId = idUpdates.get(value);
        if (updatedId) {
          setAttribute(attrs, key, updatedId);
          changed = true;
        }
      }
    }

    for (const value of Object.values(node)) {
      if (Array.isArray(value) && updateDuplicateImageNodes(value, idUpdates, duplicatePathUpdates, removeIds, removePaths)) {
        changed = true;
      }
    }
  }

  return changed;
}

function collectManifestItems(nodes: unknown, idByPath: Map<string, string>): void {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    if (!isXmlNode(node)) continue;
    const attrs = getXmlAttributes(node);
    if (attrs) {
      const id = getStringAttribute(attrs, "id");
      const href = getStringAttribute(attrs, "href");
      const normalizedHref = href ? normalizePackagePath(href) : null;
      if (id && normalizedHref) idByPath.set(normalizedHref, id);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) collectManifestItems(value, idByPath);
    }
  }
}

function isIdReferenceAttribute(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized === "binaryitemidref" || normalized.endsWith("ref") || normalized.endsWith("idref");
}

function findHrefAttributeKey(attrs: Record<string, unknown>): string | null {
  return Object.keys(attrs).find((key) => key.toLowerCase() === "href" || key.toLowerCase().endsWith(":href")) ?? null;
}

function findPackagePathAttributeKeys(attrs: Record<string, unknown>): string[] {
  return Object.keys(attrs).filter((key) => typeof attrs[key] === "string" && normalizePackagePath(attrs[key]) !== null);
}

function isRemovedPackagePath(value: string, removePaths: Set<string>): boolean {
  const normalized = normalizePackagePath(value);
  return Boolean(normalized && removePaths.has(normalized));
}

function findUpdatedPackagePath(value: string, pathUpdates: Map<string, string>): string | null {
  const normalized = normalizePackagePath(value);
  return normalized ? pathUpdates.get(normalized) ?? null : null;
}

function normalizePackagePath(value: string): string | null {
  const cleaned = decodePath(value.trim()).replace(/^#/, "").replace(/^\.?\//, "").replace(/\\/g, "/");
  const binDataIndex = cleaned.toLowerCase().indexOf("bindata/");
  if (binDataIndex < 0) return null;
  const resourcePath = cleaned.slice(binDataIndex);
  if (resourcePath.split("/").some((segment) => segment === ".." || segment === "." || segment === "")) return null;
  return resourcePath;
}

function decodePath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
