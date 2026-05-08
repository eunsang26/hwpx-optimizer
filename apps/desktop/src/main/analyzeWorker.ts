import { parentPort, workerData } from "node:worker_threads";
import { analyzeDesktopFile } from "./desktopService.js";

type WorkerMessage =
  | { type: "complete"; result: Awaited<ReturnType<typeof analyzeDesktopFile>> }
  | { type: "error"; message: string };

function post(message: WorkerMessage): void {
  parentPort?.postMessage(message);
}

try {
  const result = await analyzeDesktopFile(String(workerData));
  post({ type: "complete", result });
} catch (error) {
  post({ type: "error", message: error instanceof Error ? error.message : String(error) });
}
