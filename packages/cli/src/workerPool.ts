import { Worker } from "node:worker_threads";

export type PoolResult<TResult> =
  | { index: number; status: "ok"; result: TResult }
  | { index: number; status: "failed"; error: string };

type PoolOptions = { size: number; workerUrl: URL; execArgv?: string[] };

export class WorkerPool<TJob, TResult> {
  private readonly size: number;
  private readonly workerUrl: URL;
  private readonly execArgv?: string[];
  private readonly liveWorkers = new Set<Worker>();
  private terminated = false;
  constructor(options: PoolOptions) {
    this.size = Math.max(1, options.size);
    this.workerUrl = options.workerUrl;
    this.execArgv = options.execArgv;
  }

  async run(jobs: TJob[]): Promise<Array<PoolResult<TResult>>> {
    const results = new Array<PoolResult<TResult>>(jobs.length);
    let next = 0;
    const worker = (): Promise<void> =>
      new Promise((resolveWorker) => {
        const spawn = () => {
          if (this.terminated) return resolveWorker();
          if (next >= jobs.length) return resolveWorker();
          const index = next++;
          const w = new Worker(this.workerUrl, this.execArgv ? { execArgv: this.execArgv } : undefined);
          this.liveWorkers.add(w);
          let settled = false;
          const done = (r: PoolResult<TResult>) => {
            if (settled) return;
            settled = true;
            results[index] = r;
            this.liveWorkers.delete(w);
            w.terminate().finally(spawn);
          };
          w.once("message", (msg: { index: number; result: TResult }) => {
            if (msg.index !== index) {
              done({ index, status: "failed", error: `protocol violation: expected index ${index}, got ${msg.index}` });
              return;
            }
            done({ index, status: "ok", result: msg.result });
          });
          w.once("error", (err: Error) => done({ index, status: "failed", error: err.message }));
          w.once("exit", (code) => done({ index, status: "failed", error: `worker exited with code ${code} without a result` }));
          w.postMessage({ index, job: jobs[index] });
        };
        spawn();
      });
    await Promise.all(Array.from({ length: Math.min(this.size, jobs.length) }, () => worker()));
    return results;
  }

  async terminate(): Promise<void> {
    this.terminated = true;
    const live = Array.from(this.liveWorkers);
    this.liveWorkers.clear();
    await Promise.all(live.map((w) => w.terminate()));
  }
}
