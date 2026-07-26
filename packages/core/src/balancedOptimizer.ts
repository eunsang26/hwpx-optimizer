import { XMLBuilder, XMLParser } from "fast-xml-parser";
import { mapLimit, resolveImageConcurrency } from "./concurrency.js";
import { findImageConsolidationGroups } from "./imageDuplicates.js";
import { getRecommendedImagePixelBudgets } from "./imageDisplay.js";
import { readImageMetadata } from "./imageMetadata.js";
import { applySafeOptimizationPlan } from "./optimizer.js";
import { balancedImageProfile, cleanShapeComments, outputMediaType, transformImageActionWithBudget } from "./opportunities.js";
import type { ImageOptimizationProfile, TransformImageAction } from "./opportunities.js";
import { normalizePackagePath } from "./packagePath.js";
import type { AppliedAction, HwpxEntry, HwpxPackage, OptimizationPlan } from "./types.js";
import { getStringAttribute, getXmlAttributes, isXmlNode, setAttribute } from "./xmlNode.js";
import type { XmlNode } from "./xmlNode.js";

type PixelBudget = { width: number; height: number };

export async function applyBalancedOptimizationPlan(input: {
  pkg: HwpxPackage;
  plan: OptimizationPlan;
  profile?: ImageOptimizationProfile;
  onTransformProgress?: (progress: { completed: number; total: number; target: string; action: TransformImageAction }) => void;
  imageConcurrency?: number;
}): Promise<{ pkg: HwpxPackage; applied: AppliedAction[]; skipped: AppliedAction[]; warnings: string[] }> {
  const profile = input.profile ?? balancedImageProfile;
  const structuralPlan: OptimizationPlan = {
    mode: input.plan.mode,
    actions: input.plan.actions.filter(
      (action) => action.type === "minify-xml" || action.type === "remove-unused"
    )
  };
  const structurallyOptimized = await applySafeOptimizationPlan({
    pkg: input.pkg,
    plan: structuralPlan,
    imageConcurrency: input.imageConcurrency
  });
  const duplicateTargets = new Set(
    input.plan.actions.filter((action) => action.type === "consolidate-duplicate-images").map((action) => action.target)
  );
  const consolidated = await consolidateDuplicateImages(
    structurallyOptimized.pkg,
    duplicateTargets,
    input.imageConcurrency
  );
  const applied: AppliedAction[] = [...structurallyOptimized.applied, ...consolidated.applied];
  const skipped: AppliedAction[] = [...structurallyOptimized.skipped, ...consolidated.skipped];
  const warnings: string[] = [...structurallyOptimized.warnings];
  const transformActionByTarget = new Map<string, TransformImageAction>();
  for (const action of input.plan.actions) {
    if (isTransformImageAction(action.type) && !transformActionByTarget.has(action.target)) {
      transformActionByTarget.set(action.target, action.type);
    }
  }
  const cleanShapeCommentTargets = new Set(
    input.plan.actions.filter((action) => action.type === "clean-shape-comment").map((action) => action.target)
  );
  const pathUpdates = new Map<string, string>();
  const mediaTypeUpdates = new Map<string, string>();
  // Budgets from the post-consolidation package can under-estimate needs: a
  // removed duplicate may have been shown larger (or with unparseable display
  // size) than the canonical's remaining pic. Raise the canonical floor using
  // pre-consolidation member budgets / source pixels so verifier collapse gates
  // and on-page sharpness stay valid for every former placement.
  const preConsolidationBudgets = getRecommendedImagePixelBudgets(structurallyOptimized.pkg, profile.displayScale);
  const resizeBudgets = getRecommendedImagePixelBudgets(consolidated.pkg, profile.displayScale);
  await expandResizeBudgetsForConsolidatedDuplicates({
    originalPkg: structurallyOptimized.pkg,
    resizeBudgets,
    preConsolidationBudgets,
    profile,
    imageConcurrency: input.imageConcurrency
  });

  type TransformTask = { index: number; entry: HwpxEntry; action: TransformImageAction };
  type TransformOutcome =
    | { index: number; entry: HwpxEntry; action: TransformImageAction; status: "transformed"; outputPath: string; data: Buffer }
    | { index: number; entry: HwpxEntry; action: TransformImageAction; status: "skipped"; size?: number; reason?: string };

  const transformedEntries = new Array<HwpxEntry>(consolidated.pkg.entries.length);
  const tasks: TransformTask[] = [];
  for (const [index, entry] of consolidated.pkg.entries.entries()) {
    const action = transformActionByTarget.get(entry.path);
    if (!action) {
      transformedEntries[index] = entry;
      continue;
    }

    tasks.push({ index, entry, action });
  }

  let completedTransforms = 0;
  const outcomes = await mapLimit(tasks, resolveImageConcurrency(input.imageConcurrency), async (task): Promise<TransformOutcome> => {
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
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ...task, status: "skipped", reason };
    } finally {
      completedTransforms += 1;
      input.onTransformProgress?.({
        completed: completedTransforms,
        total: tasks.length,
        target: task.entry.path,
        action: task.action
      });
    }
  });

  // Every existing entry path starts out occupied. A transform that changes an
  // extension (BMP/TIFF->PNG, JPEG->.jpg) must not land on a path already used by
  // another entry, or repackaging would collapse two entries onto one zip name.
  // On collision, allocate a unique sibling path (e.g. image1-opt.png) and rewrite
  // manifest/XML refs to that path instead of skipping the conversion.
  const occupiedPaths = new Set(consolidated.pkg.entries.map((entry) => entry.path));

  for (const outcome of outcomes) {
    if (outcome.status === "skipped") {
      transformedEntries[outcome.index] = outcome.entry;
      if (outcome.reason !== undefined) {
        warnings.push(`${outcome.action} skipped for ${outcome.entry.path}: ${outcome.reason}`);
      }
      skipped.push({
        type: outcome.action,
        target: outcome.entry.path,
        beforeSize: outcome.entry.size,
        ...(outcome.size === undefined ? {} : { afterSize: outcome.size })
      });
      continue;
    }
    let outputPath = outcome.outputPath;
    if (outputPath !== outcome.entry.path && occupiedPaths.has(outputPath)) {
      outputPath = allocateUniqueOutputPath(outputPath, occupiedPaths);
      warnings.push(
        `${outcome.action} for ${outcome.entry.path}: output path ${outcome.outputPath} collided; wrote ${outputPath}`
      );
    }
    if (outputPath !== outcome.entry.path) {
      occupiedPaths.delete(outcome.entry.path);
      occupiedPaths.add(outputPath);
    }
    pathUpdates.set(outcome.entry.path, outputPath);
    mediaTypeUpdates.set(outputPath, outputMediaType(outputPath));
    transformedEntries[outcome.index] = {
      ...outcome.entry,
      path: outputPath,
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
    const shouldCleanShapeComment = cleanShapeCommentTargets.has(entry.path);
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

  return { pkg: { entries }, applied, skipped, warnings };
}

function isTransformImageAction(action: string): action is TransformImageAction {
  return (
    action === "convert-bmp-to-png" ||
    action === "convert-tiff-to-png" ||
    action === "resize-jpeg" ||
    action === "resize-png" ||
    action === "strip-metadata" ||
    action === "optimize-png"
  );
}

function allocateUniqueOutputPath(desiredPath: string, occupiedPaths: Set<string>): string {
  if (!occupiedPaths.has(desiredPath)) return desiredPath;
  const match = /^(.*?)(\.[^./]+)$/.exec(desiredPath);
  const base = match?.[1] ?? desiredPath;
  const extension = match?.[2] ?? "";
  for (let index = 1; index < 10_000; index += 1) {
    const suffix = index === 1 ? "-opt" : `-opt${index}`;
    const candidate = `${base}${suffix}${extension}`;
    if (!occupiedPaths.has(candidate)) return candidate;
  }
  throw new Error(`Unable to allocate unique output path for ${desiredPath}`);
}

async function expandResizeBudgetsForConsolidatedDuplicates(input: {
  originalPkg: HwpxPackage;
  resizeBudgets: Map<string, PixelBudget>;
  preConsolidationBudgets: Map<string, PixelBudget>;
  profile: ImageOptimizationProfile;
  imageConcurrency?: number;
}): Promise<void> {
  const entriesByPath = new Map(
    input.originalPkg.entries.filter((entry) => entry.kind === "image").map((entry) => [entry.path, entry])
  );
  const groups = await findImageConsolidationGroups(input.originalPkg, {
    imageConcurrency: input.imageConcurrency
  });

  await mapLimit(groups, resolveImageConcurrency(input.imageConcurrency), async (group) => {
    let maxWidth = 0;
    let maxHeight = 0;
    for (const path of group.paths) {
      const displayBudget = input.preConsolidationBudgets.get(path);
      if (displayBudget) {
        maxWidth = Math.max(maxWidth, displayBudget.width);
        maxHeight = Math.max(maxHeight, displayBudget.height);
        continue;
      }
      const entry = entriesByPath.get(path);
      if (!entry) continue;
      const metadata = await readImageMetadata(path, entry.data, { rotate: true });
      if (!metadata.width || !metadata.height) continue;
      // No parseable display size: keep source pixels (capped by mode maxEdge).
      maxWidth = Math.max(maxWidth, Math.min(metadata.width, input.profile.maxEdge));
      maxHeight = Math.max(maxHeight, Math.min(metadata.height, input.profile.maxEdge));
    }
    if (maxWidth <= 0 || maxHeight <= 0) return;

    const current = input.resizeBudgets.get(group.canonicalPath);
    input.resizeBudgets.set(group.canonicalPath, {
      width: Math.max(current?.width ?? 0, maxWidth),
      height: Math.max(current?.height ?? 0, maxHeight)
    });
  });
}

async function consolidateDuplicateImages(
  pkg: HwpxPackage,
  targets: Set<string>,
  imageConcurrency?: number
): Promise<{ pkg: HwpxPackage; applied: AppliedAction[]; skipped: AppliedAction[] }> {
  if (targets.size === 0) return { pkg, applied: [], skipped: [] };

  const canonicalByDuplicatePath = new Map<string, string>();
  const duplicateSizes = new Map<string, number>();
  const imageSizes = new Map(pkg.entries.filter((entry) => entry.kind === "image").map((entry) => [entry.path, entry.size]));
  for (const group of await findImageConsolidationGroups(pkg, { imageConcurrency })) {
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
      const hrefKey = findHrefAttributeKey(attrs);
      for (const key of findPackagePathAttributeKeys(attrs)) {
        const value = attrs[key];
        if (typeof value !== "string") continue;
        const updatedPath = findUpdatedPackagePath(value, pathUpdates);
        if (updatedPath) {
          setAttribute(attrs, key, updatedPath);
          const updatedMediaType = mediaTypeUpdates.get(updatedPath);
          if (updatedMediaType && key === hrefKey) {
            const mediaTypeKey = findMediaTypeAttributeKey(attrs);
            if (mediaTypeKey) setAttribute(attrs, mediaTypeKey, updatedMediaType);
          }
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

function findMediaTypeAttributeKey(attrs: Record<string, unknown>): string | null {
  return (
    Object.keys(attrs).find((key) => {
      const normalized = key.toLowerCase();
      return normalized === "media-type" || normalized === "mediatype" || normalized.endsWith(":media-type");
    }) ?? null
  );
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
