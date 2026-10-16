// Browser-safe pure planning contracts. Do not add Node or runtime imports here.
import type { PackageSizeEstimate, TargetStatus } from "./types.js";

/** Submission limits are strict: equality fails, even when the original was under. */
export function targetStatusForBytes(originalBytes: number, outputBytes: number, targetBytes: number): TargetStatus {
  return outputBytes < targetBytes
    ? originalBytes < targetBytes ? "already-under-target" : "met"
    : "missed";
}

/**
 * Proportional strict per-file ceiling. Rounding is always down; a ceiling of 1
 * represents an exhausted budget, never an unlimited run. BigInt avoids loss
 * of precision in budget*weight. If every file meets its ceiling, their sum is
 * strictly under a positive remaining aggregate budget, including tiny shares.
 * An already exhausted aggregate budget cannot be made to pass by allocation.
 */
export function allocateTargetShareBytes(input: {
  targetBytes: number; itemBytes: number; totalBytes: number; consumedBytes?: number;
}): number | undefined {
  const { targetBytes, itemBytes, totalBytes } = input;
  if (![targetBytes, itemBytes, totalBytes].every(value => Number.isSafeInteger(value) && value > 0)) return undefined;
  const consumed = input.consumedBytes ?? 0;
  if (!Number.isSafeInteger(consumed) || consumed < 0 || itemBytes > totalBytes) return undefined;
  const remaining = BigInt(Math.max(0, targetBytes - consumed));
  return Math.max(1, Number(remaining * BigInt(itemBytes) / BigInt(totalBytes)));
}

/** Select the best alternative per resource; entry savings never subtract from ZIP bytes. */
export function evaluatePackageSizeEstimate(
  estimate: PackageSizeEstimate, actions?: readonly string[]
): { size: number; jpegBytes: number } {
  const selected = actions ? new Set(actions) : undefined;
  const best = new Map<string, PackageSizeEstimate["adjustments"][number]>();
  for (const adjustment of estimate.adjustments) {
    if (selected && !selected.has(adjustment.action)) continue;
    const previous = best.get(adjustment.target);
    if (!previous || adjustment.savingBytes > previous.savingBytes) best.set(adjustment.target, adjustment);
  }
  let saving = 0, jpegBytes = 0;
  for (const adjustment of best.values()) {
    saving += adjustment.savingBytes;
    jpegBytes += adjustment.jpegBytes;
  }
  const size = Math.round(Math.max(estimate.minimumSize, Math.min(estimate.originalSize, estimate.originalSize - saving)));
  return { size, jpegBytes: Math.min(size, jpegBytes) };
}
