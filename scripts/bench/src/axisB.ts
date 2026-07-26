import { computeVisualMetrics } from "@hwpx-optimizer/core";
import type { BenchProfileName } from "./types.js";

const AXIS_B_THRESHOLDS: Record<
  BenchProfileName,
  { psnrMin: number; ssimMin: number }
> = {
  balanced: { psnrMin: 18, ssimMin: 0.72 },
  aggressive: { psnrMin: 14, ssimMin: 0.55 }
};

export type AxisBResult = {
  pass: boolean;
  psnr: number | null;
  ssim: number | null;
};

export async function evaluateAxisB(
  originalBinData: Buffer,
  candidateBytes: Buffer,
  profile: BenchProfileName
): Promise<AxisBResult> {
  const thresholds = AXIS_B_THRESHOLDS[profile];
  const { psnr, ssim } = await computeVisualMetrics(originalBinData, candidateBytes);
  const pass =
    psnr !== null &&
    ssim !== null &&
    psnr >= thresholds.psnrMin &&
    ssim >= thresholds.ssimMin;
  return { pass, psnr, ssim };
}
