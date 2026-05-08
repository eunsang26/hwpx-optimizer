import { outputMediaType, transformImageBalanced } from "./opportunities.js";
import type { AppliedAction, HwpxPackage, OptimizationPlan } from "./types.js";

export async function applyBalancedOptimizationPlan(input: {
  pkg: HwpxPackage;
  plan: OptimizationPlan;
}): Promise<{ pkg: HwpxPackage; applied: AppliedAction[]; skipped: AppliedAction[] }> {
  const applied: AppliedAction[] = [];
  const skipped: AppliedAction[] = [];
  const transformTargets = new Set(
    input.plan.actions
      .filter((action) => action.type === "convert-bmp-to-png" || action.type === "resize-jpeg")
      .map((action) => action.target)
  );
  const pathUpdates = new Map<string, string>();
  const mediaTypeUpdates = new Map<string, string>();

  const transformedEntries = [];
  for (const entry of input.pkg.entries) {
    if (!transformTargets.has(entry.path)) {
      transformedEntries.push(entry);
      continue;
    }

    const action = input.plan.actions.find((item) => item.target === entry.path);
    if (!action || (action.type !== "convert-bmp-to-png" && action.type !== "resize-jpeg")) {
      transformedEntries.push(entry);
      continue;
    }

    try {
      const transformed = await transformImageBalanced(entry.path, entry.data);
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
    const updated = updateManifestReferences(text, pathUpdates, mediaTypeUpdates);
    if (updated === text) return entry;
    const data = Buffer.from(updated);
    return { ...entry, data, size: data.byteLength };
  });

  return { pkg: { entries }, applied, skipped };
}

function updateManifestReferences(
  xml: string,
  pathUpdates: Map<string, string>,
  mediaTypeUpdates: Map<string, string>
): string {
  let updated = xml;
  for (const [from, to] of pathUpdates) {
    updated = updated.split(`href="${from}"`).join(`href="${to}"`);
    updated = updated.split(`href='${from}'`).join(`href='${to}'`);
    const mediaType = mediaTypeUpdates.get(to);
    if (mediaType) {
      updated = replaceItemMediaTypeForHref(updated, to, mediaType);
    }
  }
  return updated;
}

function replaceItemMediaTypeForHref(xml: string, href: string, mediaType: string): string {
  const escapedHref = escapeRegExp(href);
  return xml.replace(
    new RegExp(`(<[^>]+href=["']${escapedHref}["'][^>]*\\smedia-type=["'])[^"']+(["'][^>]*>)`, "g"),
    `$1${mediaType}$2`
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
