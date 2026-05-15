import type { PerformanceStage, PerformanceSummary } from "./types.js";

export class PerformanceTimer {
  private readonly startedAt = nowMs();
  private readonly stages: PerformanceStage[] = [];

  async measure<T>(name: string, operation: () => Promise<T>): Promise<T> {
    const startedAt = nowMs();
    try {
      return await operation();
    } finally {
      this.stages.push({ name, durationMs: elapsedMs(startedAt) });
    }
  }

  mark(name: string, startedAt: number): void {
    this.stages.push({ name, durationMs: elapsedMs(startedAt) });
  }

  summary(): PerformanceSummary {
    return {
      totalMs: elapsedMs(this.startedAt),
      stages: this.stages
    };
  }
}

export function nowMs(): number {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Number((nowMs() - startedAt).toFixed(3)));
}
