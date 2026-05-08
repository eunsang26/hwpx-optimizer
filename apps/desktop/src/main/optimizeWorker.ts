import { parentPort, workerData } from "node:worker_threads";
import { optimizeDesktopFile } from "./desktopService.js";
import type { DesktopOptimizeInput } from "./desktopService.js";

type WorkerMessage =
  | { type: "progress"; percent: number; item: string }
  | { type: "complete"; result: Awaited<ReturnType<typeof optimizeDesktopFile>> }
  | { type: "error"; message: string };

function post(message: WorkerMessage): void {
  parentPort?.postMessage(message);
}

try {
  const input = workerData as DesktopOptimizeInput;
  const result = await optimizeDesktopFile(input, (progress) => post({ type: "progress", ...progress }));
  post({ type: "complete", result });
} catch (error) {
  post({ type: "error", message: error instanceof Error ? error.message : String(error) });
}
