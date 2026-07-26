import type { OptimizationOpportunityGroup, OptimizationReport } from "@hwpx-optimizer/core";
import { estimateNonOverlappingSavingBytes } from "./estimateSavings.js";
import {
  classifyTargetVerdict,
  estimateSizeAtJpegQuality,
  jpegBaselineBytesFromGroups,
  planJpegQualityForTarget,
  type TargetVerdict
} from "./targetPlan.js";
import { createActionToggles, formatBytes, type OptimizationMode } from "./viewModel.js";

export type SubmissionLimitId =
  | "none"
  | "mb5"
  | "mb10"
  | "mb20"
  | "mb30"
  | "mb40"
  | "mb41"
  | "mb50"
  | "mb100"
  | "custom";
export type PreservationPreference = "preserve" | "recommended" | "size";
export type PlanStatus = "target-met" | "target-missed" | "already-under-target" | "no-target";
export type PlanKind = "automatic" | "custom";
export type SubmissionActionBucket = "image" | "metadata" | "author";
export type SubmissionActionId = OptimizationOpportunityGroup["action"];

const JPEG_QUALITY_FLOOR = 60;
const JPEG_QUALITY_CEILING = 95;
const BASELINE_JPEG_QUALITY_BALANCED = 88;

export type SubmissionLimit = {
  id: SubmissionLimitId;
  customBytes?: number;
};

export type SubmissionPlanInput = {
  submissionLimit: SubmissionLimit;
  preservationPreference: PreservationPreference;
  actionOverrides: Map<SubmissionActionId, boolean>;
  /** Manual JPEG quality (60–95). When set, expected size/verdict use this quality. */
  jpegQuality?: number;
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
  verdict: TargetVerdict;
  verdictLabel: string;
  verdictDetail: string;
  floorExpectedBytes: number;
  plannedJpegQuality?: number;
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
  jpegQuality?: number;
};

export const SUBMISSION_LIMIT_LABELS: Record<SubmissionLimitId, string> = {
  none: "제한 없음",
  mb5: "5 MB 미만",
  mb10: "10 MB 미만",
  mb20: "20 MB 미만",
  mb30: "30 MB 미만",
  mb40: "40 MB 미만",
  mb41: "41 MB 미만",
  mb50: "50 MB 미만",
  mb100: "100 MB 미만",
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
  "strip-metadata": "EXIF 제외 이미지 정보 제거",
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

const ESTIMATED_SAVING_DISPLAY_RATIO = 0.95;

export function modeForPreservation(preference: PreservationPreference): OptimizationMode {
  if (preference === "preserve") return "safe";
  if (preference === "size") return "aggressive";
  return "balanced";
}

/** Inverse of modeForPreservation — keeps settings "기본 모드" aligned with the toolbar. */
export function preservationForMode(mode: OptimizationMode): PreservationPreference {
  if (mode === "safe") return "preserve";
  if (mode === "aggressive") return "size";
  return "recommended";
}

export function resolveSubmissionLimitBytes(limit: SubmissionLimit): number | undefined {
  if (limit.id === "mb5") return 5 * 1024 * 1024;
  if (limit.id === "mb10") return 10 * 1024 * 1024;
  if (limit.id === "mb20") return 20 * 1024 * 1024;
  if (limit.id === "mb30") return 30 * 1024 * 1024;
  if (limit.id === "mb40") return 40 * 1024 * 1024;
  if (limit.id === "mb41") return 41 * 1024 * 1024;
  if (limit.id === "mb50") return 50 * 1024 * 1024;
  if (limit.id === "mb100") return 100 * 1024 * 1024;
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
  const selectedGroups = rawActionRows.flatMap((row) => (row.checked && row.group ? [row.group] : []));
  const allGroups = rawActionRows.flatMap((row) => (row.group ? [row.group] : []));
  const rawExpectedSavingBytes = estimateNonOverlappingSavingBytes(selectedGroups);
  const savingCapBytes =
    report.originalSize > 0
      ? Math.max(0, Math.floor(report.originalSize * ESTIMATED_SAVING_DISPLAY_RATIO))
      : rawExpectedSavingBytes;
  const expectedSavingBytes = Math.min(rawExpectedSavingBytes, savingCapBytes);
  const wasCapped = rawExpectedSavingBytes > expectedSavingBytes;
  const rawJpegBaselineBytes = jpegBaselineBytesFromGroups(selectedGroups);
  const fullSavingBytes = estimateNonOverlappingSavingBytes(allGroups);
  const selectedSavingBytes = estimateNonOverlappingSavingBytes(selectedGroups);
  const selectionRatio = fullSavingBytes > 0 ? clampRatio(selectedSavingBytes / fullSavingBytes) : 1;
  // Prefer ZIP-aware analysis projection when it belongs to these opportunity groups.
  // Fixtures/overrides that keep a stale optimizedSize fall back to entry savings.
  const entryBaselineSizeBytes = Math.max(0, report.originalSize - expectedSavingBytes);
  const baselineSummarySizeBytes =
    resolveProjectedBaselineBytes({
      originalSize: report.originalSize,
      projectedSize: report.optimizedSize,
      fullSavingBytes,
      selectedSavingBytes,
      fallbackSizeBytes: entryBaselineSizeBytes
    }) ?? entryBaselineSizeBytes;
  const jpegBaselineBytes = Math.round(rawJpegBaselineBytes * Math.max(0.25, selectionRatio || 1));
  const targetBytes = resolveSubmissionLimitBytes(input.submissionLimit);
  const sizeEstimate = (quality: number): number =>
    estimateSizeAtJpegQuality({
      originalBytes: report.originalSize,
      baselineExpectedBytes: baselineSummarySizeBytes,
      baselineQuality: BASELINE_JPEG_QUALITY_BALANCED,
      quality,
      floor: JPEG_QUALITY_FLOOR,
      ceiling: JPEG_QUALITY_CEILING,
      jpegBaselineBytes
    });
  const projectedAggressive = resolveProjectedBaselineBytes({
    originalSize: report.originalSize,
    projectedSize: report.aggressiveProjectedOptimizedSize,
    fullSavingBytes,
    selectedSavingBytes,
    fallbackSizeBytes: undefined
  });
  const floorExpectedBytes =
    mode === "safe"
      ? baselineSummarySizeBytes
      : (projectedAggressive ?? sizeEstimate(JPEG_QUALITY_FLOOR));

  // Aggressive always uses the quality floor (manual JPEG % is ignored).
  const manualQuality =
    mode !== "aggressive" && input.jpegQuality !== undefined
      ? clamp(input.jpegQuality, JPEG_QUALITY_FLOOR, JPEG_QUALITY_CEILING)
      : undefined;
  // Aggressive auto always executes at the quality floor — estimate at floor.
  // Manual override (balanced) estimates at the chosen quality.
  // Balanced auto + target: binary-search highest quality that meets 미만.
  let displaySizeBytes = baselineSummarySizeBytes;
  let atFloor = mode === "safe";
  let plannedQuality: number | undefined;
  if (mode === "safe") {
    plannedQuality = undefined;
  } else if (manualQuality !== undefined) {
    plannedQuality = manualQuality;
    atFloor = manualQuality <= JPEG_QUALITY_FLOOR;
    displaySizeBytes = sizeEstimate(manualQuality);
  } else if (mode === "aggressive") {
    plannedQuality = JPEG_QUALITY_FLOOR;
    atFloor = true;
    displaySizeBytes = floorExpectedBytes;
  } else if (targetBytes) {
    const planned = planJpegQualityForTarget({
      originalBytes: report.originalSize,
      baselineExpectedBytes: baselineSummarySizeBytes,
      baselineQuality: BASELINE_JPEG_QUALITY_BALANCED,
      targetBytes,
      floor: JPEG_QUALITY_FLOOR,
      ceiling: JPEG_QUALITY_CEILING,
      jpegBaselineBytes
    });
    plannedQuality = planned.quality;
    displaySizeBytes = planned.expectedBytes;
    atFloor = planned.quality <= JPEG_QUALITY_FLOOR;
  } else {
    plannedQuality = BASELINE_JPEG_QUALITY_BALANCED;
    atFloor = false;
  }

  const displaySavingBytes = Math.max(0, report.originalSize - displaySizeBytes);
  const savedPercent = report.originalSize > 0 ? (displaySavingBytes / report.originalSize) * 100 : 0;
  const targetStatus = targetStatusFor(report.originalSize, displaySizeBytes, targetBytes);
  const expectedSavingFormatted = formatBytes(displaySavingBytes);
  const verdictResult = classifyTargetVerdict({
    expectedBytes: displaySizeBytes,
    floorExpectedBytes,
    targetBytes,
    atFloor
  });
  return {
    kind: changed ? "custom" : "automatic",
    mode,
    originalSizeLabel: formatBytes(report.originalSize),
    expectedSavingBytes: displaySavingBytes,
    expectedSavingLabel: wasCapped && manualQuality === undefined && mode !== "aggressive"
      ? `최대 ${expectedSavingFormatted}`
      : expectedSavingFormatted,
    expectedSizeBytes: displaySizeBytes,
    expectedSizeLabel:
      wasCapped && manualQuality === undefined && mode !== "aggressive"
        ? `약 ${formatBytes(displaySizeBytes)}`
        : formatBytes(displaySizeBytes),
    savedPercentLabel: `약 ${Math.min(99, Math.round(savedPercent))}% 감소`,
    targetBytes,
    targetLabel: targetBytes ? `${formatBytes(targetBytes)} 미만` : "제한 없음",
    targetStatus,
    targetStatusLabel: verdictResult.label,
    verdict: verdictResult.verdict,
    verdictLabel: verdictResult.label,
    verdictDetail: verdictResult.detail,
    floorExpectedBytes,
    plannedJpegQuality: plannedQuality,
    selectedActions,
    actionRows,
    planNotes: createPlanNotes({ report, mode, targetBytes, targetStatus, verdict: verdictResult.verdict })
  };
}

function createPlanNotes(input: {
  report: OptimizationReport;
  mode: OptimizationMode;
  targetBytes?: number;
  targetStatus: PlanStatus;
  verdict: TargetVerdict;
}): SubmissionPlanNote[] {
  const notes: SubmissionPlanNote[] = [];
  if (input.targetBytes && input.verdict !== "pass" && input.verdict !== "no-target" && input.mode === "balanced") {
    notes.push({
      kind: "target",
      label: "목표 용량에 맞춘 품질 탐색",
      detail: `${formatBytes(input.targetBytes)} 미만을 만족하는 최고 JPEG 품질(60–95)을 자동 탐색`,
      count: 1
    });
  }
  if (input.targetBytes && input.mode === "aggressive") {
    notes.push({
      kind: "target",
      label: "용량 우선 최대 압축",
      detail: "제출 기준과 무관하게 JPEG 품질 하한까지 압축합니다",
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

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, value));
}

/**
 * Use analysis ZIP projection when its implied savings roughly match the current
 * opportunity groups; otherwise fall back (stale optimizedSize on overrides).
 */
function resolveProjectedBaselineBytes(input: {
  originalSize: number;
  projectedSize: number | undefined;
  fullSavingBytes: number;
  selectedSavingBytes: number;
  fallbackSizeBytes: number | undefined;
}): number | undefined {
  const { originalSize, projectedSize, fullSavingBytes, selectedSavingBytes, fallbackSizeBytes } = input;
  if (projectedSize === undefined || projectedSize <= 0 || projectedSize >= originalSize) {
    return fallbackSizeBytes;
  }
  const projectedSaving = originalSize - projectedSize;
  const compatible =
    fullSavingBytes > 0 &&
    projectedSaving > 0 &&
    Math.abs(projectedSaving - fullSavingBytes) / Math.max(projectedSaving, fullSavingBytes) <= 0.55;
  if (!compatible) return fallbackSizeBytes;
  const ratio = fullSavingBytes > 0 ? clampRatio(selectedSavingBytes / fullSavingBytes) : 1;
  return Math.round(originalSize - projectedSaving * ratio);
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
    actionOverrides: new Map(Object.entries(reportOrInput.actionOverrides) as Array<[SubmissionActionId, boolean]>),
    ...(reportOrInput.jpegQuality !== undefined ? { jpegQuality: reportOrInput.jpegQuality } : {})
  };
}

/** "미만" semantics: strictly under the limit. */
function meetsTarget(sizeBytes: number, targetBytes: number): boolean {
  return sizeBytes < targetBytes;
}

function targetStatusFor(originalSize: number, expectedSize: number, targetBytes: number | undefined): PlanStatus {
  if (!targetBytes) return "no-target";
  if (meetsTarget(originalSize, targetBytes)) return "already-under-target";
  return meetsTarget(expectedSize, targetBytes) ? "target-met" : "target-missed";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function targetStatusLabel(status: PlanStatus): string {
  if (status === "target-met" || status === "already-under-target") return "제출 가능";
  if (status === "target-missed") return "더 압축 필요";
  return "목표 제한 없음";
}
