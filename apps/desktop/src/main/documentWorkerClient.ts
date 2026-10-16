import { Worker } from "node:worker_threads";
import type { DesktopAnalysisResult, DesktopOptimizeInput, DesktopPreparedOptimization, DesktopProgress } from "./desktopService.js";
import type { DocumentWorkerMessage, DocumentWorkerRequest } from "./documentProtocol.js";
import { DOCUMENT_IDLE_TIMEOUT_MS } from "./documentOperations.js";

type Pending = { resolve: (result: unknown) => void; reject: (error: Error) => void; progress?: (item: DesktopProgress) => void; cleanup: () => void };
type WorkerState = { worker: Worker; pending: Map<number, Pending>; stopping?: Promise<void>; reason?: Error };

/** A terminated generation can settle only its own requests. */
export class DocumentWorkerClient {
  private state?: WorkerState;
  private stopping?: Promise<void>;
  private nextId = 1;
  constructor(private readonly createWorker: () => Worker = () => new Worker(new URL("./documentWorker.js", import.meta.url))) {}

  async warm(): Promise<void> {
    await this.request({ type: "warm" }, AbortSignal.timeout(DOCUMENT_IDLE_TIMEOUT_MS));
  }
  analyze(filePath: string, signal: AbortSignal, analysisMode: "quick" | "deep" = "quick"): Promise<DesktopAnalysisResult> {
    return this.request({ type: "analyze", filePath, analysisMode }, signal);
  }
  prepare(input: DesktopOptimizeInput, signal: AbortSignal, progress: (item: DesktopProgress) => void): Promise<DesktopPreparedOptimization> {
    return this.request({ type: "optimize", input }, signal, progress);
  }
  async dispose(): Promise<void> {
    if (this.state) await this.stop(this.state, new Error("Document worker stopped."));
    await this.stopping;
  }

  private ensureWorker(): WorkerState {
    if (this.state) return this.state;
    const state: WorkerState = { worker: this.createWorker(), pending: new Map() };
    this.state = state;
    state.worker.on("message", (message: DocumentWorkerMessage) => {
      if (state.stopping) return;
      const pending = state.pending.get(message.id);
      if (!pending) return;
      if (message.type === "progress") {
        try { pending.progress?.({ percent: message.percent, item: message.item }); }
        catch (error) { void this.stop(state, error instanceof Error ? error : new Error(String(error))); }
        return;
      }
      state.pending.delete(message.id);
      pending.cleanup();
      if (message.type === "error") pending.reject(new Error(message.message));
      else pending.resolve(message.type === "warm-complete" ? { ok: true } : message.result);
    });
    state.worker.on("error", error => { void this.stop(state, error); });
    state.worker.on("exit", code => {
      if (this.state === state) this.state = undefined;
      this.rejectAll(state, state.reason ?? new Error(`문서 작업 worker가 예기치 않게 종료되었습니다. 종료 코드: ${code}.`));
    });
    return state;
  }

  private rejectAll(state: WorkerState, error: Error): void {
    for (const pending of state.pending.values()) { pending.cleanup(); pending.reject(error); }
    state.pending.clear();
  }
  private stop(state: WorkerState, error: Error): Promise<void> {
    state.reason ??= error;
    state.stopping ??= state.worker.terminate().then(() => undefined).finally(() => {
      this.rejectAll(state, state.reason!);
      if (this.state === state) this.state = undefined;
      if (this.stopping === state.stopping) this.stopping = undefined;
    });
    this.stopping = state.stopping;
    return state.stopping;
  }

  private async request<T>(request: DocumentWorkerRequest, signal: AbortSignal,
    progress?: (item: DesktopProgress) => void): Promise<T> {
    await this.stopping;
    signal.throwIfAborted();
    const state = this.ensureWorker();
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const abort = (): void => { void this.stop(state, signal.reason instanceof Error ? signal.reason : new DOMException("Operation cancelled.", "AbortError")); };
      state.pending.set(id, { resolve: result => resolve(result as T), reject, progress,
        cleanup: () => signal.removeEventListener("abort", abort) });
      signal.addEventListener("abort", abort, { once: true });
      try { state.worker.postMessage({ ...request, id }); }
      catch (error) {
        signal.removeEventListener("abort", abort); state.pending.delete(id);
        reject(error);
      }
    });
  }
}
