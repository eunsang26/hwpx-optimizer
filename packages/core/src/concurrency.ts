import { availableParallelism } from "node:os";

export type MapLimitOptions = {
  signal?: AbortSignal;
};

export function defaultImageConcurrency(): number {
  const cpuCount = availableParallelism();
  return Math.max(1, Math.min(6, Math.floor(cpuCount || 4)));
}

export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
  options: MapLimitOptions = {}
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let firstError: unknown;

  function isAborted(): boolean {
    return firstError !== undefined || options.signal?.aborted === true;
  }

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      if (isAborted()) return;
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await mapper(items[index]!, index);
      } catch (error) {
        if (firstError === undefined) firstError = error;
        throw error;
      }
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  const settlements = await Promise.allSettled(
    Array.from({ length: workerCount }, () => worker())
  );
  if (options.signal?.aborted) {
    throw options.signal.reason ?? new Error("mapLimit aborted");
  }
  if (firstError !== undefined) throw firstError;
  for (const settlement of settlements) {
    if (settlement.status === "rejected") throw settlement.reason;
  }
  return results;
}
