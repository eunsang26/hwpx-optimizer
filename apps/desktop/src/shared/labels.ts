import type { OptimizationOpportunityGroup } from "@hwpx-optimizer/core";
import type { OptimizationMode } from "./viewModel.js";

export type BatchItemStatus = "pending" | "running" | "done" | "failed" | "cancelled";

export type RiskLevel = OptimizationOpportunityGroup["risk"];
export type VisualImpactLevel = OptimizationOpportunityGroup["visualImpact"];

const PROGRESS_LABELS: Record<string, string> = {
  "Reading HWPX package": "HWPX 문서 구조를 읽는 중입니다",
  "Writing optimized document": "최적화된 문서를 저장하는 중입니다",
  "Writing JSON report": "JSON 리포트를 저장하는 중입니다",
  "Verifying optimized document": "결과 문서를 검증하는 중입니다",
  "Optimization complete": "최적화가 완료되었습니다",
  "Optimization cancelled": "최적화가 취소되었습니다"
};

export function progressLabel(item: string): string {
  if (item.startsWith("Optimizing document in ")) {
    const mode = item.includes("aggressive") ? "최대 압축" : item.includes("balanced") ? "균형" : "안전";
    return `${mode} 모드로 문서를 최적화하는 중입니다`;
  }
  return PROGRESS_LABELS[item] ?? item;
}

const WARNING_PATTERNS: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
  [/OLE objects can be user-visible/i, () => "OLE 객체는 문서에서 보일 수 있어 자동으로 제거하지 않습니다."],
  [/Embedded fonts can affect document appearance/i, () => "임베디드 폰트는 문서 외형에 영향을 줄 수 있어 자동으로 제거하지 않습니다."],
  [/Safe mode did not produce a smaller file/i, () => "안전 모드에서 더 작은 결과가 나오지 않아 원본 바이트를 유지했습니다."],
  [/Balanced mode did not produce a smaller file/i, () => "균형 모드에서 더 작은 결과가 나오지 않아 원본 바이트를 유지했습니다."],
  [/Aggressive mode did not produce a smaller file/i, () => "최대 압축 모드에서 더 작은 결과가 나오지 않아 원본 바이트를 유지했습니다."],
  [/may introduce visible image quality differences/i, () => "최대 압축은 이미지 품질 차이가 보일 수 있습니다."],
  [
    /BMP candidate detected;[^:]*:\s*(.+)$/i,
    (match) => `BMP 이미지 발견: ${match[1] ?? ""} — 균형/최대 압축 모드에서 PNG로 변환하면 크기를 줄일 수 있습니다.`
  ]
];

export function warningLabel(warning: string): string {
  for (const [pattern, build] of WARNING_PATTERNS) {
    const match = warning.match(pattern);
    if (match) return build(match);
  }
  return warning;
}

const ACTION_LABELS: Record<string, string> = {
  "remove-exif": "이미지 메타데이터 제거",
  "compress-image": "이미지 무손실 최적화",
  "strip-metadata": "이미지 메타데이터 제거",
  "optimize-png": "PNG 무손실 최적화",
  "resize-jpeg": "큰 JPEG 리사이즈",
  "resize-png": "큰 PNG 리사이즈",
  "convert-bmp-to-png": "BMP를 PNG로 변환",
  "convert-tiff-to-png": "TIFF를 PNG로 변환",
  "remove-unused": "미사용 리소스 제거",
  "minify-xml": "문서 XML 정리",
  "repack-zip": "HWPX 재압축",
  "clean-shape-comment": "이미지 설명 메타데이터 정리",
  "consolidate-duplicate-images": "중복 이미지 참조 정리"
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export function modeLabel(mode: OptimizationMode): string {
  if (mode === "safe") return "안전";
  if (mode === "balanced") return "균형";
  return "최대 압축";
}

export function batchStatusLabel(status: BatchItemStatus): string {
  switch (status) {
    case "pending":
      return "대기";
    case "running":
      return "처리 중";
    case "done":
      return "완료";
    case "failed":
      return "실패";
    case "cancelled":
      return "취소";
  }
}

export function riskBadgeLabel(risk: RiskLevel): string {
  if (risk === "safe") return "안전";
  if (risk === "medium") return "주의";
  return "위험";
}

export function visualImpactBadgeLabel(impact: VisualImpactLevel): string {
  if (impact === "none") return "외형 영향 없음";
  if (impact === "low") return "외형 영향 작음";
  if (impact === "medium") return "외형 영향 보통";
  return "외형 영향 큼";
}

export type PsnrTier = "identical" | "excellent" | "good" | "fair" | "poor" | "unknown";

export function psnrTier(psnrDb: number | null | undefined): PsnrTier {
  if (psnrDb === null || psnrDb === undefined || !Number.isFinite(psnrDb)) {
    if (psnrDb === Number.POSITIVE_INFINITY) return "identical";
    return "unknown";
  }
  if (psnrDb >= 70) return "identical";
  if (psnrDb >= 45) return "excellent";
  if (psnrDb >= 35) return "good";
  if (psnrDb >= 28) return "fair";
  return "poor";
}

export function psnrTierLabel(tier: PsnrTier): string {
  switch (tier) {
    case "identical":
      return "동일";
    case "excellent":
      return "매우 좋음";
    case "good":
      return "좋음";
    case "fair":
      return "보통";
    case "poor":
      return "차이 인지";
    case "unknown":
      return "측정 불가";
  }
}

export function formatPsnr(psnrDb: number | null | undefined): string {
  if (psnrDb === null || psnrDb === undefined) return "측정 불가";
  if (!Number.isFinite(psnrDb)) return psnrDb === Number.POSITIVE_INFINITY ? "동일" : "측정 불가";
  if (psnrDb >= 70) return "동일";
  return `${psnrDb.toFixed(2)} dB`;
}

export function modeWarningMessage(input: { mode: OptimizationMode; showAggressiveWarning: boolean }): string {
  if (input.mode === "aggressive" && input.showAggressiveWarning !== false) {
    return "최대 압축은 이미지 품질 차이가 보일 수 있습니다.";
  }
  if (input.mode === "balanced") {
    return "균형 모드는 표시 크기를 기준으로 큰 이미지와 BMP를 줄입니다.";
  }
  return "안전 모드는 문서 외형 변화 가능성이 낮은 작업만 수행합니다.";
}
