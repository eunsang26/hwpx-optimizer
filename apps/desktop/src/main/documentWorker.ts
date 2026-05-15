import { parentPort } from "node:worker_threads";
import { analyzeDesktopFile, optimizeDesktopFile, warmDesktopCore } from "./desktopService.js";
import type { DesktopAnalysisResult, DesktopOptimizeInput, DesktopOptimizeResult } from "./desktopService.js";

type WorkerRequest =
  | { id: number; type: "warm" }
  | { id: number; type: "analyze"; filePath: string }
  | { id: number; type: "optimize"; input: DesktopOptimizeInput };

type WorkerResponse =
  | { id: number; type: "warm-complete" }
  | { id: number; type: "progress"; percent: number; item: string }
  | { id: number; type: "complete"; result: DesktopAnalysisResult | DesktopOptimizeResult }
  | { id: number; type: "error"; message: string };

function post(message: WorkerResponse): void {
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
    const result = await optimizeDesktopFile(message.input, (progress) =>
      post({ id: message.id, type: "progress", ...progress })
    );
    post({ id: message.id, type: "complete", result });
  } catch (error) {
    post({ id: message.id, type: "error", message: error instanceof Error ? error.message : String(error) });
  }
}
