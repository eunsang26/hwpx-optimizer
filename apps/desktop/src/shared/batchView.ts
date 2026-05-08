import type { OptimizationReport } from "@hwpx-optimizer/core";
import type { BatchItemStatus } from "./labels.js";
import { formatBytes } from "./viewModel.js";

export type BatchItemLike = {
  path: string;
  fileName: string;
  status: BatchItemStatus;
  outputPath?: string;
  reportPath?: string;
  savedBytes?: number;
  savedPercent?: number;
  error?: string;
};

export type BatchSummary = {
  totalCount: number;
  counts: Record<BatchItemStatus, number>;
  totalSavedBytes: number;
  text: string;
};

export function summarizeBatchItems(items: BatchItemLike[], options: { running: boolean } = { running: false }): BatchSummary {
  if (items.length === 0) {
    return {
      totalCount: 0,
      counts: emptyCounts(),
      totalSavedBytes: 0,
      text: "파일을 추가하면 진행 상태가 여기에 표시됩니다."
    };
  }
  const counts = emptyCounts();
  let totalSavedBytes = 0;
  for (const item of items) {
    counts[item.status] += 1;
    totalSavedBytes += item.savedBytes ?? 0;
  }
  const segments: string[] = [`${items.length}개 파일`];
  if (counts.done > 0) segments.push(`완료 ${counts.done}`);
  if (counts.failed > 0) segments.push(`실패 ${counts.failed}`);
  if (counts.cancelled > 0) segments.push(`취소 ${counts.cancelled}`);
  if (counts.pending > 0 && !options.running) segments.push(`대기 ${counts.pending}`);
  const baseline = segments.join(" · ");
  const text = totalSavedBytes > 0 ? `${baseline} · 총 절감 ${formatBytes(totalSavedBytes)}` : baseline;
  return { totalCount: items.length, counts, totalSavedBytes, text };
}

export function batchItemMetaText(item: BatchItemLike): string {
  if (item.status === "done") {
    const saved = item.savedBytes ?? 0;
    const percent = item.savedPercent ?? 0;
    return `절감 ${formatBytes(saved)} (${percent.toFixed(2)}%)`;
  }
  if (item.status === "failed") return item.error ?? "실패";
  if (item.status === "cancelled") return "취소됨";
  return item.path;
}

export function applyOptimizationResultToBatchItem(
  item: BatchItemLike,
  response: { outputPath: string; reportPath?: string; report: OptimizationReport }
): BatchItemLike {
  return {
    ...item,
    status: "done",
    outputPath: response.outputPath,
    reportPath: response.reportPath,
    savedBytes: response.report.savedBytes,
    savedPercent: response.report.savedPercent
  };
}

function emptyCounts(): Record<BatchItemStatus, number> {
  return { pending: 0, running: 0, done: 0, failed: 0, cancelled: 0 };
}
