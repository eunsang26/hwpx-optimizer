import { ArtifactSaveError } from "@hwpx-optimizer/io";
import type { ArtifactCommitState } from "@hwpx-optimizer/io";
import { isDocumentCancellation } from "../shared/cancellation.js";
import type { CancellationResult } from "../shared/cancellation.js";
import type { DesktopProgress } from "./desktopService.js";
import { progressLabel } from "../shared/labels.js";

export const DOCUMENT_IDLE_TIMEOUT_MS = 300_000;
type Kind = "analyze" | "optimize";
export type DocumentOperationContext = {
  signal: AbortSignal;
  commitState: ArtifactCommitState;
  progress: (progress: DesktopProgress) => void;
};
type ActiveOperation = {
  kind: Kind; controller: AbortController; commitState: ArtifactCommitState; done?: Promise<unknown>;
};

function cleanAbort(error: unknown): boolean {
  if (error instanceof ArtifactSaveError) return error.recoveryPaths.length === 0 && cleanAbort(error.cause);
  return error instanceof Error && error.name === "AbortError" && (error.cause === undefined || cleanAbort(error.cause));
}

/** Serializes authorization, computation, publication and rollback as one operation. */
export class DocumentOperations {
  private active?: ActiveOperation;
  private closed = false;
  constructor(private readonly idleTimeoutMs = DOCUMENT_IDLE_TIMEOUT_MS) {}
  get busy(): boolean { return Boolean(this.active); }

  run<T>(kind: Kind, task: (context: DocumentOperationContext) => Promise<T>,
    onProgress?: (progress: DesktopProgress) => void): Promise<T> {
    if (this.closed) return Promise.reject(new Error("앱을 종료하는 중에는 새 문서 작업을 시작할 수 없습니다."));
    if (this.active) return Promise.reject(new Error("Another document operation is already running."));
    const active: ActiveOperation = { kind, controller: new AbortController(), commitState: { committed: false } };
    this.active = active;
    let timer: ReturnType<typeof setTimeout>;
    let lastItem = kind === "analyze" ? "분석 준비" : "최적화 준비";
    const arm = (): void => {
      clearTimeout(timer);
      if (active.controller.signal.aborted || active.commitState.committed) return;
      timer = setTimeout(() => {
        if (active.commitState.committed) return;
        active.controller.abort(new Error(`문서 작업의 진행 응답이 ${Math.round(this.idleTimeoutMs / 1000)}초 동안 없어 중단했습니다. 마지막 단계: ${progressLabel(lastItem)}. 저장 중이었다면 파일 복구가 끝난 뒤 종료됩니다.`));
      }, this.idleTimeoutMs);
    };
    active.controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
    arm();
    const done = Promise.resolve().then(async () => {
      active.controller.signal.throwIfAborted();
      const result = await task({
        signal: active.controller.signal, commitState: active.commitState,
        progress: (progress) => { lastItem = progress.item; arm(); onProgress?.(progress); }
      });
      if (!active.commitState.committed) active.controller.signal.throwIfAborted();
      return result;
    }).catch((error: unknown) => {
      if (cleanAbort(error)) throw new Error(kind === "analyze" ? "Analysis cancelled." : "Optimization cancelled.");
      const reason: unknown = active.controller.signal.reason;
      if (active.controller.signal.aborted && reason instanceof Error && reason.name !== "AbortError" && error !== reason) {
        throw new Error(`${reason.message} ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
      throw error;
    }).finally(() => {
      clearTimeout(timer);
      if (this.active === active) this.active = undefined;
    });
    active.done = done;
    return done;
  }

  async cancel(kind?: Kind): Promise<CancellationResult> {
    const active = this.active;
    if (!active || (kind && active.kind !== kind)) return { cancelled: false };
    if (!active.commitState.committed) {
      active.controller.abort(new DOMException(active.kind === "analyze" ? "Analysis cancelled." : "Optimization cancelled.", "AbortError"));
    }
    try { await active.done; return { cancelled: false, completed: true }; }
    catch (error) {
      return isDocumentCancellation(error) ? { cancelled: true }
        : { cancelled: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  close(): Promise<CancellationResult> {
    this.closed = true;
    return this.cancel();
  }
}
