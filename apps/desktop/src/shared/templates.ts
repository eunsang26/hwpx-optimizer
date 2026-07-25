import type { ImagePreviewPair } from "@hwpx-optimizer/core";
import { escapeHtml } from "./format.js";
import {
  batchStatusLabel,
  formatPsnr,
  psnrTier,
  psnrTierLabel,
  riskBadgeLabel,
  visualImpactBadgeLabel
} from "./labels.js";
import type { BatchItemStatus, RiskLevel, VisualImpactLevel } from "./labels.js";
import type { ActionToggleViewModel, CategorySlice } from "./viewModel.js";
import { batchItemMetaText } from "./batchView.js";
import type { BatchItemLike } from "./batchView.js";
import type { SubmissionActionRow } from "./submissionPlan.js";
import { formatBytes } from "./viewModel.js";

export function metricHtml(label: string, value: string): string {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

export function categoryBarHtml(slice: CategorySlice): string {
  const percent = slice.ratio * 100;
  return `<div class="bar kind-${escapeHtml(slice.kind)}"><span class="name">${escapeHtml(slice.label)}</span><span class="track"><span class="fill" style="width:${percent.toFixed(1)}%"></span></span><span class="value">${escapeHtml(formatBytes(slice.bytes))} (${percent.toFixed(1)}%)</span></div>`;
}

export function riskBadgeHtml(risk: RiskLevel): string {
  return `<span class="badge risk-${escapeHtml(risk)}">${escapeHtml(riskBadgeLabel(risk))}</span>`;
}

export function visualImpactBadgeHtml(impact: VisualImpactLevel): string {
  return `<span class="badge impact-${escapeHtml(impact)}">${escapeHtml(visualImpactBadgeLabel(impact))}</span>`;
}

export function actionToggleHtml(toggle: ActionToggleViewModel, checked: boolean): string {
  const checkedAttr = checked ? " checked" : "";
  return `<li><label><input type="checkbox" value="${escapeHtml(toggle.action)}"${checkedAttr} /><span class="action-text"><strong>${escapeHtml(toggle.label)}</strong><em>${toggle.count}개 · 예상 절감 ${escapeHtml(toggle.savingLabel)}</em></span><span class="action-badges">${riskBadgeHtml(toggle.risk)}${visualImpactBadgeHtml(toggle.visualImpact)}</span></label></li>`;
}

export function submissionActionRowHtml(row: SubmissionActionRow): string {
  const checkedAttr = row.checked ? " checked" : "";
  const partialClass = row.partiallyChecked ? " is-partial" : "";
  const partialAttr = row.partiallyChecked ? " data-indeterminate=\"true\"" : "";
  const actionsAttr = escapeHtml(row.actions.join(","));
  return `<li class="plan-action-row${partialClass}"><label><input type="checkbox" value="${escapeHtml(row.action)}" data-actions="${actionsAttr}"${checkedAttr}${partialAttr} /><span class="action-text"><strong>${escapeHtml(row.label)}</strong><em>${row.count}개 작업</em></span><strong class="saving">${escapeHtml(row.savingLabel)}</strong></label></li>`;
}

export function batchItemRowHtml(item: BatchItemLike, index: number, options: { running: boolean }): string {
  const meta = batchItemMetaText(item);
  const actions = batchItemRowActionsHtml(item, index, options);
  const attentionClass =
    item.targetStatusLabel === "더 압축 필요" || item.targetStatusLabel === "기준 미달"
      ? " class=\"needs-attention\""
      : "";
  const statusLabel = batchTableStatusLabel(item);
  const statusClass = batchTableStatusClass(item);
  const selectedAttr = item.selected === false ? "" : " checked";
  const disabledAttr = options.running ? " disabled" : "";
  const qualityValue =
    item.jpegQualityDisplay !== undefined
      ? String(item.jpegQualityDisplay)
      : item.qualityLabel?.match(/\d+/)?.[0] ?? "";
  const editableNumber = item.qualityEditable === true || item.jpegQualityOverride !== undefined;
  let qualityCell = escapeHtml(item.qualityLabel ?? "-");
  if (item.status === "pending" && !options.running && qualityValue) {
    qualityCell = editableNumber
      ? `<label class="row-q"><input type="number" class="batch-quality-input" data-batch-quality-index="${index}" min="60" max="95" step="1" value="${escapeHtml(
          qualityValue
        )}" aria-label="${escapeHtml(item.fileName)} JPEG 품질" /><span>%</span></label>`
      : `<button type="button" class="row-q-btn" data-batch-quality-edit="${index}" title="이 파일만 수동 품질">${escapeHtml(
          qualityValue
        )}%</button>`;
  }
  const targetSub =
    item.allocatedTargetLabel ??
    (item.targetLabel ? `기준 ${item.targetLabel.replace(/\s*미만$/, "")}` : "");
  const sizeCell =
    item.originalSizeLabel && item.expectedSizeLabel
      ? `${escapeHtml(item.originalSizeLabel)} → <strong>${escapeHtml(item.expectedSizeLabel)}</strong>`
      : escapeHtml(item.originalSizeLabel ?? item.expectedSizeLabel ?? "-");
  return `<tr${attentionClass}><td><input type="checkbox" class="batch-select" data-batch-index="${index}"${selectedAttr}${disabledAttr} aria-label="${escapeHtml(
    item.fileName
  )} 선택" /></td><td class="name"><strong>${escapeHtml(item.fileName)}</strong>${
    targetSub ? `<span class="sub">${escapeHtml(targetSub)}</span>` : ""
  }</td><td class="batch-size-cell">${sizeCell}</td><td class="batch-quality-cell">${qualityCell}</td><td class="batch-status-cell"><span class="status-line"><span class="status ${statusClass}">${escapeHtml(
    statusLabel
  )}</span><span class="row-meta">${escapeHtml(meta)}</span></span><span class="row-actions">${actions}</span></td></tr>`;
}

function batchTableStatusLabel(item: BatchItemLike): string {
  if (item.status === "pending" && item.targetStatusLabel) {
    return item.targetStatusLabel;
  }
  return batchStatusLabel(item.status);
}

function batchTableStatusClass(item: BatchItemLike): string {
  if (item.status === "pending" && item.targetStatusLabel) {
    if (item.targetStatusLabel === "기준 미달") return "failed";
    if (item.targetStatusLabel === "더 압축 필요") return "warning";
    return "pass";
  }
  return item.status;
}

export function batchItemRowActionsHtml(
  item: BatchItemLike,
  index: number,
  options: { running: boolean }
): string {
  const actions: string[] = [];
  if (item.status === "done" && item.outputPath) {
    actions.push(rowButton("open-file", index, "파일 열기"));
    actions.push(rowButton("show-folder", index, "폴더"));
    if (item.reportPath) actions.push(rowButton("open-report", index, "리포트"));
  }
  if (!options.running && isRemovable(item.status)) {
    actions.push(rowButton("remove", index, "제거"));
  }
  return actions.join("");
}

function rowButton(action: string, index: number, label: string): string {
  return `<button class="ghost" type="button" data-action="${escapeHtml(action)}" data-index="${index}">${escapeHtml(label)}</button>`;
}

function isRemovable(status: BatchItemStatus): boolean {
  return status === "pending" || status === "failed" || status === "cancelled";
}

export function imageComparePairHtml(pair: ImagePreviewPair): string {
  const savingText = pair.savedBytes > 0
    ? `절감 ${formatBytes(pair.savedBytes)}`
    : pair.savedBytes < 0
      ? `+${formatBytes(Math.abs(pair.savedBytes))}`
      : "변경됨";
  const tier = psnrTier(pair.psnrDb);
  const psnrText = formatPsnr(pair.psnrDb);
  const psnrBadge = `<span class="badge psnr-${escapeHtml(tier)}" title="PSNR ${escapeHtml(psnrText)}">PSNR ${escapeHtml(psnrText)} · ${escapeHtml(psnrTierLabel(tier))}</span>`;
  return [
    `<div class="pair">`,
    `<header><strong>${escapeHtml(pair.originalPath)} → ${escapeHtml(pair.outputPath)}</strong>`,
    `<span class="meta">${psnrBadge}<span class="saving">${escapeHtml(savingText)}</span></span></header>`,
    `<figure><img alt="원본 ${escapeHtml(pair.originalPath)}" src="${escapeHtml(pair.originalThumbnailDataUrl)}" />`,
    `<figcaption>원본 · ${escapeHtml(pair.originalFormat.toUpperCase())} · ${escapeHtml(formatBytes(pair.originalSize))}</figcaption></figure>`,
    `<figure><img alt="결과 ${escapeHtml(pair.outputPath)}" src="${escapeHtml(pair.outputThumbnailDataUrl)}" />`,
    `<figcaption>결과 · ${escapeHtml(pair.outputFormat.toUpperCase())} · ${escapeHtml(formatBytes(pair.outputSize))}</figcaption></figure>`,
    `</div>`
  ].join("");
}
