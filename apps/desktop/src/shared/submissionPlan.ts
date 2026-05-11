import type { OptimizationOpportunityGroup, OptimizationReport } from "@hwpx-optimizer/core";
import { OPPORTUNITY_ACTION_LABELS } from "./actionLabels.js";
import { formatBytes, type OptimizationMode } from "./viewModel.js";

export type PreservationLevel = "preserve" | "recommended" | "size";

export type SubmissionLimitId = "none" | "mb10" | "mb20" | "mb50" | "custom";

export type SubmissionLimit = {
  id: SubmissionLimitId;
  customBytes?: number;
};

export type SubmissionTargetStatus = "target-met" | "target-missed" | "already-under-target";

export type SubmissionPlanKind = "automatic" | "custom";

export type SubmissionActionRow = {
  action: OptimizationOpportunityGroup["action"];
  label: string;
  count: number;
  savingBytes: number;
  savingLabel: string;
  risk: OptimizationOpportunityGroup["risk"];
  visualImpact: OptimizationOpportunityGroup["visualImpact"];
  defaultEnabledForMode: boolean;
  checked: boolean;
  includedInExpectedSaving: boolean;
};

export type SubmissionPlan = {
  kind: SubmissionPlanKind;
  mode: OptimizationMode;
  expectedSavingBytes: number;
  expectedSavingLabel: string;
  expectedSizeBytes: number;
  expectedSizeLabel: string;
  targetStatus: SubmissionTargetStatus;
  targetStatusLabel: string;
  actionRows: SubmissionActionRow[];
  selectedActions: SubmissionActionRow["action"][];
};

const MIB = 1024 * 1024;

// Sub-MiB savings (strip-metadata, clean-shape-comment, ...) are useful as
// hints but they are too noisy to factor into the projected submission size,
// since report estimates carry several hundred KiB of error on real files.
// We surface them in actionRows for the toggle UI but exclude them from the
// expected-size math.
const EXPECTED_SAVING_THRESHOLD_BYTES = 1 * MIB;

export function modeForPreservation(value: PreservationLevel): OptimizationMode {
  if (value === "preserve") return "safe";
  if (value === "size") return "aggressive";
  return "balanced";
}

export function resolveSubmissionLimitBytes(limit: SubmissionLimit): number | undefined {
  switch (limit.id) {
    case "none":
      return undefined;
    case "mb10":
      return 10 * MIB;
    case "mb20":
      return 20 * MIB;
    case "mb50":
      return 50 * MIB;
    case "custom":
      return limit.customBytes;
  }
}

export function createSubmissionPlan(input: {
  report: OptimizationReport;
  limit: SubmissionLimit;
  preservation: PreservationLevel;
  actionOverrides: Record<string, boolean>;
}): SubmissionPlan {
  const mode = modeForPreservation(input.preservation);
  const limitBytes = resolveSubmissionLimitBytes(input.limit);

  const actionRows: SubmissionActionRow[] = input.report.opportunityGroups.map((group) => {
    const defaultEnabledForMode = group.defaultEnabledIn.includes(mode);
    const override = input.actionOverrides[group.action];
    const checked = override === undefined ? defaultEnabledForMode : override;
    return {
      action: group.action,
      label: OPPORTUNITY_ACTION_LABELS[group.action] ?? group.label,
      count: group.count,
      savingBytes: group.estimatedSavingBytes,
      savingLabel: formatBytes(group.estimatedSavingBytes),
      risk: group.risk,
      visualImpact: group.visualImpact,
      defaultEnabledForMode,
      checked,
      includedInExpectedSaving: checked && group.estimatedSavingBytes >= EXPECTED_SAVING_THRESHOLD_BYTES
    };
  });

  const hasCustomOverride = actionRows.some((row) => {
    const override = input.actionOverrides[row.action];
    return override !== undefined && override !== row.defaultEnabledForMode;
  });
  const kind: SubmissionPlanKind = hasCustomOverride ? "custom" : "automatic";

  const expectedSavingBytes = actionRows
    .filter((row) => row.includedInExpectedSaving)
    .reduce((sum, row) => sum + row.savingBytes, 0);
  const expectedSizeBytes = Math.max(0, input.report.originalSize - expectedSavingBytes);

  const targetStatus = resolveTargetStatus({
    originalSize: input.report.originalSize,
    expectedSizeBytes,
    limitBytes
  });

  const selectedActions = actionRows.filter((row) => row.checked).map((row) => row.action);

  return {
    kind,
    mode,
    expectedSavingBytes,
    expectedSavingLabel: formatBytes(expectedSavingBytes),
    expectedSizeBytes,
    expectedSizeLabel: formatBytes(expectedSizeBytes),
    targetStatus,
    targetStatusLabel: labelForTargetStatus(targetStatus),
    actionRows,
    selectedActions
  };
}

function resolveTargetStatus(input: {
  originalSize: number;
  expectedSizeBytes: number;
  limitBytes: number | undefined;
}): SubmissionTargetStatus {
  if (input.limitBytes === undefined) return "target-met";
  if (input.originalSize <= input.limitBytes) return "already-under-target";
  if (input.expectedSizeBytes <= input.limitBytes) return "target-met";
  return "target-missed";
}

function labelForTargetStatus(status: SubmissionTargetStatus): string {
  switch (status) {
    case "target-met":
      return "목표 달성 가능";
    case "target-missed":
      return "목표 미달 가능";
    case "already-under-target":
      return "이미 목표 이하";
  }
}
