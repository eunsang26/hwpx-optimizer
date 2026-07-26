import sharp from "sharp";
import { encodeJpegli, encodeMozjpeg } from "./candidates.js";
import { scoreSsimulacra2 } from "./ssimulacra2.js";
import { SSIMULACRA2_MATCH_TOLERANCE } from "./types.js";
import type { RawImage } from "./types.js";

export type RdPoint = { quality: number; bytes: number; score: number; encodeMs: number };

let mozjpegWarmupDone = false;
let jpegliWarmupDone = false;

async function referencePngFromRaw(raw: RawImage): Promise<Buffer> {
  return sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 3 } }).png().toBuffer();
}

async function scoreEncoded(raw: RawImage, refPng: Buffer, encoded: Buffer): Promise<number> {
  return scoreSsimulacra2(refPng, encoded);
}

export async function sweepMozjpeg(raw: RawImage, qualities: readonly number[]): Promise<RdPoint[]> {
  const refPng = await referencePngFromRaw(raw);
  const points: RdPoint[] = [];
  for (const quality of qualities) {
    const enc = await encodeMozjpeg(raw, quality);
    if (!mozjpegWarmupDone) {
      mozjpegWarmupDone = true;
      continue;
    }
    const score = await scoreEncoded(raw, refPng, enc.bytes);
    points.push({ quality, bytes: enc.bytes.byteLength, score, encodeMs: enc.encodeMs });
  }
  return points;
}

export async function sweepJpegli(raw: RawImage, qualities: readonly number[]): Promise<RdPoint[]> {
  const refPng = await referencePngFromRaw(raw);
  const points: RdPoint[] = [];
  for (const quality of qualities) {
    const enc = await encodeJpegli(raw, quality);
    if (!jpegliWarmupDone) {
      jpegliWarmupDone = true;
      continue;
    }
    const score = await scoreEncoded(raw, refPng, enc.bytes);
    points.push({ quality, bytes: enc.bytes.byteLength, score, encodeMs: enc.encodeMs });
  }
  return points;
}

export function interpolateIsoQuality(
  mozPoints: RdPoint[],
  jpegliPoints: RdPoint[],
  anchorQ: number,
  tolerance: number
):
  | {
      status: "ok";
      quality: number;
      bytes: number;
      encodeMs: number;
      targetScore: number;
      score: number;
    }
  | { status: "no-data"; reason: string } {
  const mozAnchor = mozPoints.find((p) => p.quality === anchorQ);
  if (!mozAnchor) {
    return { status: "no-data", reason: `missing-moz-anchor-q${anchorQ}` };
  }

  const targetScore = mozAnchor.score;
  const sorted = [...jpegliPoints].sort((a, b) => a.quality - b.quality);
  if (sorted.length === 0) {
    return { status: "no-data", reason: "curve-miss" };
  }

  if (sorted.every((p) => p.score > targetScore) || sorted.every((p) => p.score < targetScore)) {
    return { status: "no-data", reason: "curve-miss" };
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const lo = sorted[i]!;
    const hi = sorted[i + 1]!;
    const minScore = Math.min(lo.score, hi.score);
    const maxScore = Math.max(lo.score, hi.score);
    if (targetScore < minScore || targetScore > maxScore) continue;

    const span = hi.score - lo.score;
    const t = span === 0 ? 0.5 : (targetScore - lo.score) / span;
    const quality = lo.quality + t * (hi.quality - lo.quality);
    const bytes = lo.bytes + t * (hi.bytes - lo.bytes);
    const encodeMs = lo.encodeMs + t * (hi.encodeMs - lo.encodeMs);
    const score = lo.score + t * (hi.score - lo.score);

    if (Math.abs(score - targetScore) > tolerance) {
      return { status: "no-data", reason: "tolerance-miss" };
    }

    return { status: "ok", quality, bytes, encodeMs, targetScore, score };
  }

  return { status: "no-data", reason: "curve-miss" };
}

export function isoQualityJpegliBytes(
  mozPoints: RdPoint[],
  jpegliPoints: RdPoint[],
  anchorQ: number
):
  | {
      status: "ok";
      quality: number;
      bytes: number;
      encodeMs: number;
      targetScore: number;
      score: number;
    }
  | { status: "no-data"; reason: string } {
  return interpolateIsoQuality(mozPoints, jpegliPoints, anchorQ, SSIMULACRA2_MATCH_TOLERANCE);
}

/** @internal Test-only reset for warmup flags. */
export function resetRdWarmupForTests(): void {
  mozjpegWarmupDone = false;
  jpegliWarmupDone = false;
}
