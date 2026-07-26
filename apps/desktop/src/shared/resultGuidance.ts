import type { OptimizationReport } from "@hwpx-optimizer/core";
import type { SubmissionPlan } from "./submissionPlan.js";

export function resultGuidanceText(report: OptimizationReport, plan: SubmissionPlan | undefined): string {
  const notes: string[] = [];
  if (report.targetStatus === "missed") {
    notes.push("목표 용량은 아직 미달입니다. 품질 하한을 넘겨 강제 압축하지 않았으므로 세부 분석의 후보를 수동 확인하세요.");
  } else if (report.targetStatus === "met") {
    notes.push("제출 목표를 충족했습니다. 제출 전 결과 파일을 열어 문서 외형을 확인하세요.");
  } else if (report.targetStatus === "already-under-target") {
    notes.push("원본부터 제출 목표 미만입니다. 최적화 결과는 보조 절감으로 확인하세요.");
  } else {
    notes.push("제출 전 결과 파일을 열어 문서 외형과 첨부 리소스를 확인하세요.");
  }

  if (plan?.targetStatus === "target-missed" && report.targetStatus !== "missed") {
    notes.push("계획상 목표 미달 가능성이 있었지만 실제 결과는 더 작게 생성되었습니다.");
  }

  const manualCandidateCount = (report.nearDuplicateImages?.length ?? 0) + (report.resourceDiagnostics?.length ?? 0);
  if (manualCandidateCount > 0) {
    notes.push(`수동 확인 후보 ${manualCandidateCount}개는 자동 제거하지 않았습니다.`);
  }
  if (report.actions.skipped.length > 0) {
    notes.push(`품질 또는 안전 기준 때문에 ${report.actions.skipped.length}개 작업을 보류했습니다.`);
  }
  const missReason = targetMissReasonLabel(report.targetMissReason);
  if (missReason) {
    notes.push(`목표 미달 사유: ${missReason}`);
  }
  return notes.join(" ");
}

function targetMissReasonLabel(reason: string | undefined): string | undefined {
  if (!reason) return undefined;
  if (/No quality-preserving optimization candidate reached the target/i.test(reason)) {
    return "품질 보존 가능한 후보만 적용했습니다.";
  }
  if (/already under target/i.test(reason)) {
    return "원본이 이미 목표 미만입니다.";
  }
  return "품질 또는 문서 보존 기준 때문에 추가 압축을 적용하지 않았습니다.";
}
