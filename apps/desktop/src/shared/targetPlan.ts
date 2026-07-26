export type TargetVerdict = "pass" | "need-more" | "hard-miss" | "no-target";

export type TargetVerdictResult = {
  verdict: TargetVerdict;
  label: string;
  detail: string;
};

/**
 * Classify submission outcome.
 * - pass: expected under target
 * - need-more: expected over, but floor estimate would pass (and not already at floor)
 * - hard-miss: even floor estimate stays over target
 */
export function classifyTargetVerdict(input: {
  expectedBytes: number;
  floorExpectedBytes: number;
  targetBytes?: number;
  atFloor?: boolean;
}): TargetVerdictResult {
  const target = input.targetBytes;
  if (!target || target <= 0) {
    return { verdict: "no-target", label: "목표 제한 없음", detail: "제출 기준이 없습니다." };
  }
  if (input.expectedBytes < target) {
    const slack = target - input.expectedBytes;
    return {
      verdict: "pass",
      label: "제출 가능",
      detail: `기준까지 여유 ${formatBytesShort(slack)}`
    };
  }
  if (input.floorExpectedBytes < target && !input.atFloor) {
    return {
      verdict: "need-more",
      label: "더 압축 필요",
      detail: `현재 초과 ${formatBytesShort(input.expectedBytes - target)} · 하한 품질까지 가면 통과 가능`
    };
  }
  return {
    verdict: "hard-miss",
    label: "기준 미달",
    detail: `하한 품질까지 적용해도 초과 ${formatBytesShort(Math.max(0, input.floorExpectedBytes - target))}`
  };
}

export type JpegSizeEstimateInput = {
  originalBytes: number;
  baselineExpectedBytes: number;
  baselineQuality: number;
  quality: number;
  floor: number;
  ceiling: number;
  /**
   * Estimated JPEG payload bytes inside `baselineExpectedBytes`.
   * Only this portion reacts to JPEG quality changes; BMP/PNG/XML stay fixed.
   * When omitted, a conservative fraction of the baseline is treated as JPEG-sensitive.
   */
  jpegBaselineBytes?: number;
};

/**
 * Estimate package size at a JPEG quality relative to an opportunity baseline.
 *
 * Important: raising quality must NOT scale the whole package back toward the
 * original size. Structural wins (BMP→PNG, PNG optimize, XML) are quality-invariant.
 */
export function estimateSizeAtJpegQuality(input: JpegSizeEstimateInput): number {
  const { originalBytes, baselineExpectedBytes, baselineQuality, quality, floor, ceiling } = input;
  if (originalBytes <= 0) return 0;
  const baseline = clamp(baselineExpectedBytes, 0, originalBytes);
  if (baseline <= 0) return 0;

  const q = clamp(quality, floor, ceiling);
  const baseQ = clamp(baselineQuality, floor, ceiling);
  const jpegBaseline = resolveJpegBaselineBytes(baseline, input.jpegBaselineBytes);
  const fixedBytes = Math.max(0, baseline - jpegBaseline);

  if (q === baseQ) return Math.round(baseline);

  if (q > baseQ) {
    // Higher quality than the opportunity profile: allow modest JPEG growth only.
    const span = Math.max(1, ceiling - baseQ);
    const t = (q - baseQ) / span;
    const jpegBytes = jpegBaseline * (1 + 0.18 * t);
    return Math.round(Math.min(originalBytes, fixedBytes + jpegBytes));
  }

  // Lower quality: shrink only the JPEG portion toward a floor ratio.
  const span = Math.max(1, baseQ - floor);
  const t = (baseQ - q) / span;
  const jpegFloorRatio = 0.42;
  const jpegBytes = jpegBaseline * (1 - (1 - jpegFloorRatio) * Math.pow(t, 1.05));
  return Math.round(Math.max(fixedBytes + jpegBytes * 0.5, fixedBytes + jpegBytes));
}

/**
 * Mirror core's balanced target-fit search: highest integer quality in [floor, ceiling]
 * whose estimated size is strictly under targetBytes (미만).
 */
export function planJpegQualityForTarget(input: {
  originalBytes: number;
  baselineExpectedBytes: number;
  baselineQuality: number;
  targetBytes: number;
  floor: number;
  ceiling: number;
  jpegBaselineBytes?: number;
}): { quality: number; expectedBytes: number; meets: boolean } {
  const estimate = (quality: number): number =>
    estimateSizeAtJpegQuality({
      originalBytes: input.originalBytes,
      baselineExpectedBytes: input.baselineExpectedBytes,
      baselineQuality: input.baselineQuality,
      quality,
      floor: input.floor,
      ceiling: input.ceiling,
      jpegBaselineBytes: input.jpegBaselineBytes
    });

  const baseQuality = clamp(input.baselineQuality, input.floor, input.ceiling);
  const baseSize = estimate(baseQuality);
  let bestQuality = baseQuality;
  let bestSize = baseSize;

  if (baseSize < input.targetBytes) {
    let lo = baseQuality + 1;
    let hi = input.ceiling;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const size = estimate(mid);
      if (size < input.targetBytes) {
        bestQuality = mid;
        bestSize = size;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return { quality: bestQuality, expectedBytes: bestSize, meets: true };
  }

  let lo = input.floor;
  let hi = baseQuality - 1;
  let found: { quality: number; size: number } | undefined;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const size = estimate(mid);
    if (size < input.targetBytes) {
      found = { quality: mid, size };
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found) {
    return { quality: found.quality, expectedBytes: found.size, meets: true };
  }
  const floorSize = estimate(input.floor);
  return {
    quality: input.floor,
    expectedBytes: floorSize,
    meets: floorSize < input.targetBytes
  };
}

/** Sum estimated JPEG output bytes from selected opportunity rows. */
export function jpegBaselineBytesFromGroups(
  groups: ReadonlyArray<{ action: string; afterSize: number }>
): number {
  let jpegBytes = 0;
  for (const group of groups) {
    if (group.action === "resize-jpeg") {
      jpegBytes += Math.max(0, group.afterSize);
    }
  }
  return jpegBytes;
}

function resolveJpegBaselineBytes(baseline: number, jpegBaselineBytes: number | undefined): number {
  if (jpegBaselineBytes !== undefined && Number.isFinite(jpegBaselineBytes)) {
    return clamp(jpegBaselineBytes, 0, baseline);
  }
  // Fallback when callers omit a split: assume a minority of the baseline is JPEG-sensitive
  // so quality changes cannot dominate structural (BMP/PNG) wins.
  return Math.round(baseline * 0.35);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function formatBytesShort(bytes: number): string {
  const absolute = Math.abs(bytes);
  if (absolute < 1024) return `${bytes} B`;
  if (absolute < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}
