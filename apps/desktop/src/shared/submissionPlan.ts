import type { OptimizationOpportunityGroup, OptimizationReport } from "@hwpx-optimizer/core";
import { estimateNonOverlappingSavingBytes } from "./estimateSavings.js";
import { createActionToggles, formatBytes, type OptimizationMode } from "./viewModel.js";

export type SubmissionLimitId = "none" | "mb10" | "mb20" | "mb50" | "custom";
export type PreservationPreference = "preserve" | "recommended" | "size";
export type PlanStatus = "target-met" | "target-missed" | "already-under-target" | "no-target";
export type PlanKind = "automatic" | "custom";
export type SubmissionActionBucket = "image" | "metadata" | "author";
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
  priority: number;
  action: SubmissionActionId;
  actions: SubmissionActionId[];
  selectedActions: SubmissionActionId[];
  bucket: SubmissionActionBucket;
  label: string;
  count: number;
  checked: boolean;
  partiallyChecked: boolean;
  savingBytes: number;
  savingLabel: string;
  risk: OptimizationOpportunityGroup["risk"];
  visualImpact: OptimizationOpportunityGroup["visualImpact"];
};

export type SubmissionPlanNote = {
  kind: "target" | "quality" | "review";
  label: string;
  detail: string;
  count: number;
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
  planNotes: SubmissionPlanNote[];
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
  "resize-jpeg": "큰 JPEG 리사이즈",
  "resize-png": "큰 PNG 리사이즈",
  "convert-bmp-to-png": "BMP를 PNG로 변환",
  "convert-tiff-to-png": "TIFF를 PNG로 변환",
  "consolidate-duplicate-images": "중복 이미지 참조 정리",
  "strip-metadata": "불필요한 이미지 정보 제거",
  "optimize-png": "PNG 무손실 최적화",
  "clean-shape-comment": "작성자·편집 흔적 정리"
};

const ACTION_BUCKETS: Partial<Record<OptimizationOpportunityGroup["action"], SubmissionActionBucket>> = {
  "resize-jpeg": "image",
  "resize-png": "image",
  "convert-bmp-to-png": "image",
  "convert-tiff-to-png": "image",
  "consolidate-duplicate-images": "image",
  "strip-metadata": "metadata",
  "optimize-png": "metadata",
  "clean-shape-comment": "author"
};

const ACTION_PRIORITY_ORDER: Partial<Record<SubmissionActionId, number>> = {
  "consolidate-duplicate-images": 10,
  "strip-metadata": 20,
  "optimize-png": 30,
  "clean-shape-comment": 40,
  "convert-bmp-to-png": 50,
  "convert-tiff-to-png": 60,
  "resize-jpeg": 70,
  "resize-png": 80
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
  const groupByAction = new Map(report.opportunityGroups.map((group) => [group.action, group]));
  const rawActionRows = toggles.map((toggle) => {
    const group = groupByAction.get(toggle.action);
    const override = input.actionOverrides.get(toggle.action);
    const checked = override ?? toggle.defaultEnabledForMode;
    const savingBytes = group?.estimatedSavingBytes ?? 0;
    const bucket = actionBucket(toggle.action);
    return {
      priority: 0,
      action: toggle.action,
      actions: [toggle.action],
      selectedActions: checked ? [toggle.action] : [],
      bucket,
      label: ACTION_DISPLAY_LABELS[toggle.action] ?? toggle.label,
      count: toggle.count,
      checked,
      partiallyChecked: false,
      savingBytes,
      savingLabel: formatBytes(savingBytes),
      risk: toggle.risk,
      visualImpact: toggle.visualImpact,
      group
    };
  });
  const actionRows = createPriorityActionRows(rawActionRows);
  const changed = toggles.some((toggle) => {
    const override = input.actionOverrides.get(toggle.action);
    return override !== undefined && override !== toggle.defaultEnabledForMode;
  });
  const selectedActions = actionRows.filter((row) => row.checked).map((row) => row.action);
  const rawExpectedSavingBytes = estimateNonOverlappingSavingBytes(
    rawActionRows.flatMap((row) => (row.checked && row.group ? [row.group] : []))
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
    actionRows,
    planNotes: createPlanNotes({ report, mode, targetBytes, targetStatus })
  };
}

function createPlanNotes(input: {
  report: OptimizationReport;
  mode: OptimizationMode;
  targetBytes?: number;
  targetStatus: PlanStatus;
}): SubmissionPlanNote[] {
  const notes: SubmissionPlanNote[] = [];
  if (input.targetBytes && input.targetStatus === "target-missed" && input.mode !== "safe") {
    notes.push({
      kind: "target",
      label: "목표 용량 기반 추가 압축",
      detail: `${formatBytes(input.targetBytes)} 목표까지 JPEG 품질/크기 후보를 순차 검토`,
      count: 1
    });
  }
  if (input.mode !== "safe" && input.report.opportunityGroups.some((group) => group.visualImpact !== "none")) {
    notes.push({
      kind: "quality",
      label: "이미지 품질 자동 검증",
      detail: "PSNR/SSIM 기준을 통과한 이미지 후보만 적용",
      count: 1
    });
  }
  const nearDuplicateCount = input.report.nearDuplicateImages?.length ?? 0;
  if (nearDuplicateCount > 0) {
    notes.push({
      kind: "review",
      label: "유사 이미지 확인 필요",
      detail: `${nearDuplicateCount}개 후보는 자동 병합하지 않음`,
      count: nearDuplicateCount
    });
  }
  const diagnosticCount = input.report.resourceDiagnostics?.length ?? 0;
  if (diagnosticCount > 0) {
    notes.push({
      kind: "review",
      label: "폰트/OLE 용량 확인",
      detail: `${diagnosticCount}개 진단은 자동 제거하지 않음`,
      count: diagnosticCount
    });
  }
  return notes;
}

type RawSubmissionActionRow = SubmissionActionRow & {
  group?: OptimizationOpportunityGroup;
};

function createPriorityActionRows(actionRows: RawSubmissionActionRow[]): SubmissionActionRow[] {
  return [...actionRows]
    .sort((left, right) => actionPriority(left.action) - actionPriority(right.action) || left.label.localeCompare(right.label))
    .map((row, index) => {
      const { group: _group, ...publicRow } = row;
      return {
        ...publicRow,
        priority: index + 1,
        actions: [row.action],
        selectedActions: row.checked ? [row.action] : [],
        partiallyChecked: false,
        savingBytes: row.group?.estimatedSavingBytes ?? row.savingBytes,
        savingLabel: formatBytes(row.group?.estimatedSavingBytes ?? row.savingBytes)
      };
    });
}

function actionBucket(action: OptimizationOpportunityGroup["action"]): SubmissionActionBucket {
  return ACTION_BUCKETS[action] ?? "image";
}

function actionPriority(action: SubmissionActionId): number {
  return ACTION_PRIORITY_ORDER[action] ?? 100;
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
