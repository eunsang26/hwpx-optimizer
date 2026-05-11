import type { OptimizationOpportunityGroup, OptimizationReport } from "@hwpx-optimizer/core";
import { createActionToggles, formatBytes, type OptimizationMode } from "./viewModel.js";

export type SubmissionLimitId = "none" | "mb10" | "mb20" | "mb50" | "custom";
export type PreservationPreference = "preserve" | "recommended" | "size";
export type PlanStatus = "target-met" | "target-missed" | "already-under-target" | "no-target";
export type PlanKind = "automatic" | "custom";
export type SubmissionActionId = OptimizationOpportunityGroup["action"];

export type SubmissionLimit = {
  id: SubmissionLimitId;
  customBytes?: number;
};

export type SubmissionPlanInput = {
  submissionLimit: SubmissionLimit;
  preservationPreference: PreservationPreference;
  actionOverrides: Map<SubmissionActionId, boolean>;
};

export type SubmissionActionRow = {
  action: SubmissionActionId;
  actions: SubmissionActionId[];
  selectedActions: SubmissionActionId[];
  label: string;
  count: number;
  checked: boolean;
  partiallyChecked: boolean;
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
  selectedActions: SubmissionActionId[];
  actionRows: SubmissionActionRow[];
};

type ActionOverrideRecord = Partial<Record<SubmissionActionId, boolean>>;

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
const ESTIMATED_SAVING_DISPLAY_RATIO = 0.95;

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
  const rawActionRows = toggles.map((toggle) => {
    const override = input.actionOverrides.get(toggle.action);
    const checked = override ?? toggle.defaultEnabledForMode;
    const savingBytes = savingByAction.get(toggle.action) ?? 0;
    return {
      action: toggle.action,
      actions: [toggle.action],
      selectedActions: checked ? [toggle.action] : [],
      label: ACTION_DISPLAY_LABELS[toggle.action] ?? toggle.label,
      count: toggle.count,
      checked,
      partiallyChecked: false,
      savingBytes,
      savingLabel: formatBytes(savingBytes),
      risk: toggle.risk,
      visualImpact: toggle.visualImpact
    };
  });
  const actionRows = aggregateActionRows(rawActionRows);
  const changed = toggles.some((toggle) => {
    const override = input.actionOverrides.get(toggle.action);
    return override !== undefined && override !== toggle.defaultEnabledForMode;
  });
  const selectedActions = rawActionRows.filter((row) => row.checked).map((row) => row.action);
  const rawExpectedSavingBytes = rawActionRows.reduce(
    (sum, row) => (row.checked ? sum + row.savingBytes : sum),
    0
  );
  const savingCapBytes =
    report.originalSize > 0
      ? Math.max(0, Math.floor(report.originalSize * ESTIMATED_SAVING_DISPLAY_RATIO))
      : rawExpectedSavingBytes;
  const expectedSavingBytes = Math.min(rawExpectedSavingBytes, savingCapBytes);
  const wasCapped = rawExpectedSavingBytes > expectedSavingBytes;
  const expectedSizeBytes = Math.max(0, report.originalSize - expectedSavingBytes);
  const summarySavingBytes = floorToGranularity(expectedSavingBytes, SUMMARY_SAVING_GRANULARITY_BYTES);
  const summarySizeBytes = Math.max(0, report.originalSize - summarySavingBytes);
  const targetBytes = resolveSubmissionLimitBytes(input.submissionLimit);
  const savedPercent = report.originalSize > 0 ? (summarySavingBytes / report.originalSize) * 100 : 0;
  const targetStatus = targetStatusFor(report.originalSize, summarySizeBytes, targetBytes);
  const expectedSavingFormatted = formatBytes(summarySavingBytes);
  return {
    kind: changed ? "custom" : "automatic",
    mode,
    originalSizeLabel: formatBytes(report.originalSize),
    expectedSavingBytes,
    expectedSavingLabel: wasCapped ? `최대 ${expectedSavingFormatted}` : expectedSavingFormatted,
    expectedSizeBytes,
    expectedSizeLabel: wasCapped ? `약 ${formatBytes(summarySizeBytes)}` : formatBytes(summarySizeBytes),
    savedPercentLabel: `약 ${Math.min(99, Math.round(savedPercent))}% 감소`,
    targetBytes,
    targetLabel: targetBytes ? `${formatBytes(targetBytes)} 이하` : "제한 없음",
    targetStatus,
    targetStatusLabel: targetStatusLabel(targetStatus),
    selectedActions,
    actionRows
  };
}

function aggregateActionRows(actionRows: SubmissionActionRow[]): SubmissionActionRow[] {
  const rowsByLabel = new Map<string, SubmissionActionRow>();
  const selectedSavingByLabel = new Map<string, number>();
  for (const row of actionRows) {
    if (row.checked) {
      selectedSavingByLabel.set(row.label, (selectedSavingByLabel.get(row.label) ?? 0) + row.savingBytes);
    }
    const existing = rowsByLabel.get(row.label);
    if (!existing) {
      rowsByLabel.set(row.label, { ...row, actions: [...row.actions] });
      continue;
    }
    existing.actions.push(...row.actions);
    existing.selectedActions.push(...row.selectedActions);
    existing.count += row.count;
    existing.checked = existing.checked && row.checked;
    existing.savingBytes += row.savingBytes;
    existing.savingLabel = formatBytes(existing.savingBytes);
    existing.risk = highestRisk(existing.risk, row.risk);
    existing.visualImpact = highestVisualImpact(existing.visualImpact, row.visualImpact);
  }
  return [...rowsByLabel.values()].map((row) => {
    const selectedSavingBytes = selectedSavingByLabel.get(row.label) ?? row.savingBytes;
    const partiallyChecked = row.selectedActions.length > 0 && row.selectedActions.length < row.actions.length;
    if (row.selectedActions.length === 0) return { ...row, partiallyChecked };
    return {
      ...row,
      action: row.selectedActions[0],
      partiallyChecked,
      savingBytes: selectedSavingBytes,
      savingLabel: formatBytes(selectedSavingBytes)
    };
  });
}

function highestRisk(
  left: OptimizationOpportunityGroup["risk"],
  right: OptimizationOpportunityGroup["risk"]
): OptimizationOpportunityGroup["risk"] {
  const order: Record<OptimizationOpportunityGroup["risk"], number> = { safe: 0, medium: 1, high: 2 };
  return order[left] >= order[right] ? left : right;
}

function highestVisualImpact(
  left: OptimizationOpportunityGroup["visualImpact"],
  right: OptimizationOpportunityGroup["visualImpact"]
): OptimizationOpportunityGroup["visualImpact"] {
  const order: Record<OptimizationOpportunityGroup["visualImpact"], number> = {
    none: 0,
    low: 1,
    medium: 2,
    high: 3
  };
  return order[left] >= order[right] ? left : right;
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
    actionOverrides: new Map(Object.entries(reportOrInput.actionOverrides) as Array<[SubmissionActionId, boolean]>)
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
