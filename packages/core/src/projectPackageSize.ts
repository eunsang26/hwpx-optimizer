import type { HwpxEntry, HwpxPackage, OptimizationOpportunity } from "./types.js";

export type PackageSizeProjectionOptions = {
  /** Aggressive palette PNGs deflate better inside ZIP than photographic PNGs. */
  palettePng?: boolean;
};

/**
 * Project final ZIP package bytes from measured/estimated per-entry after sizes.
 *
 * Opportunity savings are entry (uncompressed) deltas. Subtracting them from the
 * original package size is wrong when BMP→PNG changes compressibility. This
 * rebuilds an uncompressed layout then applies format-aware DEFLATE factors.
 */
export function projectPackageSizeFromOpportunities(
  pkg: HwpxPackage,
  opportunities: readonly OptimizationOpportunity[],
  options: PackageSizeProjectionOptions = {}
): number {
  const byTarget = pickBestOpportunityPerTarget(opportunities);
  const palettePng = Boolean(options.palettePng);
  let packed = 0;

  for (const entry of pkg.entries) {
    const opportunity = byTarget.get(entry.path);
    if (opportunity) {
      packed += packEntryBytes(opportunity.afterSize, projectedKind(entry, opportunity), palettePng);
      continue;
    }
    packed += packEntryBytes(entry.size, entryKindForPack(entry), palettePng);
  }

  // ZIP central directory / local headers — small but keeps tiny packages honest.
  const overhead = 64 + pkg.entries.length * 80;
  return Math.max(0, Math.round(packed + overhead));
}

function pickBestOpportunityPerTarget(
  opportunities: readonly OptimizationOpportunity[]
): Map<string, OptimizationOpportunity> {
  const byTarget = new Map<string, OptimizationOpportunity>();
  for (const opportunity of opportunities) {
    const previous = byTarget.get(opportunity.target);
    if (!previous || opportunity.estimatedSavingBytes > previous.estimatedSavingBytes) {
      byTarget.set(opportunity.target, opportunity);
    }
  }
  return byTarget;
}

function projectedKind(
  entry: HwpxEntry,
  opportunity: OptimizationOpportunity
): "xml" | "jpeg" | "png" | "raw" | "other" {
  if (
    opportunity.action === "convert-bmp-to-png" ||
    opportunity.action === "convert-tiff-to-png" ||
    opportunity.action === "resize-png" ||
    opportunity.action === "optimize-png"
  ) {
    return "png";
  }
  if (opportunity.action === "resize-jpeg" || opportunity.action === "strip-metadata") {
    return "jpeg";
  }
  return entryKindForPack(entry);
}

function entryKindForPack(entry: HwpxEntry): "xml" | "jpeg" | "png" | "raw" | "other" {
  if (entry.kind === "xml" || /\.xml$/i.test(entry.path)) return "xml";
  if (/\.jpe?g$/i.test(entry.path)) return "jpeg";
  if (/\.png$/i.test(entry.path)) return "png";
  if (/\.bmp$/i.test(entry.path) || /\.tif{1,2}$/i.test(entry.path)) return "raw";
  return "other";
}

function packEntryBytes(
  size: number,
  kind: "xml" | "jpeg" | "png" | "raw" | "other",
  palettePng: boolean
): number {
  if (size <= 0) return 0;
  if (kind === "xml") return size * 0.34;
  if (kind === "jpeg") return size * 0.985;
  if (kind === "png") return size * (palettePng ? 0.72 : 0.97);
  if (kind === "raw") return size * 0.55;
  return size * 0.9;
}
