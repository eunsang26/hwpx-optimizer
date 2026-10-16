import type { OptimizationReport } from "@hwpx-optimizer/core";

/** A missing diagnostic is not evidence that visual duplicates do not exist. */
export function analysisBasisLabel(report?: Pick<OptimizationReport, "analysis">): string {
  if (report?.analysis?.mode === "quick") {
    return "빠른 분석 · 이미지 크기는 추정값이며 픽셀·유사 이미지 중복은 검사하지 않았습니다. 최종 용량은 저장 후 확인하세요.";
  }
  if (report?.analysis?.mode === "deep") {
    return "상세 분석 · 이미지 후보를 재인코딩하고 픽셀·유사 이미지 중복을 검사했습니다. 최종 ZIP 용량은 저장 후 확인하세요.";
  }
  return "분석 방식 정보가 없습니다. 예상 용량은 실제 저장 결과와 다를 수 있습니다.";
}
