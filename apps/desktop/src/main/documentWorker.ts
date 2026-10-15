import { parentPort } from "node:worker_threads";
import { analyzeDesktopFile, prepareDesktopOptimization, warmDesktopCore } from "./desktopService.js";
import type { DocumentWorkerMessage, DocumentWorkerRequest } from "./documentProtocol.js";

type WorkerRequest = DocumentWorkerRequest & { id: number };

function post(message: DocumentWorkerMessage): void {
  parentPort?.postMessage(message);
}

let requestQueue: Promise<void> = Promise.resolve();

parentPort?.on("message", (message: WorkerRequest) => {
  requestQueue = requestQueue.then(
    () => handleRequest(message),
    () => handleRequest(message)
  );
});

async function handleRequest(message: WorkerRequest): Promise<void> {
  try {
    if (message.type === "warm") {
      await warmDesktopCore();
      post({ id: message.id, type: "warm-complete" });
      return;
    }
    if (message.type === "analyze") {
      const result = await analyzeDesktopFile(message.filePath);
      post({ id: message.id, type: "complete", result });
      return;
    }
    const result = await prepareDesktopOptimization(message.input, (progress) =>
      post({ id: message.id, type: "progress", ...progress })
    );
    // Transfer large owned buffers without copying. Small/pool-backed views get
    // their own allocation, avoiding Buffer slab transfer and detached caches.
    const output = result.output.byteOffset === 0 && result.output.byteLength === result.output.buffer.byteLength &&
      result.output.buffer instanceof ArrayBuffer && result.output.byteLength > Buffer.poolSize
      ? result.output : Uint8Array.from(result.output);
    parentPort?.postMessage({ id: message.id, type: "complete", result: { ...result, output } }, [output.buffer as ArrayBuffer]);
  } catch (error) {
    post({ id: message.id, type: "error", message: error instanceof Error ? error.message : String(error) });
  }
}
