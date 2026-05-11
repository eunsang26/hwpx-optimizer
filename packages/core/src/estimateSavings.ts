import type { OptimizationOpportunityGroup } from "./types.js";

export type SavingsOpportunityLike = Pick<OptimizationOpportunityGroup, "estimatedSavingBytes" | "targets">;

export function estimateNonOverlappingSavingBytes(groups: readonly SavingsOpportunityLike[]): number {
  const savingByTarget = new Map<string, number>();
  let untargetedSavingBytes = 0;

  for (const group of groups) {
    const savingBytes = Math.max(0, group.estimatedSavingBytes);
    const targets = uniqueTargets(group.targets);
    if (targets.length === 0) {
      untargetedSavingBytes += savingBytes;
      continue;
    }

    const savingPerTarget = savingBytes / targets.length;
    for (const target of targets) {
      savingByTarget.set(target, Math.max(savingByTarget.get(target) ?? 0, savingPerTarget));
    }
  }

  const targetedSavingBytes = [...savingByTarget.values()].reduce((sum, value) => sum + value, 0);
  return Math.round(untargetedSavingBytes + targetedSavingBytes);
}

function uniqueTargets(targets: readonly string[] | undefined): string[] {
  return [...new Set((targets ?? []).filter((target) => target.trim().length > 0))];
}
