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
  post({ type: "progress", percent: 15, item: "Reading HWPX package" });
  const result = await optimizeDesktopFile(input);
  post({ type: "progress", percent: 90, item: "Writing optimized document" });
  post({ type: "complete", result });
} catch (error) {
  post({ type: "error", message: error instanceof Error ? error.message : String(error) });
}
