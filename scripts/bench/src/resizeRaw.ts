import sharp from "sharp";
import {
  aggressiveImageProfile,
  balancedImageProfile,
  decodeBmp,
  getRecommendedImagePixelBudgets,
  readHwpxPackage
} from "@hwpx-optimizer/core";
import type { BenchProfileName, RawImage } from "./types.js";

export async function decodeResizeToRaw(
  imageBytes: Buffer,
  budget: { width: number; height: number } | undefined,
  profile: { maxEdge: number }
): Promise<RawImage> {
  const target = budget ?? { width: profile.maxEdge, height: profile.maxEdge };
  const bmp = decodeBmp(imageBytes);
  const pipeline = bmp
    ? sharp(bmp.data, { raw: { width: bmp.width, height: bmp.height, channels: 3 } })
    : sharp(imageBytes, { failOn: "none" });

  const result = await pipeline
    .rotate()
    .removeAlpha()
    .resize({
      width: target.width,
      height: target.height,
      fit: "inside",
      withoutEnlargement: true,
      kernel: "lanczos3"
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    data: result.data,
    width: result.info.width,
    height: result.info.height,
    channels: 3
  };
}

export function budgetsForPackage(
  pkg: Awaited<ReturnType<typeof readHwpxPackage>>,
  profileName: BenchProfileName
): Map<string, { width: number; height: number }> {
  const profile = profileName === "aggressive" ? aggressiveImageProfile : balancedImageProfile;
  const recommended = getRecommendedImagePixelBudgets(pkg, profile.displayScale);
  const out = new Map<string, { width: number; height: number }>();
  for (const entry of pkg.entries) {
    if (entry.kind !== "image") continue;
    const rec = recommended.get(entry.path);
    out.set(entry.path, {
      width: Math.min(profile.maxEdge, rec?.width ?? profile.maxEdge),
      height: Math.min(profile.maxEdge, rec?.height ?? profile.maxEdge)
    });
  }
  return out;
}
