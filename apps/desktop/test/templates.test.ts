import { describe, expect, it } from "vitest";
import {
  actionToggleHtml,
  batchItemRowActionsHtml,
  batchItemRowHtml,
  categoryBarHtml,
  imageComparePairHtml,
  metricHtml,
  riskBadgeHtml,
  visualImpactBadgeHtml
} from "../src/shared/templates.js";
import type { ActionToggleViewModel, CategorySlice } from "../src/shared/viewModel.js";
import type { BatchItemLike } from "../src/shared/batchView.js";
import type { ImagePreviewPair } from "@hwpx-optimizer/core";

describe("template HTML builders", () => {
  it("escapes dangerous characters in metric labels and values", () => {
    expect(metricHtml("<title>", "10 MiB")).toBe(
      '<div class="metric"><span>&lt;title&gt;</span><strong>10 MiB</strong></div>'
    );
  });

  it("formats a category bar with percent and bytes", () => {
    const slice: CategorySlice = { kind: "image", bytes: 2_097_152, ratio: 0.5, label: "이미지" };
    const html = categoryBarHtml(slice);
    expect(html).toContain('class="bar kind-image"');
    expect(html).toContain('class="name"');
    expect(html).toContain('class="track"');
    expect(html).toContain('class="value"');
    expect(html).toContain('width:50.0%');
    expect(html).toContain("이미지");
    expect(html).toContain("2.00 MiB");
    expect(html).toContain("(50.0%)");
  });

  it("renders risk and visual impact badges keyed by level", () => {
    expect(riskBadgeHtml("safe")).toBe('<span class="badge risk-safe">안전</span>');
    expect(riskBadgeHtml("medium")).toBe('<span class="badge risk-medium">주의</span>');
    expect(visualImpactBadgeHtml("none")).toBe('<span class="badge impact-none">외형 영향 없음</span>');
    expect(visualImpactBadgeHtml("high")).toBe('<span class="badge impact-high">외형 영향 큼</span>');
  });

  it("marks action toggles checked when requested and includes count plus saving", () => {
    const toggle: ActionToggleViewModel = {
      action: "resize-jpeg",
      label: "큰 JPEG 리사이즈",
      count: 4,
      savingLabel: "1.20 MiB",
      risk: "medium",
      visualImpact: "medium",
      defaultEnabledIn: ["balanced", "aggressive"],
      defaultEnabledForMode: true
    };
    const html = actionToggleHtml(toggle, true);
    expect(html).toContain('value="resize-jpeg"');
    expect(html).toContain("checked");
    expect(html).toContain("큰 JPEG 리사이즈");
    expect(html).toContain("4개 · 예상 절감 1.20 MiB");
    expect(html).toContain('class="badge risk-medium"');

    const unchecked = actionToggleHtml(toggle, false);
    expect(unchecked).not.toContain(" checked");
  });

  it("creates batch item rows with status-appropriate action buttons", () => {
    const completed: BatchItemLike = {
      path: "/x/a.hwpx",
      fileName: "a.hwpx",
      status: "done",
      outputPath: "/x/a.optimized.hwpx",
      reportPath: "/x/a.optimized.hwpx.report.json",
      savedBytes: 4096,
      savedPercent: 12.5
    };
    const html = batchItemRowHtml(completed, 0, { running: false });
    expect(html).toContain("a.hwpx");
    expect(html).toContain('class="batch-status-cell"');
    expect(html).toContain('class="status-line"');
    expect(html).toContain('class="status done"');
    expect(html).toContain("완료");
    expect(html).toContain("절감 4.0 KiB (12.50%)");
    expect(html).toContain('data-action="open-file"');
    expect(html).toContain('data-action="show-folder"');
    expect(html).toContain('data-action="open-report"');
    expect(html).not.toContain('data-action="remove"');

    const pending: BatchItemLike = { path: "/x/b.hwpx", fileName: "b.hwpx", status: "pending" };
    const idleHtml = batchItemRowActionsHtml(pending, 1, { running: false });
    expect(idleHtml).toContain('data-action="remove"');

    const busyHtml = batchItemRowActionsHtml(pending, 1, { running: true });
    expect(busyHtml).toBe("");
  });

  it("renders a per-row selection checkbox that reflects the item's selected state", () => {
    const selected: BatchItemLike = { path: "/x/a.hwpx", fileName: "a.hwpx", status: "pending", selected: true };
    const unselected: BatchItemLike = { path: "/x/b.hwpx", fileName: "b.hwpx", status: "pending", selected: false };

    const selectedHtml = batchItemRowHtml(selected, 3, { running: false });
    expect(selectedHtml).toContain('class="batch-select"');
    expect(selectedHtml).toContain('data-batch-index="3"');
    expect(selectedHtml).toContain("checked");

    const unselectedHtml = batchItemRowHtml(unselected, 4, { running: false });
    expect(unselectedHtml).toContain('data-batch-index="4"');
    expect(unselectedHtml).not.toContain("checked");

    // While a batch is running the checkbox is disabled to prevent mid-run edits.
    expect(batchItemRowHtml(selected, 0, { running: true })).toContain("disabled");
  });

  it("renders pending batch rows with target criteria and pass or warning badges", () => {
    const passing: BatchItemLike = {
      path: "/x/report.hwpx",
      fileName: "report.hwpx",
      status: "pending",
      originalSizeLabel: "89.72 MiB",
      expectedSizeLabel: "6.89 MiB",
      targetLabel: "20MB",
      targetStatusLabel: "목표 달성 가능"
    };
    const warning: BatchItemLike = {
      ...passing,
      targetStatusLabel: "목표 미달 가능"
    };

    expect(batchItemRowHtml(passing, 0, { running: false })).toContain('<span class="status pass">통과</span>');
    expect(batchItemRowHtml(passing, 0, { running: false })).toContain("<td>20MB</td>");
    expect(batchItemRowHtml(warning, 0, { running: false })).toContain('<span class="status warning">주의</span>');
  });

  it("renders an image compare pair with PSNR badge and saving info", () => {
    const pair: ImagePreviewPair = {
      originalPath: "BinData/image1.jpg",
      outputPath: "BinData/image1.jpg",
      originalSize: 524288,
      outputSize: 131072,
      savedBytes: 524288 - 131072,
      originalFormat: "jpeg",
      outputFormat: "jpeg",
      originalThumbnailDataUrl: "data:image/jpeg;base64,AAA",
      outputThumbnailDataUrl: "data:image/jpeg;base64,BBB",
      psnrDb: 38.42
    };
    const html = imageComparePairHtml(pair);
    expect(html).toContain("BinData/image1.jpg → BinData/image1.jpg");
    expect(html).toContain("절감 384.0 KiB");
    expect(html).toContain('class="badge psnr-good"');
    expect(html).toContain("PSNR 38.42 dB");
    expect(html).toContain("좋음");
    expect(html).toContain("data:image/jpeg;base64,AAA");
    expect(html).toContain("JPEG");
  });

  it("falls back to '측정 불가' for null PSNR values", () => {
    const pair: ImagePreviewPair = {
      originalPath: "BinData/image1.png",
      outputPath: "BinData/image1.png",
      originalSize: 100,
      outputSize: 80,
      savedBytes: 20,
      originalFormat: "png",
      outputFormat: "png",
      originalThumbnailDataUrl: "data:image/jpeg;base64,A",
      outputThumbnailDataUrl: "data:image/jpeg;base64,B",
      psnrDb: null
    };
    const html = imageComparePairHtml(pair);
    expect(html).toContain('class="badge psnr-unknown"');
    expect(html).toContain("측정 불가");
  });
});
