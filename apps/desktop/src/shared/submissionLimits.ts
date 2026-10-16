import type { SubmissionLimit, SubmissionLimitId } from "./submissionPlan.js";

export const MIB = 1024 * 1024;
export const MIN_CUSTOM_LIMIT_BYTES = 1;
// Supports both per-file limits and aggregate batch budgets without unsafe integers.
export const MAX_CUSTOM_LIMIT_BYTES = 1024 ** 4;
export const CUSTOM_LIMIT_MESSAGE = "1바이트 이상 1,048,576MB(1TiB) 이하의 용량을 입력하세요. 예: 0.5, 40";

const presetIds = new Set(["none", "mb5", "mb10", "mb20", "mb30", "mb40", "mb41", "mb50", "mb100"]);

export function validCustomLimitBytes(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) &&
    value >= MIN_CUSTOM_LIMIT_BYTES && value <= MAX_CUSTOM_LIMIT_BYTES;
}

export function sanitizeSubmissionLimit(value: unknown): SubmissionLimit | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const input = value as Record<string, unknown>;
  if (input.id === "custom") return validCustomLimitBytes(input.customBytes)
    ? { id: "custom", customBytes: input.customBytes } : undefined;
  if (typeof input.id === "string" && presetIds.has(input.id)) return { id: input.id as SubmissionLimitId };
  return;
}

export function customLimitBytesFromMb(value: string): number | undefined {
  if (!value.trim()) return;
  const mb = Number(value);
  if (!Number.isFinite(mb) || mb < MIN_CUSTOM_LIMIT_BYTES / MIB || mb > MAX_CUSTOM_LIMIT_BYTES / MIB) return;
  const bytes = Math.round(mb * MIB);
  return validCustomLimitBytes(bytes) ? bytes : undefined;
}
