import { XMLBuilder, XMLParser } from "fast-xml-parser";
import sharp from "sharp";
import type { AppliedAction, HwpxPackage, OptimizationPlan } from "./types.js";

export async function applySafeOptimizationPlan(input: {
  pkg: HwpxPackage;
  plan: OptimizationPlan;
}): Promise<{ pkg: HwpxPackage; applied: AppliedAction[]; skipped: AppliedAction[] }> {
  const applied: AppliedAction[] = [];
  const skipped: AppliedAction[] = [];
  const removeTargets = new Set(
    input.plan.actions.filter((action) => action.type === "remove-unused").map((action) => action.target)
  );

  const entries = [];
  for (const entry of input.pkg.entries) {
    if (removeTargets.has(entry.path)) {
      applied.push({ type: "remove-unused", target: entry.path, beforeSize: entry.size, afterSize: 0 });
      continue;
    }

    const strip = input.plan.actions.find(
      (action) => action.type === "strip-metadata" && action.target === entry.path
    );
    if (strip) {
      try {
        const optimized = await sharp(entry.data).toBuffer();
        entries.push({ ...entry, data: optimized, size: optimized.byteLength });
        applied.push({
          type: "strip-metadata",
          target: entry.path,
          beforeSize: entry.size,
          afterSize: optimized.byteLength
        });
        continue;
      } catch {
        skipped.push({ type: "strip-metadata", target: entry.path, beforeSize: entry.size });
      }
    }

    const minify = input.plan.actions.find(
      (action) => action.type === "minify-xml" && action.target === entry.path
    );
    if (minify) {
      try {
        const minified = minifyXml(entry.data.toString("utf8"));
        const data = Buffer.from(minified);
        entries.push({ ...entry, data, size: data.byteLength });
        applied.push({ type: "minify-xml", target: entry.path, beforeSize: entry.size, afterSize: data.byteLength });
        continue;
      } catch {
        skipped.push({ type: "minify-xml", target: entry.path, beforeSize: entry.size });
      }
    }

    entries.push(entry);
  }

  return { pkg: { entries }, applied, skipped };
}

function minifyXml(xml: string): string {
  const parser = new XMLParser({ ignoreAttributes: false, preserveOrder: true });
  const builder = new XMLBuilder({ ignoreAttributes: false, preserveOrder: true, suppressEmptyNode: false });
  return builder.build(parser.parse(xml));
}
