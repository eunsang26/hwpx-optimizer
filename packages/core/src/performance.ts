import type { PerformanceStage, PerformanceSummary } from "./types.js";

/**
 * Stage timer used by optimize/analyze entry points. Summaries are always
 * attached to reports as `performance`. For stderr stage dumps, CLI/desktop
 * may honor `HWPX_OPT_TIMINGS=1` at their boundary (core does not read env).
 */
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
