import type { OptimizationOpportunityGroup, OptimizationReport } from "@hwpx-optimizer/core";
import { createActionToggles, formatBytes, type OptimizationMode } from "./viewModel.js";

export type SubmissionLimitId = "none" | "mb10" | "mb20" | "mb50" | "custom";
export type PreservationPreference = "preserve" | "recommended" | "size";
export type PlanStatus = "target-met" | "target-missed" | "already-under-target" | "no-target";
export type PlanKind = "automatic" | "custom";

export type SubmissionLimit = {
  id: SubmissionLimitId;
  customBytes?: number;
};

export type SubmissionPlanInput = {
  submissionLimit: SubmissionLimit;
  preservationPreference: PreservationPreference;
  actionOverrides: Map<string, boolean>;
};

export type SubmissionActionRow = {
  action: OptimizationOpportunityGroup["action"];
  label: string;
  count: number;
  checked: boolean;
  savingBytes: number;
  savingLabel: string;
  risk: OptimizationOpportunityGroup["risk"];
  visualImpact: OptimizationOpportunityGroup["visualImpact"];
};

export type SubmissionPlan = {
  kind: PlanKind;
  mode: OptimizationMode;
  originalSizeLabel: string;
  expectedSavingBytes: number;
  expectedSavingLabel: string;
  expectedSizeBytes: number;
  expectedSizeLabel: string;
  savedPercentLabel: string;
  targetBytes?: number;
  targetLabel: string;
  targetStatus: PlanStatus;
  targetStatusLabel: string;
  selectedActions: string[];
  actionRows: SubmissionActionRow[];
};

type ActionOverrideRecord = Partial<Record<OptimizationOpportunityGroup["action"], boolean>>;

type CompactSubmissionPlanInput = {
  report: OptimizationReport;
  limit: SubmissionLimit;
  preservation: PreservationPreference;
  actionOverrides: ActionOverrideRecord;
};

export const SUBMISSION_LIMIT_LABELS: Record<SubmissionLimitId, string> = {
  none: "제한 없음",
  mb10: "10 MB 이하",
  mb20: "20 MB 이하",
  mb50: "50 MB 이하",
  custom: "직접 입력"
};

export const PRESERVATION_LABELS: Record<PreservationPreference, string> = {
  preserve: "외형 보존 우선",
  recommended: "권장",
  size: "용량 우선"
};

const ACTION_DISPLAY_LABELS: Partial<Record<OptimizationOpportunityGroup["action"], string>> = {
  "resize-jpeg": "큰 이미지 적정 크기로 줄이기",
  "resize-png": "큰 이미지 적정 크기로 줄이기",
  "convert-bmp-to-png": "큰 이미지 적정 크기로 줄이기",
  "convert-tiff-to-png": "큰 이미지 적정 크기로 줄이기",
  "consolidate-duplicate-images": "중복 이미지 정리",
  "strip-metadata": "이미지 불필요 정보 제거",
  "optimize-png": "이미지 불필요 정보 제거",
  "clean-shape-comment": "개인정보 흔적 정리"
};

const SUMMARY_SAVING_GRANULARITY_BYTES = 1024 * 1024;

export function modeForPreservation(preference: PreservationPreference): OptimizationMode {
  if (preference === "preserve") return "safe";
  if (preference === "size") return "aggressive";
  return "balanced";
}

export function resolveSubmissionLimitBytes(limit: SubmissionLimit): number | undefined {
  if (limit.id === "mb10") return 10 * 1024 * 1024;
  if (limit.id === "mb20") return 20 * 1024 * 1024;
  if (limit.id === "mb50") return 50 * 1024 * 1024;
  if (limit.id === "custom" && limit.customBytes && limit.customBytes > 0) return limit.customBytes;
  return undefined;
}

export function createSubmissionPlan(report: OptimizationReport, input: SubmissionPlanInput): SubmissionPlan;
export function createSubmissionPlan(input: CompactSubmissionPlanInput): SubmissionPlan;
export function createSubmissionPlan(
  reportOrInput: OptimizationReport | CompactSubmissionPlanInput,
  maybeInput?: SubmissionPlanInput
): SubmissionPlan {
  const report = "report" in reportOrInput ? reportOrInput.report : reportOrInput;
  const input = normalizeInput(reportOrInput, maybeInput);
  const mode = modeForPreservation(input.preservationPreference);
  const toggles = createActionToggles(report, mode);
  const savingByAction = new Map(report.opportunityGroups.map((group) => [group.action, group.estimatedSavingBytes]));
  const actionRows = toggles.map((toggle) => {
    const override = input.actionOverrides.get(toggle.action);
    const checked = override ?? toggle.defaultEnabledForMode;
    const savingBytes = savingByAction.get(toggle.action) ?? 0;
    return {
      action: toggle.action,
      label: ACTION_DISPLAY_LABELS[toggle.action] ?? toggle.label,
      count: toggle.count,
      checked,
      savingBytes,
      savingLabel: formatBytes(savingBytes),
      risk: toggle.risk,
      visualImpact: toggle.visualImpact
    };
  });
  const changed = actionRows.some((row) => input.actionOverrides.has(row.action));
  const expectedSavingBytes = actionRows.reduce((sum, row) => (row.checked ? sum + row.savingBytes : sum), 0);
  const expectedSizeBytes = Math.max(0, report.originalSize - expectedSavingBytes);
  const summarySavingBytes = floorToGranularity(expectedSavingBytes, SUMMARY_SAVING_GRANULARITY_BYTES);
  const summarySizeBytes = Math.max(0, report.originalSize - summarySavingBytes);
  const targetBytes = resolveSubmissionLimitBytes(input.submissionLimit);
  const savedPercent = report.originalSize > 0 ? (summarySavingBytes / report.originalSize) * 100 : 0;
  const targetStatus = targetStatusFor(report.originalSize, expectedSizeBytes, targetBytes);
  return {
    kind: changed ? "custom" : "automatic",
    mode,
    originalSizeLabel: formatBytes(report.originalSize),
    expectedSavingBytes,
    expectedSavingLabel: formatBytes(summarySavingBytes),
    expectedSizeBytes,
    expectedSizeLabel: formatBytes(summarySizeBytes),
    savedPercentLabel: `약 ${Math.round(savedPercent)}% 감소`,
    targetBytes,
    targetLabel: targetBytes ? `${formatBytes(targetBytes)} 이하` : "제한 없음",
    targetStatus,
    targetStatusLabel: targetStatusLabel(targetStatus),
    selectedActions: actionRows.filter((row) => row.checked).map((row) => row.action),
    actionRows
  };
}

function floorToGranularity(value: number, granularity: number): number {
  if (value <= 0) return 0;
  return Math.floor(value / granularity) * granularity;
}

function normalizeInput(
  reportOrInput: OptimizationReport | CompactSubmissionPlanInput,
  maybeInput?: SubmissionPlanInput
): SubmissionPlanInput {
  if (maybeInput) return maybeInput;
  if (!("report" in reportOrInput)) {
    throw new Error("createSubmissionPlan requires submission plan input.");
  }
  return {
    submissionLimit: reportOrInput.limit,
    preservationPreference: reportOrInput.preservation,
    actionOverrides: new Map(Object.entries(reportOrInput.actionOverrides))
  };
}

function targetStatusFor(originalSize: number, expectedSize: number, targetBytes: number | undefined): PlanStatus {
  if (!targetBytes) return "no-target";
  if (originalSize <= targetBytes) return "already-under-target";
  return expectedSize <= targetBytes ? "target-met" : "target-missed";
}

function targetStatusLabel(status: PlanStatus): string {
  if (status === "target-met") return "목표 달성 가능";
  if (status === "target-missed") return "목표 미달 가능";
  if (status === "already-under-target") return "이미 목표 이하";
  return "목표 제한 없음";
}
