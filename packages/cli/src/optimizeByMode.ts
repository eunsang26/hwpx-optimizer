import {
  optimizeHwpxBufferAggressive,
  optimizeHwpxBufferBalanced,
  optimizeHwpxBufferSafe
} from "@hwpx-optimizer/core";
import type { OptimizationReport } from "@hwpx-optimizer/core";

export type OptimizationMode = "safe" | "balanced" | "aggressive";

export interface OptimizeByModeOptions {
  "target-bytes"?: string;
  "target-mb"?: string;
  actions?: string;
  "allow-larger"?: string;
  imageConcurrency?: number;
}

export const ACTION_CATALOG: Array<{
  action: string;
  description: string;
  modes: string;
  risk: string;
  visualImpact: string;
}> = [
  {
    action: "strip-metadata",
    description: "Remove JPEG XMP/IPTC/comment segments while preserving EXIF orientation",
    modes: "safe, balanced, aggressive",
    risk: "safe",
    visualImpact: "none"
  },
  {
    action: "optimize-png",
    description: "Re-encode PNG with maximum DEFLATE; aggressive mode may use palette reduction",
    modes: "safe, balanced, aggressive",
    risk: "safe~medium",
    visualImpact: "none~low"
  },
  {
    action: "minify-xml",
    description: "Re-serialize XML entries without insignificant whitespace",
    modes: "safe",
    risk: "safe",
    visualImpact: "none"
  },
  {
    action: "remove-unused",
    description: "Drop BinData entries not referenced by any XML",
    modes: "safe",
    risk: "safe",
    visualImpact: "none"
  },
  {
    action: "convert-bmp-to-png",
    description: "Decode BMP and re-encode as PNG (with optional resize)",
    modes: "balanced, aggressive",
    risk: "medium",
    visualImpact: "low~medium"
  },
  {
    action: "resize-jpeg",
    description: "Resize and re-encode oversized JPEGs to display-size budget with MozJPEG",
    modes: "balanced, aggressive",
    risk: "medium",
    visualImpact: "medium"
  },
  {
    action: "resize-png",
    description: "Resize oversized PNGs to display-size budget while keeping PNG output",
    modes: "balanced, aggressive",
    risk: "medium",
    visualImpact: "low"
  },
  {
    action: "convert-tiff-to-png",
    description: "Decode TIFF and re-encode as PNG (with optional resize)",
    modes: "balanced, aggressive",
    risk: "medium",
    visualImpact: "low~medium"
  },
  {
    action: "clean-shape-comment",
    description: "Strip private filename / dimension lines inside <hp:shapeComment> blocks",
    modes: "balanced, aggressive",
    risk: "safe",
    visualImpact: "none"
  },
  {
    action: "consolidate-duplicate-images",
    description: "Redirect duplicate image references to a canonical resource and drop the duplicate file",
    modes: "balanced, aggressive",
    risk: "medium",
    visualImpact: "none"
  },
  {
    action: "repack-zip",
    description: "Always-on final ZIP repack with DEFLATE level 9",
    modes: "safe, balanced, aggressive",
    risk: "safe",
    visualImpact: "none"
  }
];

export function parsePositiveNumber(value: string | undefined, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive number.`);
  }
  return parsed;
}

export function parseTargetBytes(options: OptimizeByModeOptions): number | undefined {
  const hasBytes = options["target-bytes"] !== undefined;
  const hasMb = options["target-mb"] !== undefined;
  if (hasBytes && hasMb) {
    throw new Error("Use only one of --target-bytes or --target-mb.");
  }
  if (hasBytes) {
    const bytes = Math.floor(parsePositiveNumber(options["target-bytes"], "--target-bytes"));
    if (bytes <= 0) throw new Error("--target-bytes must be a positive number.");
    return bytes;
  }
  if (hasMb) {
    const bytes = Math.floor(parsePositiveNumber(options["target-mb"], "--target-mb") * 1024 * 1024);
    if (bytes <= 0) throw new Error("--target-mb must be at least one byte.");
    return bytes;
  }
  return undefined;
}

export function parseActionList(value?: string): string[] | undefined {
  if (!value) return undefined;
  const actions = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const allowed = new Set(ACTION_CATALOG.map((item) => item.action));
  const unknown = actions.filter((action) => !allowed.has(action));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown --actions: ${unknown.join(", ")}. Run "hwpx-opt list-actions" to see valid actions.`
    );
  }
  return actions;
}

export async function optimizeByMode(
  input: Buffer,
  mode: OptimizationMode,
  options: OptimizeByModeOptions,
  targetBytesOverride?: number
): Promise<{ output: Buffer; report: OptimizationReport }> {
  const targetBytes = targetBytesOverride ?? parseTargetBytes(options);
  const imageConcurrency = options.imageConcurrency;
  if (mode === "safe") return optimizeHwpxBufferSafe(input, { targetBytes, imageConcurrency });
  const advancedOptions = {
    actions: parseActionList(options.actions),
    allowLarger: options["allow-larger"] === "true",
    targetBytes,
    imageConcurrency
  };
  if (mode === "aggressive") return optimizeHwpxBufferAggressive(input, advancedOptions);
  return optimizeHwpxBufferBalanced(input, advancedOptions);
}
