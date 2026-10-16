import { deflateRawSync } from "node:zlib";
import type { HwpxEntry, HwpxPackage, OptimizationOpportunity, PackageSizeEstimate } from "./types.js";
import { evaluatePackageSizeEstimate } from "./planning.js";
import { minifyXmlBuffer } from "./xmlMinify.js";
import { stripJpegMetadataSegments } from "./optimizer.js";
import { cleanShapeComments } from "./opportunities.js";

export type PackageSizeProjectionOptions = { palettePng?: boolean };

/** Preserve the measured source ZIP baseline and change only known candidate payloads.
 * Deep encoded candidates still do not measure final ZIP headers, combined XML
 * rewrites, quality rollback, target search, or final no-growth fallback.
 */
export function createPackageSizeEstimate(pkg: HwpxPackage, opportunities: readonly OptimizationOpportunity[]): PackageSizeEstimate {
  const sourceZip = pkg.sourceSize !== undefined;
  const beforeSizes = new Map(pkg.entries.map(entry => [entry.path,
    entry.compressedSize ?? (sourceZip ? 0 : deflateRawSync(entry.data, { level: 9 }).length)]));
  const overhead = sourceZip
    ? Math.max(0, pkg.sourceSize! - [...beforeSizes.values()].reduce((sum, size) => sum + size, 0))
    : 22 + pkg.entries.reduce((sum, entry) => sum + 76 + 2 * Buffer.byteLength(entry.path), 0);
  const originalSize = pkg.sourceSize ?? overhead + [...beforeSizes.values()].reduce((sum, size) => sum + size, 0);
  const entries = new Map(pkg.entries.map(entry => [entry.path, entry]));
  const adjustments: PackageSizeEstimate["adjustments"] = [];
  for (const opportunity of opportunities) {
    const entry = entries.get(opportunity.target);
    // Unicode extra-field names may not match the raw directory. Remain
    // conservative instead of attributing an unrelated compressed record.
    if (!entry || (sourceZip && entry.compressedSize === undefined)) continue;
    const before = beforeSizes.get(entry.path)!;
    const after = candidateCompressedBytes(entry, opportunity);
    adjustments.push({ target: entry.path, action: opportunity.action,
      savingBytes: before - after,
      jpegBytes: opportunity.action === "resize-jpeg" ? after : 0 });
  }
  return { basis: sourceZip ? "source-zip" : "entry-model", originalSize,
    minimumSize: Math.min(originalSize, Math.max(22, overhead)), adjustments };
}

export function projectPackageSizeFromOpportunities(pkg: HwpxPackage, opportunities: readonly OptimizationOpportunity[], _options: PackageSizeProjectionOptions = {}): number {
  return evaluatePackageSizeEstimate(createPackageSizeEstimate(pkg, opportunities)).size;
}

function candidateCompressedBytes(entry: HwpxEntry, opportunity: OptimizationOpportunity): number {
  if (opportunity.afterSize === 0) return 0; // Header/manifest savings are intentionally not promised.
  if (opportunity.compressedAfterSize !== undefined) return opportunity.compressedAfterSize;
  let candidate: Buffer | undefined;
  if (opportunity.action === "minify-xml") candidate = minifyXmlBuffer(entry.data);
  if (opportunity.action === "strip-metadata") candidate = stripJpegMetadataSegments(entry.data);
  if (opportunity.action === "clean-shape-comment") candidate = Buffer.from(cleanShapeComments(entry.data.toString("utf8")));
  if (candidate) return deflateRawSync(candidate, { level: 9 }).length;
  // Header-only analysis cannot measure image compressibility. Encoded JPEG/PNG
  // usually change little in ZIP; a conservative near-STORE estimate also avoids
  // counting large raw BMP savings against an already highly compressed source.
  return Math.max(1, Math.round(opportunity.afterSize * 0.995));
}
