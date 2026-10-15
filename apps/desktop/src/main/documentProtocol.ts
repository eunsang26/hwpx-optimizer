import type { DesktopAnalysisResult, DesktopOptimizeInput, DesktopPreparedOptimization } from "./desktopService.js";

export type DocumentWorkerRequest =
  | { type: "warm" }
  | { type: "analyze"; filePath: string }
  | { type: "optimize"; input: DesktopOptimizeInput };

export type DocumentWorkerMessage =
  | { id: number; type: "warm-complete" }
  | { id: number; type: "progress"; percent: number; item: string }
  | { id: number; type: "complete"; result: DesktopAnalysisResult | DesktopPreparedOptimization }
  | { id: number; type: "error"; message: string };
