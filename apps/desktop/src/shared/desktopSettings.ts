import type { PreservationPreference, SubmissionLimit } from "./submissionPlan.js";
import { sanitizeSubmissionLimit } from "./submissionLimits.js";

export type OptimizationMode = "safe" | "balanced" | "aggressive";
export type BatchTargetMode = "aggregate" | "per-file";

export type DesktopSettings = {
  settingsVersion?: number;
  defaultMode: OptimizationMode;
  saveNextToOriginal: boolean;
  saveReport: boolean;
  preventOverwrite: boolean;
  showAggressiveWarning: boolean;
  submissionLimit: SubmissionLimit;
  preservationPreference: PreservationPreference;
  batchTargetMode: BatchTargetMode;
};

export type DesktopSettingsPatch = Partial<DesktopSettings> & Record<string, unknown>;

export const CURRENT_SETTINGS_VERSION = 3;
export const defaultDesktopSettings: DesktopSettings = {
  settingsVersion: CURRENT_SETTINGS_VERSION,
  defaultMode: "balanced",
  saveNextToOriginal: true,
  saveReport: false,
  preventOverwrite: true,
  showAggressiveWarning: true,
  submissionLimit: { id: "mb40" },
  preservationPreference: "recommended",
  batchTargetMode: "per-file"
};


export type SettingsNotice = { kind: "recovered" | "migrated" | "read-error" | "newer-version"; message: string };
export type DesktopSettingsSnapshot = DesktopSettings & { settingsNotice?: SettingsNotice };

export function settingsRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function persistentDesktopSettingsPatch(value: unknown): Partial<DesktopSettings> {
  if (!settingsRecord(value)) return {};
  const patch = value;
  const sanitized: Partial<DesktopSettings> = {};
  if (isOptimizationMode(patch.defaultMode)) sanitized.defaultMode = patch.defaultMode;
  if (patch.saveNextToOriginal === true) sanitized.saveNextToOriginal = true;
  if (typeof patch.saveReport === "boolean") sanitized.saveReport = patch.saveReport;
  if (typeof patch.preventOverwrite === "boolean") sanitized.preventOverwrite = patch.preventOverwrite;
  if (typeof patch.showAggressiveWarning === "boolean") sanitized.showAggressiveWarning = patch.showAggressiveWarning;
  const limit = sanitizeSubmissionLimit(patch.submissionLimit);
  if (limit) sanitized.submissionLimit = limit;
  if (patch.preservationPreference === "preserve" || patch.preservationPreference === "recommended" || patch.preservationPreference === "size") sanitized.preservationPreference = patch.preservationPreference;
  if (patch.batchTargetMode === "aggregate" || patch.batchTargetMode === "per-file") sanitized.batchTargetMode = patch.batchTargetMode;
  return sanitized;
}

export function normalizeDesktopSettings(raw: unknown): DesktopSettings {
  const parsed = persistentDesktopSettingsPatch(raw);
  const version = settingsRecord(raw) ? raw.settingsVersion : undefined;
  const legacy = version === undefined || (typeof version === "number" && version < CURRENT_SETTINGS_VERSION);
  const migratedMode = legacy && parsed.defaultMode === "safe" &&
    (parsed.preservationPreference ?? defaultDesktopSettings.preservationPreference) === "recommended"
      ? "balanced" : parsed.defaultMode;
  const limit = parsed.submissionLimit?.id === "mb41" ? { id: "mb40" as const } : parsed.submissionLimit;
  return { ...defaultDesktopSettings, ...parsed,
    submissionLimit: limit ?? { ...defaultDesktopSettings.submissionLimit },
    defaultMode: migratedMode ?? defaultDesktopSettings.defaultMode,
    settingsVersion: defaultDesktopSettings.settingsVersion };
}

/** Known malformed fields are rejected on writes and disclosed on disk recovery. */
export function invalidSettingsFields(raw: unknown): string[] {
  if (!settingsRecord(raw)) return ["settings"];
  const sanitized = persistentDesktopSettingsPatch(raw);
  const invalid = ["defaultMode", "saveReport", "preventOverwrite", "showAggressiveWarning", "submissionLimit", "preservationPreference", "batchTargetMode"]
    .filter(key => raw[key] !== undefined && !Object.hasOwn(sanitized, key));
  if (raw.saveNextToOriginal !== undefined && typeof raw.saveNextToOriginal !== "boolean") invalid.push("saveNextToOriginal");
  return invalid;
}

export function isOptimizationMode(value: unknown): value is OptimizationMode {
  return value === "safe" || value === "balanced" || value === "aggressive";
}
