import type { AppliedAction, OptimizationOpportunityGroup } from "@hwpx-optimizer/core";
import { ACTION_CATALOG } from "./actionCatalog.js";

export const OPPORTUNITY_ACTION_LABELS = Object.fromEntries(
  Object.entries(ACTION_CATALOG).map(([action, item]) => [action, item.label])
) as Record<OptimizationOpportunityGroup["action"], string>;

export const APPLIED_ACTION_LABELS: Record<AppliedAction["type"], string> = {
  ...Object.fromEntries(Object.entries(ACTION_CATALOG).map(([action, item]) => [action, item.appliedLabel ?? item.label])) as Record<OptimizationOpportunityGroup["action"], string>,
  "repack-zip": "HWPX 재압축"
};
