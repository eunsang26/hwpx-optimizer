import type { OptimizationOpportunityGroup } from "@hwpx-optimizer/core";
import { APPLIED_ACTION_LABELS } from "./actionLabels.js";
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

const ERROR_LABELS: Record<string, string> = {
  "Analysis cancelled.": "분석이 취소되었습니다.",
  "Optimization cancelled.": "최적화가 취소되었습니다."
};

export function progressLabel(item: string): string {
  if (item.startsWith("Optimizing document in ")) {
    const mode = item.includes("aggressive") ? "최대 압축" : item.includes("balanced") ? "균형" : "안전";
    return `${mode} 모드로 문서를 최적화하는 중입니다`;
  }
  return PROGRESS_LABELS[item] ?? item;
}

export function errorLabel(message: string): string {
  return ERROR_LABELS[message] ?? message;
}

type WarningCategory =
  | "bmp-candidate"
  | "ole-visible"
  | "embedded-font"
  | "safe-no-shrink"
  | "balanced-no-shrink"
  | "aggressive-no-shrink"
  | "aggressive-quality"
  | "other";

type WarningPattern = {
  regex: RegExp;
  category: WarningCategory;
  label: (match: RegExpMatchArray) => string;
};

const WARNING_PATTERNS: WarningPattern[] = [
  {
    regex: /OLE objects can be user-visible/i,
    category: "ole-visible",
    label: () => "OLE 객체는 문서에서 보일 수 있어 자동으로 제거하지 않습니다."
  },
  {
    regex: /Embedded fonts can affect document appearance/i,
    category: "embedded-font",
    label: () => "임베디드 폰트는 문서 외형에 영향을 줄 수 있어 자동으로 제거하지 않습니다."
  },
  {
    regex: /Safe mode did not produce a smaller file/i,
    category: "safe-no-shrink",
    label: () => "안전 모드에서 더 작은 결과가 나오지 않아 원본 바이트를 유지했습니다."
  },
  {
    regex: /Balanced mode did not produce a smaller file/i,
    category: "balanced-no-shrink",
    label: () => "균형 모드에서 더 작은 결과가 나오지 않아 원본 바이트를 유지했습니다."
  },
  {
    regex: /Aggressive mode did not produce a smaller file/i,
    category: "aggressive-no-shrink",
    label: () => "최대 압축 모드에서 더 작은 결과가 나오지 않아 원본 바이트를 유지했습니다."
  },
  {
    regex: /may introduce visible image quality differences/i,
    category: "aggressive-quality",
    label: () => "최대 압축은 이미지 품질 차이가 보일 수 있습니다."
  },
  {
    regex: /BMP candidate detected;[^:]*:\s*(.+)$/i,
    category: "bmp-candidate",
    label: (match) => `BMP 이미지 발견: ${match[1] ?? ""} — 균형/최대 압축 모드에서 PNG로 변환하면 크기를 줄일 수 있습니다.`
  }
];

function categorize(warning: string): { category: WarningCategory; label: string; detail?: string } {
  for (const pattern of WARNING_PATTERNS) {
    const match = warning.match(pattern.regex);
    if (match) {
      return {
        category: pattern.category,
        label: pattern.label(match),
        detail: match[1]
      };
    }
  }
  return { category: "other", label: warning };
}

export function warningLabel(warning: string): string {
  return categorize(warning).label;
}

export type GroupedWarning = {
  category: WarningCategory;
  label: string;
  count: number;
  details: string[];
};

export function groupWarnings(warnings: readonly string[]): GroupedWarning[] {
  const buckets = new Map<WarningCategory, GroupedWarning>();
  const order: WarningCategory[] = [];
  for (const warning of warnings) {
    const { category, label, detail } = categorize(warning);
    const existing = buckets.get(category);
    if (existing) {
      existing.count += 1;
      if (detail && existing.details.length < 12 && !existing.details.includes(detail)) {
        existing.details.push(detail);
      }
      continue;
    }
    order.push(category);
    buckets.set(category, {
      category,
      label,
      count: 1,
      details: detail ? [detail] : []
    });
  }
  return order.map((category) => {
    const group = buckets.get(category)!;
    if (group.count > 1 && group.category === "bmp-candidate") {
      return {
        ...group,
        label: `BMP 이미지 ${group.count}개 발견 — 균형/최대 압축 모드에서 PNG로 변환하면 크기를 줄일 수 있습니다.`
      };
    }
    return group;
  });
}

export function actionLabel(action: string): string {
  return (APPLIED_ACTION_LABELS as Record<string, string>)[action] ?? action;
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
