# HWPX Optimizer Submission UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved submission-focused desktop UI with `제출 제한`, `보존 기준`, generated optimization plans, and separate single-file and batch flows.

**Architecture:** Keep the optimization engine unchanged. Add renderer-side planning view models that map submission limits and preservation preferences onto existing optimization modes and action toggles, then redesign the Electron HTML/CSS/renderer around those view models. Batch mode reuses existing multi-file selection and optimization APIs, but analyzes files before running so each row can show expected size and target status.

**Tech Stack:** Electron, TypeScript ESM, existing DOM renderer, Vitest, existing desktop smoke harness.

---

## File Structure

- Create `apps/desktop/src/shared/submissionPlan.ts`
  - Owns submission limit types, preservation preference types, automatic/custom plan state, action display labels, expected output calculations, and target-status labels.
- Create `apps/desktop/test/submissionPlan.test.ts`
  - Tests target-status calculation, preservation mapping, custom action behavior, and action row savings.
- Modify `apps/desktop/src/shared/viewModel.ts`
  - Reuse `formatBytes`; keep existing analysis view model working for regression coverage.
- Modify `apps/desktop/src/shared/templates.ts`
  - Add HTML helpers for plan action rows, verification items, and batch rows with target status.
- Modify `apps/desktop/src/shared/batchView.ts`
  - Extend batch item shape to carry optional analysis report and target prediction.
- Modify `apps/desktop/src/index.html`
  - Replace dashboard-heavy sections with the accepted two-column submission layout and batch layout containers.
- Modify `apps/desktop/src/styles.css`
  - Implement compact utility visual system, right sidebar, target controls, plan rows, batch table rows, and completion strips.
- Modify `apps/desktop/src/renderer.ts`
  - Add submission settings state, plan recalculation, custom-plan transitions, batch pre-analysis, and updated result actions.
- Modify `apps/desktop/src/main/desktopService.ts`
  - Add persisted settings fields for submission limit and preservation preference.
- Modify `apps/desktop/src/main.ts`
  - Update smoke assertions for new title, start view, and submission controls.
- Modify `apps/desktop/test/viewModel.test.ts`
  - Keep existing analysis tests and add coverage for any reused helper behavior if needed.

## Data Model Decisions

Use these exact values:

```ts
export type SubmissionLimitId = "none" | "mb10" | "mb20" | "mb50" | "custom";
export type PreservationPreference = "preserve" | "recommended" | "size";
export type PlanStatus = "target-met" | "target-missed" | "already-under-target" | "no-target";
export type PlanKind = "automatic" | "custom";
```

Map preservation preference to existing core mode:

```ts
export function modeForPreservation(preference: PreservationPreference): OptimizationMode {
  if (preference === "preserve") return "safe";
  if (preference === "size") return "aggressive";
  return "balanced";
}
```

Default visible labels:

```ts
export const SUBMISSION_LIMIT_LABELS: Record<SubmissionLimitId, string> = {
  none: "제한 없음",
  mb10: "10 MB 이하",
  mb20: "20 MB 이하",
  mb50: "50 MB 이하",
  custom: "직접 입력"
};

export const PRESERVATION_LABELS: Record<PreservationPreference, string> = {
  preserve: "외형 보존 우선",
  recommended: "권장",
  size: "용량 우선"
};
```

## Task 1: Submission Plan View Model

**Files:**
- Create: `apps/desktop/src/shared/submissionPlan.ts`
- Create: `apps/desktop/test/submissionPlan.test.ts`

- [ ] **Step 1: Write failing tests for submission plan calculation**

Create `apps/desktop/test/submissionPlan.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { OptimizationReport } from "@hwpx-optimizer/core";
import {
  createSubmissionPlan,
  modeForPreservation,
  resolveSubmissionLimitBytes
} from "../src/shared/submissionPlan.js";

describe("submission plan view model", () => {
  it("maps preservation preference to existing optimization mode", () => {
    expect(modeForPreservation("preserve")).toBe("safe");
    expect(modeForPreservation("recommended")).toBe("balanced");
    expect(modeForPreservation("size")).toBe("aggressive");
  });

  it("resolves preset and custom submission limits", () => {
    expect(resolveSubmissionLimitBytes({ id: "none" })).toBeUndefined();
    expect(resolveSubmissionLimitBytes({ id: "mb10" })).toBe(10 * 1024 * 1024);
    expect(resolveSubmissionLimitBytes({ id: "mb20" })).toBe(20 * 1024 * 1024);
    expect(resolveSubmissionLimitBytes({ id: "mb50" })).toBe(50 * 1024 * 1024);
    expect(resolveSubmissionLimitBytes({ id: "custom", customBytes: 12_345 })).toBe(12_345);
  });

  it("creates an automatic plan with expected size and target status", () => {
    const plan = createSubmissionPlan(reportFixture, {
      submissionLimit: { id: "mb20" },
      preservationPreference: "recommended",
      actionOverrides: new Map()
    });

    expect(plan.kind).toBe("automatic");
    expect(plan.mode).toBe("balanced");
    expect(plan.expectedSavingLabel).toBe("11.00 MiB");
    expect(plan.expectedSizeLabel).toBe("17.00 MiB");
    expect(plan.targetStatus).toBe("target-met");
    expect(plan.targetStatusLabel).toBe("목표 달성 가능");
    expect(plan.actionRows.map((row) => [row.action, row.checked, row.savingLabel])).toEqual([
      ["resize-jpeg", true, "8.00 MiB"],
      ["consolidate-duplicate-images", true, "3.00 MiB"],
      ["strip-metadata", true, "500.0 KiB"],
      ["clean-shape-comment", true, "500.0 KiB"]
    ]);
  });

  it("switches to custom plan when an action override differs from the preset", () => {
    const plan = createSubmissionPlan(reportFixture, {
      submissionLimit: { id: "mb10" },
      preservationPreference: "recommended",
      actionOverrides: new Map([["resize-jpeg", false]])
    });

    expect(plan.kind).toBe("custom");
    expect(plan.selectedActions).toEqual(["consolidate-duplicate-images", "strip-metadata", "clean-shape-comment"]);
    expect(plan.expectedSizeLabel).toBe("25.00 MiB");
    expect(plan.targetStatus).toBe("target-missed");
    expect(plan.targetStatusLabel).toBe("목표 미달 가능");
  });

  it("marks files already under the target", () => {
    const plan = createSubmissionPlan({ ...reportFixture, originalSize: 8 * 1024 * 1024 }, {
      submissionLimit: { id: "mb20" },
      preservationPreference: "recommended",
      actionOverrides: new Map()
    });

    expect(plan.targetStatus).toBe("already-under-target");
    expect(plan.targetStatusLabel).toBe("이미 목표 이하");
  });
});

const reportFixture: OptimizationReport = {
  originalSize: 28 * 1024 * 1024,
  categorySizes: { xml: 100, image: 200, font: 0, ole: 0, bindata: 0, other: 0 },
  images: [],
  duplicateImages: [],
  sameVisualDuplicateImages: [],
  unusedBinData: [],
  riskyResources: [],
  actions: { planned: [], applied: [], skipped: [] },
  opportunities: [],
  opportunityGroups: [
    {
      action: "resize-jpeg",
      label: "Resize",
      count: 4,
      estimatedSavingBytes: 8 * 1024 * 1024,
      beforeSize: 12,
      afterSize: 4,
      confidence: "exact",
      risk: "medium",
      visualImpact: "medium",
      defaultEnabledIn: ["balanced", "aggressive"],
      targets: ["a", "b", "c", "d"]
    },
    {
      action: "consolidate-duplicate-images",
      label: "Duplicates",
      count: 2,
      estimatedSavingBytes: 3 * 1024 * 1024,
      beforeSize: 6,
      afterSize: 3,
      confidence: "exact",
      risk: "medium",
      visualImpact: "none",
      defaultEnabledIn: ["balanced", "aggressive"],
      targets: ["e", "f"]
    },
    {
      action: "strip-metadata",
      label: "Metadata",
      count: 2,
      estimatedSavingBytes: 500 * 1024,
      beforeSize: 2,
      afterSize: 1,
      confidence: "exact",
      risk: "safe",
      visualImpact: "none",
      defaultEnabledIn: ["balanced", "aggressive"],
      targets: ["g", "h"]
    },
    {
      action: "clean-shape-comment",
      label: "Shape comments",
      count: 1,
      estimatedSavingBytes: 500 * 1024,
      beforeSize: 2,
      afterSize: 1,
      confidence: "exact",
      risk: "safe",
      visualImpact: "none",
      defaultEnabledIn: ["balanced", "aggressive"],
      targets: ["i"]
    }
  ],
  warnings: []
};
```

- [ ] **Step 2: Run the new test to verify it fails**

Run:

```bash
npm test -- apps/desktop/test/submissionPlan.test.ts
```

Expected: FAIL because `apps/desktop/src/shared/submissionPlan.ts` does not exist.

- [ ] **Step 3: Implement submission plan view model**

Create `apps/desktop/src/shared/submissionPlan.ts`:

```ts
import type { OptimizationOpportunityGroup, OptimizationReport } from "@hwpx-optimizer/core";
import { createActionToggles, formatBytes } from "./viewModel.js";
import type { OptimizationMode } from "./viewModel.js";

export type SubmissionLimitId = "none" | "mb10" | "mb20" | "mb50" | "custom";
export type PreservationPreference = "preserve" | "recommended" | "size";
export type PlanStatus = "target-met" | "target-missed" | "already-under-target" | "no-target";
export type PlanKind = "automatic" | "custom";

export type SubmissionLimit = {
  id: SubmissionLimitId;
  customBytes?: number;
};

export type SubmissionPlanInput = {
  submissionLimit: SubmissionLimit;
  preservationPreference: PreservationPreference;
  actionOverrides: Map<string, boolean>;
};

export type SubmissionActionRow = {
  action: OptimizationOpportunityGroup["action"];
  label: string;
  count: number;
  checked: boolean;
  savingBytes: number;
  savingLabel: string;
  risk: OptimizationOpportunityGroup["risk"];
  visualImpact: OptimizationOpportunityGroup["visualImpact"];
};

export type SubmissionPlan = {
  kind: PlanKind;
  mode: OptimizationMode;
  originalSizeLabel: string;
  expectedSavingBytes: number;
  expectedSavingLabel: string;
  expectedSizeBytes: number;
  expectedSizeLabel: string;
  savedPercentLabel: string;
  targetBytes?: number;
  targetLabel: string;
  targetStatus: PlanStatus;
  targetStatusLabel: string;
  selectedActions: string[];
  actionRows: SubmissionActionRow[];
};

export const SUBMISSION_LIMIT_LABELS: Record<SubmissionLimitId, string> = {
  none: "제한 없음",
  mb10: "10 MB 이하",
  mb20: "20 MB 이하",
  mb50: "50 MB 이하",
  custom: "직접 입력"
};

export const PRESERVATION_LABELS: Record<PreservationPreference, string> = {
  preserve: "외형 보존 우선",
  recommended: "권장",
  size: "용량 우선"
};

const ACTION_DISPLAY_LABELS: Partial<Record<OptimizationOpportunityGroup["action"], string>> = {
  "resize-jpeg": "큰 이미지 적정 크기로 줄이기",
  "resize-png": "큰 이미지 적정 크기로 줄이기",
  "convert-bmp-to-png": "큰 이미지 적정 크기로 줄이기",
  "convert-tiff-to-png": "큰 이미지 적정 크기로 줄이기",
  "consolidate-duplicate-images": "중복 이미지 정리",
  "strip-metadata": "이미지 불필요 정보 제거",
  "optimize-png": "이미지 불필요 정보 제거",
  "clean-shape-comment": "개인정보 흔적 정리"
};

export function modeForPreservation(preference: PreservationPreference): OptimizationMode {
  if (preference === "preserve") return "safe";
  if (preference === "size") return "aggressive";
  return "balanced";
}

export function resolveSubmissionLimitBytes(limit: SubmissionLimit): number | undefined {
  if (limit.id === "mb10") return 10 * 1024 * 1024;
  if (limit.id === "mb20") return 20 * 1024 * 1024;
  if (limit.id === "mb50") return 50 * 1024 * 1024;
  if (limit.id === "custom" && limit.customBytes && limit.customBytes > 0) return limit.customBytes;
  return undefined;
}

export function createSubmissionPlan(report: OptimizationReport, input: SubmissionPlanInput): SubmissionPlan {
  const mode = modeForPreservation(input.preservationPreference);
  const toggles = createActionToggles(report, mode);
  const savingByAction = new Map(report.opportunityGroups.map((group) => [group.action, group.estimatedSavingBytes]));
  const actionRows = toggles.map((toggle) => {
    const override = input.actionOverrides.get(toggle.action);
    const checked = override ?? toggle.defaultEnabledForMode;
    const savingBytes = savingByAction.get(toggle.action) ?? 0;
    return {
      action: toggle.action,
      label: ACTION_DISPLAY_LABELS[toggle.action] ?? toggle.label,
      count: toggle.count,
      checked,
      savingBytes,
      savingLabel: formatBytes(savingBytes),
      risk: toggle.risk,
      visualImpact: toggle.visualImpact
    };
  });
  const changed = actionRows.some((row) => input.actionOverrides.has(row.action));
  const expectedSavingBytes = actionRows.reduce((sum, row) => row.checked ? sum + row.savingBytes : sum, 0);
  const expectedSizeBytes = Math.max(0, report.originalSize - expectedSavingBytes);
  const targetBytes = resolveSubmissionLimitBytes(input.submissionLimit);
  const savedPercent = report.originalSize > 0 ? (expectedSavingBytes / report.originalSize) * 100 : 0;
  const targetStatus = targetStatusFor(report.originalSize, expectedSizeBytes, targetBytes);
  return {
    kind: changed ? "custom" : "automatic",
    mode,
    originalSizeLabel: formatBytes(report.originalSize),
    expectedSavingBytes,
    expectedSavingLabel: formatBytes(expectedSavingBytes),
    expectedSizeBytes,
    expectedSizeLabel: formatBytes(expectedSizeBytes),
    savedPercentLabel: `약 ${Math.round(savedPercent)}% 감소`,
    targetBytes,
    targetLabel: targetBytes ? `${formatBytes(targetBytes)} 이하` : "제한 없음",
    targetStatus,
    targetStatusLabel: targetStatusLabel(targetStatus),
    selectedActions: actionRows.filter((row) => row.checked).map((row) => row.action),
    actionRows
  };
}

function targetStatusFor(originalSize: number, expectedSize: number, targetBytes: number | undefined): PlanStatus {
  if (!targetBytes) return "no-target";
  if (originalSize <= targetBytes) return "already-under-target";
  return expectedSize <= targetBytes ? "target-met" : "target-missed";
}

function targetStatusLabel(status: PlanStatus): string {
  if (status === "target-met") return "목표 달성 가능";
  if (status === "target-missed") return "목표 미달 가능";
  if (status === "already-under-target") return "이미 목표 이하";
  return "목표 제한 없음";
}
```

- [ ] **Step 4: Run the task test**

Run:

```bash
npm test -- apps/desktop/test/submissionPlan.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add apps/desktop/src/shared/submissionPlan.ts apps/desktop/test/submissionPlan.test.ts
git commit -m "feat: add submission optimization plan view model"
```

## Task 2: Persist Submission Preferences

**Files:**
- Modify: `apps/desktop/src/main/desktopService.ts`
- Modify: `apps/desktop/src/renderer.ts`
- Test: `apps/desktop/test/desktopService.test.ts`

- [ ] **Step 1: Add failing settings test**

In `apps/desktop/test/desktopService.test.ts`, add this import:

```ts
import type { DesktopSettings } from "../src/main/desktopService.js";
```

Add this test inside the existing `describe("desktop service", () => { ... })` block:

```ts
  it("defines submission UI defaults in desktop settings", () => {
    const settings: DesktopSettings = defaultDesktopSettings;

    expect(settings.submissionLimit).toEqual({ id: "mb20" });
    expect(settings.preservationPreference).toBe("recommended");
  });
```

- [ ] **Step 2: Run the settings test to verify it fails**

Run:

```bash
npm test -- apps/desktop/test/desktopService.test.ts -t "submission UI defaults"
```

Expected: FAIL because `submissionLimit` and `preservationPreference` are missing.

- [ ] **Step 3: Extend desktop settings types**

Modify `apps/desktop/src/main/desktopService.ts` imports and types:

```ts
import type { ImagePreviewPair, OptimizationReport } from "@hwpx-optimizer/core";
import type { PreservationPreference, SubmissionLimit } from "../shared/submissionPlan.js";
```

Update `DesktopSettings`:

```ts
export type DesktopSettings = {
  defaultMode: OptimizationMode;
  saveNextToOriginal: boolean;
  saveReport: boolean;
  preventOverwrite: boolean;
  showAggressiveWarning: boolean;
  submissionLimit: SubmissionLimit;
  preservationPreference: PreservationPreference;
  outputDirectory?: string;
};
```

Update `defaultDesktopSettings`:

```ts
export const defaultDesktopSettings: DesktopSettings = {
  defaultMode: "safe",
  saveNextToOriginal: true,
  saveReport: true,
  preventOverwrite: true,
  showAggressiveWarning: true,
  submissionLimit: { id: "mb20" },
  preservationPreference: "recommended"
};
```

- [ ] **Step 4: Update renderer settings type**

In `apps/desktop/src/renderer.ts`, import the shared types:

```ts
import type { PreservationPreference, SubmissionLimit } from "./shared/submissionPlan.js";
```

Extend the local `DesktopSettings` type:

```ts
type DesktopSettings = {
  defaultMode: AppState["mode"];
  saveNextToOriginal: boolean;
  saveReport: boolean;
  preventOverwrite: boolean;
  showAggressiveWarning: boolean;
  submissionLimit: SubmissionLimit;
  preservationPreference: PreservationPreference;
  outputDirectory?: string;
};
```

- [ ] **Step 5: Run the settings test**

Run:

```bash
npm test -- apps/desktop/test/desktopService.test.ts -t "submission UI defaults"
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add apps/desktop/src/main/desktopService.ts apps/desktop/src/renderer.ts apps/desktop/test/desktopService.test.ts
git commit -m "feat: persist submission optimization preferences"
```

## Task 3: Redesign Static HTML Structure

**Files:**
- Modify: `apps/desktop/src/index.html`
- Modify: `apps/desktop/src/main.ts`

- [ ] **Step 1: Update smoke expectations first**

In `apps/desktop/src/main.ts`, update the initial title and start-view checks:

```ts
  if (result.title !== "HWPX 보고서 최적화") {
    throw new Error(`Desktop smoke failed: unexpected title ${String(result.title)}`);
  }
  if (result.fileName !== "HWPX 보고서를 선택하세요") {
    throw new Error(`Desktop smoke failed: renderer did not load expected start view`);
  }
```

Also update `createWindow()` title:

```ts
    title: "HWPX 보고서 최적화",
```

- [ ] **Step 2: Run smoke to verify it fails before HTML changes**

Run:

```bash
npm run desktop:smoke
```

Expected: FAIL with unexpected title or start-view text.

- [ ] **Step 3: Replace document title and topbar copy**

In `apps/desktop/src/index.html`, change:

```html
<title>HWPX 보고서 최적화</title>
```

Replace the topbar title/status block with:

```html
<div>
  <h1>HWPX 보고서 최적화</h1>
  <p id="status-text">원본은 그대로, 내 컴퓨터에서만 처리합니다.</p>
</div>
<button id="settings-button" class="icon-button ghost" title="설정" aria-label="설정">⚙</button>
```

- [ ] **Step 4: Replace single-file body sections**

In `apps/desktop/src/index.html`, replace the existing drop-zone, analysis panel, modes panel, two-column panel, and action panel with this structure while keeping existing result, progress, compare modal, and settings aside below it:

```html
<section id="single-workspace" class="workspace-grid">
  <div class="workspace-main">
    <section id="drop-zone" class="file-summary">
      <div class="file-heading">
        <div>
          <h2 id="file-name">HWPX 보고서를 선택하세요</h2>
          <p id="file-meta">파일을 끌어다 놓거나 선택하면 제출 제한에 맞는 최적화 계획을 만듭니다.</p>
        </div>
        <div class="file-actions">
          <button id="choose-button" type="button">파일 선택</button>
          <button id="choose-many-button" type="button" class="ghost">여러 파일</button>
          <button id="choose-folder-button" type="button" class="ghost">폴더</button>
        </div>
      </div>
      <div id="prediction-summary" class="prediction-summary" hidden>
        <span id="prediction-size">분석 전</span>
        <strong id="prediction-status">파일을 선택하세요</strong>
        <span id="prediction-percent">원본 보존</span>
      </div>
    </section>

    <section class="submission-controls">
      <label>
        제출 제한
        <select id="submission-limit-select">
          <option value="none">제한 없음</option>
          <option value="mb10">10 MB 이하</option>
          <option value="mb20">20 MB 이하</option>
          <option value="mb50">50 MB 이하</option>
          <option value="custom">직접 입력</option>
        </select>
      </label>
      <label id="custom-limit-field" hidden>
        직접 입력
        <input id="custom-limit-input" type="number" min="1" step="1" inputmode="decimal" />
      </label>
      <label>
        보존 기준
        <select id="preservation-select">
          <option value="preserve">외형 보존 우선</option>
          <option value="recommended">권장</option>
          <option value="size">용량 우선</option>
        </select>
      </label>
    </section>

    <section class="primary-run-panel">
      <button id="optimize-button" type="button" disabled>목표에 맞게 줄이기</button>
      <button id="analyze-button" type="button" class="ghost" disabled>다시 분석</button>
      <button id="output-button" type="button" class="ghost">저장 위치</button>
      <p>원본은 변경하지 않고, 결과 파일은 새 이름으로 저장합니다.</p>
    </section>

    <details id="analysis-details" class="analysis-details">
      <summary id="analysis-detail-summary">세부 분석 보기</summary>
      <div id="analysis-grid" class="metric-grid"></div>
      <div id="category-chart" class="category-chart" hidden></div>
      <div class="two-column compact">
        <div>
          <h2>줄일 수 있는 항목</h2>
          <ul id="opportunity-list" class="list"></ul>
        </div>
        <div>
          <h2>주의할 점</h2>
          <ul id="warning-list" class="list"></ul>
        </div>
      </div>
    </details>

    <section class="verification-strip">
      <strong>최적화 후 자동 확인</strong>
      <span>문서 구조 확인</span>
      <span>누락 리소스 확인</span>
      <span>이미지 품질 기준 확인</span>
    </section>
  </div>

  <aside id="plan-sidebar" class="plan-sidebar">
    <div class="panel-header">
      <div>
        <h2 id="plan-title">자동 최적화 계획</h2>
        <p id="plan-summary">파일을 분석하면 예상 절감량을 표시합니다.</p>
      </div>
    </div>
    <div id="plan-total" class="plan-total">예상 절감 0 B</div>
    <ul id="action-checkboxes" class="action-list plan-actions"></ul>
    <p id="action-panel-hint">옵션을 바꾸면 사용자 지정 계획으로 전환됩니다.</p>
  </aside>
</section>
```

- [ ] **Step 5: Wrap batch panel as separate workspace**

Keep the existing `batch-panel` ids, but move the section after `single-workspace` and give it the class:

```html
<section id="batch-panel" class="workspace-grid batch-workspace" hidden>
```

Inside the batch panel, keep these ids for renderer compatibility:

```html
<p id="batch-summary">파일을 추가하면 진행 상태가 여기에 표시됩니다.</p>
<button id="batch-clear" class="ghost" type="button">목록 비우기</button>
<button id="batch-run" type="button" disabled>일괄 최적화</button>
<ul id="batch-list" class="batch-list"></ul>
```

- [ ] **Step 6: Run smoke**

Run:

```bash
npm run desktop:smoke
```

Expected: PASS after renderer ids are still present. If it fails because new controls are not wired, continue to Task 4 before fixing smoke.

- [ ] **Step 7: Commit Task 3**

Run after smoke is passing or after recording that Task 4 is required to pass smoke:

```bash
git add apps/desktop/src/index.html apps/desktop/src/main.ts
git commit -m "refactor: restructure desktop submission workspace"
```

## Task 4: Wire Renderer Plan State

**Files:**
- Modify: `apps/desktop/src/renderer.ts`
- Modify: `apps/desktop/src/shared/templates.ts`
- Test: `apps/desktop/test/submissionPlan.test.ts`

- [ ] **Step 1: Add plan row template**

In `apps/desktop/src/shared/templates.ts`, import the plan row type:

```ts
import type { SubmissionActionRow } from "./submissionPlan.js";
```

Add this function:

```ts
export function submissionActionRowHtml(row: SubmissionActionRow): string {
  const checkedAttr = row.checked ? " checked" : "";
  return `<li class="plan-action-row"><label><input type="checkbox" value="${escapeHtml(row.action)}"${checkedAttr} /><span class="action-text"><strong>${escapeHtml(row.label)}</strong><em>${row.count}개 작업</em></span><strong class="saving">${escapeHtml(row.savingLabel)}</strong></label></li>`;
}
```

- [ ] **Step 2: Add renderer imports and state fields**

In `apps/desktop/src/renderer.ts`, update imports:

```ts
import { createSubmissionPlan } from "./shared/submissionPlan.js";
import type { PreservationPreference, SubmissionLimit, SubmissionPlan } from "./shared/submissionPlan.js";
import { submissionActionRowHtml } from "./shared/templates.js";
```

Extend `AppState`:

```ts
  submissionLimit: SubmissionLimit;
  preservationPreference: PreservationPreference;
  currentPlan?: SubmissionPlan;
```

Initialize `state`:

```ts
  submissionLimit: { id: "mb20" },
  preservationPreference: "recommended",
```

- [ ] **Step 3: Add DOM references**

In `apps/desktop/src/renderer.ts`, add these constants near existing `requireElement` calls:

```ts
const singleWorkspace = requireElement("single-workspace");
const predictionSummary = requireElement("prediction-summary");
const predictionSize = requireElement("prediction-size");
const predictionStatus = requireElement("prediction-status");
const predictionPercent = requireElement("prediction-percent");
const submissionLimitSelect = requireSelect("submission-limit-select");
const customLimitField = requireElement("custom-limit-field");
const customLimitInput = requireInput("custom-limit-input");
const preservationSelect = requireSelect("preservation-select");
const planTitle = requireElement("plan-title");
const planSummary = requireElement("plan-summary");
const planTotal = requireElement("plan-total");
const analysisDetailSummary = requireElement("analysis-detail-summary");
```

- [ ] **Step 4: Load and save submission settings**

In `init()`, after settings are loaded, add:

```ts
  state.submissionLimit = settings.submissionLimit ?? { id: "mb20" };
  state.preservationPreference = settings.preservationPreference ?? "recommended";
  renderSubmissionControls();
```

Add event listeners:

```ts
  submissionLimitSelect.addEventListener("change", () => {
    state.submissionLimit = {
      id: submissionLimitSelect.value as SubmissionLimit["id"],
      customBytes: state.submissionLimit.customBytes
    };
    renderSubmissionControls();
    refreshSubmissionPlan();
    void saveSettings({ submissionLimit: state.submissionLimit });
  });
  customLimitInput.addEventListener("change", () => {
    const value = Number(customLimitInput.value);
    state.submissionLimit = {
      id: "custom",
      customBytes: Number.isFinite(value) && value > 0 ? value * 1024 * 1024 : undefined
    };
    refreshSubmissionPlan();
    void saveSettings({ submissionLimit: state.submissionLimit });
  });
  preservationSelect.addEventListener("change", () => {
    state.preservationPreference = preservationSelect.value as PreservationPreference;
    state.actionSelections.clear();
    renderSubmissionControls();
    refreshSubmissionPlan();
    void saveSettings({ preservationPreference: state.preservationPreference });
  });
```

- [ ] **Step 5: Implement render helpers**

Add these functions:

```ts
function renderSubmissionControls(): void {
  submissionLimitSelect.value = state.submissionLimit.id;
  customLimitField.hidden = state.submissionLimit.id !== "custom";
  customLimitInput.value = state.submissionLimit.customBytes
    ? String(Math.round(state.submissionLimit.customBytes / 1024 / 1024))
    : "";
  preservationSelect.value = state.preservationPreference;
}

function refreshSubmissionPlan(): void {
  if (!state.report) {
    state.currentPlan = undefined;
    predictionSummary.hidden = true;
    planTitle.textContent = "자동 최적화 계획";
    planSummary.textContent = "파일을 분석하면 예상 절감량을 표시합니다.";
    planTotal.textContent = "예상 절감 0 B";
    actionCheckboxes.innerHTML = "";
    return;
  }
  const plan = createSubmissionPlan(state.report, {
    submissionLimit: state.submissionLimit,
    preservationPreference: state.preservationPreference,
    actionOverrides: state.actionSelections
  });
  state.currentPlan = plan;
  state.mode = plan.mode;
  predictionSummary.hidden = false;
  predictionSize.textContent = `${plan.originalSizeLabel} → 예상 ${plan.expectedSizeLabel}`;
  predictionStatus.textContent = plan.targetStatusLabel;
  predictionPercent.textContent = plan.savedPercentLabel;
  planTitle.textContent = plan.kind === "custom" ? "사용자 지정 계획" : "자동 최적화 계획";
  planSummary.textContent = `${plan.targetStatusLabel} · 예상 결과 ${plan.expectedSizeLabel}`;
  planTotal.textContent = `예상 절감 ${plan.expectedSavingLabel}`;
  actionCheckboxes.innerHTML = plan.actionRows.map(submissionActionRowHtml).join("");
  optimizeButton.disabled = false;
}
```

- [ ] **Step 6: Replace old action-panel rendering calls**

In `analyzeFile()`, replace:

```ts
    resetActionSelectionsToMode();
    renderAnalysis(response.report);
    renderActionPanel();
    optimizeButton.disabled = false;
```

with:

```ts
    state.actionSelections.clear();
    renderAnalysis(response.report);
    refreshSubmissionPlan();
```

In `selectedActionsForOptimize()`, replace the body with:

```ts
  if (!state.currentPlan || state.currentPlan.mode === "safe") return undefined;
  const selected = state.currentPlan.selectedActions;
  if (selected.length === state.currentPlan.actionRows.length) return undefined;
  return selected;
```

- [ ] **Step 7: Update checkbox change handler**

Replace the existing `actionCheckboxes.addEventListener("change", ...)` body with:

```ts
  const target = event.target as HTMLInputElement | null;
  if (!target || target.type !== "checkbox") return;
  state.actionSelections.set(target.value, target.checked);
  refreshSubmissionPlan();
```

- [ ] **Step 8: Run targeted tests and smoke**

Run:

```bash
npm test -- apps/desktop/test/submissionPlan.test.ts apps/desktop/test/viewModel.test.ts
npm run desktop:smoke
```

Expected: PASS. If smoke fails on missing old `action-panel` ids, remove unused references from `renderer.ts` rather than reintroducing the old panel.

- [ ] **Step 9: Commit Task 4**

Run:

```bash
git add apps/desktop/src/renderer.ts apps/desktop/src/shared/templates.ts
git commit -m "feat: wire submission optimization plan UI"
```

## Task 5: Batch Pre-Analysis and Batch View Model

**Files:**
- Modify: `apps/desktop/src/shared/batchView.ts`
- Modify: `apps/desktop/src/shared/templates.ts`
- Modify: `apps/desktop/src/renderer.ts`
- Test: `apps/desktop/test/batchView.test.ts`

- [ ] **Step 1: Add failing batch view tests**

Create `apps/desktop/test/batchView.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { batchItemMetaText, summarizeBatchItems } from "../src/shared/batchView.js";

describe("batch view model", () => {
  it("summarizes analyzed pending files with expected output", () => {
    const summary = summarizeBatchItems([
      { path: "/a.hwpx", fileName: "a.hwpx", status: "pending", originalSizeLabel: "28.00 MiB", expectedSizeLabel: "16.00 MiB" },
      { path: "/b.hwpx", fileName: "b.hwpx", status: "pending", originalSizeLabel: "54.00 MiB", expectedSizeLabel: "19.00 MiB" }
    ]);

    expect(summary.text).toBe("2개 파일 · 총 82.00 MiB → 예상 35.00 MiB");
  });

  it("renders target status in pending row meta", () => {
    expect(batchItemMetaText({
      path: "/report.hwpx",
      fileName: "report.hwpx",
      status: "pending",
      originalSizeLabel: "61.80 MiB",
      expectedSizeLabel: "27.40 MiB",
      targetStatusLabel: "목표 미달 가능"
    })).toBe("61.80 MiB → 27.40 MiB · 목표 미달 가능");
  });
});
```

- [ ] **Step 2: Run the batch view test to verify it fails**

Run:

```bash
npm test -- apps/desktop/test/batchView.test.ts
```

Expected: FAIL because current `BatchItemLike` lacks expected-size fields.

- [ ] **Step 3: Extend batch item shape**

In `apps/desktop/src/shared/batchView.ts`, extend `BatchItemLike`:

```ts
  originalSizeBytes?: number;
  expectedSizeBytes?: number;
  originalSizeLabel?: string;
  expectedSizeLabel?: string;
  targetStatusLabel?: string;
```

Update `summarizeBatchItems()` to total analyzed pending files:

```ts
  const analyzed = items.filter((item) => item.originalSizeBytes !== undefined && item.expectedSizeBytes !== undefined);
  if (analyzed.length > 0 && counts.done === 0 && counts.failed === 0 && counts.cancelled === 0) {
    const originalTotal = analyzed.reduce((sum, item) => sum + (item.originalSizeBytes ?? 0), 0);
    const expectedTotal = analyzed.reduce((sum, item) => sum + (item.expectedSizeBytes ?? 0), 0);
    return {
      totalCount: items.length,
      counts,
      totalSavedBytes: Math.max(0, originalTotal - expectedTotal),
      text: `${items.length}개 파일 · 총 ${formatBytes(originalTotal)} → 예상 ${formatBytes(expectedTotal)}`
    };
  }
```

Update `batchItemMetaText()` pending case before returning `item.path`:

```ts
  if (item.originalSizeLabel && item.expectedSizeLabel && item.targetStatusLabel) {
    return `${item.originalSizeLabel} → ${item.expectedSizeLabel} · ${item.targetStatusLabel}`;
  }
```

- [ ] **Step 4: Update batch row template**

In `apps/desktop/src/shared/templates.ts`, update `batchItemRowHtml()` class:

```ts
  const attentionClass = item.targetStatusLabel === "목표 미달 가능" ? " needs-attention" : "";
  return `<li class="${attentionClass.trim()}"><span class="name"><strong>${escapeHtml(item.fileName)}</strong><em>${escapeHtml(meta)}</em></span><span class="status ${item.status}">${escapeHtml(batchStatusLabel(item.status))}</span><span class="row-actions">${actions}</span></li>`;
```

- [ ] **Step 5: Add renderer batch analysis**

In `apps/desktop/src/renderer.ts`, extend local `BatchItem` with:

```ts
  report?: OptimizationReport;
  originalSizeBytes?: number;
  expectedSizeBytes?: number;
  originalSizeLabel?: string;
  expectedSizeLabel?: string;
  targetStatusLabel?: string;
```

After `renderBatchList();` in `enterBatchMode()`, add:

```ts
  void analyzeBatchItems();
```

Add this function:

```ts
async function analyzeBatchItems(): Promise<void> {
  for (const item of state.batchItems) {
    if (item.report || item.status !== "pending") continue;
    try {
      const response = await window.hwpxOptimizer.analyze(item.path);
      const plan = createSubmissionPlan(response.report, {
        submissionLimit: state.submissionLimit,
        preservationPreference: state.preservationPreference,
        actionOverrides: state.actionSelections
      });
      item.report = response.report;
      item.originalSizeBytes = response.report.originalSize;
      item.expectedSizeBytes = plan.expectedSizeBytes;
      item.originalSizeLabel = plan.originalSizeLabel;
      item.expectedSizeLabel = plan.expectedSizeLabel;
      item.targetStatusLabel = plan.targetStatusLabel;
      renderBatchList();
    } catch (error) {
      item.status = "failed";
      item.error = errorMessage(error);
      renderBatchList();
    }
  }
}
```

- [ ] **Step 6: Recompute batch predictions when controls change**

At the end of the `submissionLimitSelect`, `customLimitInput`, and `preservationSelect` change handlers, add:

```ts
    refreshBatchPlans();
```

Add:

```ts
function refreshBatchPlans(): void {
  for (const item of state.batchItems) {
    if (!item.report) continue;
    const plan = createSubmissionPlan(item.report, {
      submissionLimit: state.submissionLimit,
      preservationPreference: state.preservationPreference,
      actionOverrides: state.actionSelections
    });
    item.expectedSizeBytes = plan.expectedSizeBytes;
    item.expectedSizeLabel = plan.expectedSizeLabel;
    item.targetStatusLabel = plan.targetStatusLabel;
  }
  renderBatchList();
}
```

- [ ] **Step 7: Run batch tests**

Run:

```bash
npm test -- apps/desktop/test/batchView.test.ts apps/desktop/test/submissionPlan.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 5**

Run:

```bash
git add apps/desktop/src/shared/batchView.ts apps/desktop/src/shared/templates.ts apps/desktop/src/renderer.ts apps/desktop/test/batchView.test.ts
git commit -m "feat: show batch submission optimization plan"
```

## Task 6: Visual System CSS and Responsive Behavior

**Files:**
- Modify: `apps/desktop/src/styles.css`

- [ ] **Step 1: Replace high-level layout CSS**

In `apps/desktop/src/styles.css`, keep existing modal and compare styles, but add these layout rules near the top after `.shell`:

```css
.workspace-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 16px;
  align-items: start;
}

.workspace-main {
  display: grid;
  gap: 14px;
}

.file-summary,
.submission-controls,
.primary-run-panel,
.analysis-details,
.verification-strip,
.plan-sidebar,
.batch-workspace .workspace-main {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}

.file-summary {
  padding: 20px;
  border-style: dashed;
  border-width: 2px;
}

.file-heading {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
}

.file-actions,
.primary-run-panel {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.prediction-summary {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 12px;
  align-items: center;
  margin-top: 16px;
  padding: 12px;
  border-radius: 6px;
  background: #f5f9ff;
}

.prediction-summary strong {
  color: var(--accent-2);
}

.submission-controls {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  padding: 14px;
}

.submission-controls label {
  color: var(--text);
  font-weight: 700;
}

.primary-run-panel {
  padding: 14px;
}

.primary-run-panel #optimize-button {
  min-width: 190px;
  min-height: 48px;
  font-size: 15px;
}

.primary-run-panel p {
  flex-basis: 100%;
}

.plan-sidebar {
  position: sticky;
  top: 18px;
  padding: 18px;
}

.plan-total {
  margin-top: 14px;
  padding: 12px;
  border-radius: 6px;
  background: #eef8f6;
  color: var(--accent-2);
  font-weight: 800;
}

.plan-action-row label {
  grid-template-columns: 22px minmax(0, 1fr) auto;
}

.plan-action-row .saving {
  color: var(--accent-2);
  font-size: 13px;
}

.analysis-details {
  padding: 14px;
}

.analysis-details summary {
  cursor: pointer;
  color: var(--text);
  font-weight: 800;
}

.verification-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding: 12px 14px;
  align-items: center;
}

.verification-strip span {
  color: var(--muted);
  font-size: 13px;
}

.batch-workspace[hidden] {
  display: none;
}

.batch-list li.needs-attention {
  background: rgba(200, 114, 20, 0.12);
  border: 1px solid rgba(200, 114, 20, 0.25);
}
```

- [ ] **Step 2: Add responsive collapse**

Inside the existing `@media (max-width: 980px)` block, add:

```css
  .workspace-grid {
    grid-template-columns: 1fr;
  }

  .plan-sidebar {
    position: static;
  }

  .submission-controls,
  .prediction-summary {
    grid-template-columns: 1fr;
  }
```

- [ ] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Commit Task 6**

Run:

```bash
git add apps/desktop/src/styles.css
git commit -m "refactor: apply lightweight submission UI styling"
```

## Task 7: Result and Verification Copy

**Files:**
- Modify: `apps/desktop/src/renderer.ts`
- Modify: `apps/desktop/src/index.html`
- Modify: `apps/desktop/src/shared/templates.ts`

- [ ] **Step 1: Update result panel button order and copy**

In `apps/desktop/src/index.html`, inside `result-panel`, order actions as:

```html
<button id="open-file-button" class="ghost">파일 열기</button>
<button id="open-folder-button" class="ghost">폴더 보기</button>
<button id="compare-button" class="ghost" disabled>결과 비교</button>
<button id="reverify-button" class="ghost" disabled>다시 검증</button>
<button id="open-report-button" class="ghost" disabled>처리 내역</button>
```

- [ ] **Step 2: Update result copy**

In `renderResult()` in `apps/desktop/src/renderer.ts`, replace:

```ts
  setStatus("최적화가 완료되었습니다. 결과 파일을 확인하세요.");
```

with:

```ts
  setStatus("최적화가 완료되었습니다. 파일을 열어 제출 전 상태를 확인하세요.");
```

Replace `resultSummary.innerHTML` labels with:

```ts
  resultSummary.innerHTML = [
    metricHtml("원본 용량", formatBytes(report.originalSize)),
    metricHtml("결과 용량", formatBytes(report.optimizedSize ?? report.originalSize)),
    metricHtml("실제 절감", formatBytes(report.savedBytes ?? 0)),
    metricHtml("절감률", `${(report.savedPercent ?? 0).toFixed(2)}%`)
  ].join("");
```

- [ ] **Step 3: Run smoke**

Run:

```bash
npm run desktop:smoke
```

Expected: PASS.

- [ ] **Step 4: Commit Task 7**

Run:

```bash
git add apps/desktop/src/index.html apps/desktop/src/renderer.ts apps/desktop/src/shared/templates.ts
git commit -m "refactor: clarify submission result actions"
```

## Task 8: Full Verification and Visual Fidelity Pass

**Files:**
- No planned source changes unless visual comparison finds a concrete mismatch.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
npm test -- apps/desktop/test/submissionPlan.test.ts apps/desktop/test/batchView.test.ts apps/desktop/test/viewModel.test.ts apps/desktop/test/desktopService.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full verification gates**

Run:

```bash
npm test
npm run typecheck
npm run build
npm run desktop:smoke
git diff --check
```

Expected:

- Vitest passes.
- TypeScript passes.
- Build passes.
- Desktop smoke passes.
- `git diff --check` prints no output.

- [ ] **Step 3: Capture implementation screenshot**

Start the app:

```bash
npm run desktop:start
```

Use the in-app browser or an available screenshot tool to capture the default single-file screen and batch screen after selecting multiple HWPX files. Save screenshots under `.tmp/ui-redesign/`:

```text
.tmp/ui-redesign/single-file.png
.tmp/ui-redesign/batch-mode.png
```

- [ ] **Step 4: Inspect accepted concepts and implementation screenshots**

Use `view_image` on:

```text
/home/eunsang26/.codex/generated_images/019e0d90-6e71-7343-b886-300d49e29928/ig_0b4d334a7f50a1aa0169ff6b19f3088191a50b141de42cc511.png
/home/eunsang26/.codex/generated_images/019e0d90-6e71-7343-b886-300d49e29928/ig_0b4d334a7f50a1aa0169ff6c60cc208191bc32c827643bba27.png
/home/eunsang26/projects/hwpx-optimizer/.tmp/ui-redesign/single-file.png
/home/eunsang26/projects/hwpx-optimizer/.tmp/ui-redesign/batch-mode.png
```

Compare at least these five points:

1. topbar copy and hierarchy
2. submission limit and preservation controls
3. result prediction prominence
4. right-sidebar plan density and checkbox rows
5. batch row density and amber attention state
6. primary action label and placement
7. true-white/cool-gray color system

- [ ] **Step 5: Fix visual mismatches**

If any of the comparison points differs from the concept in a way a product designer would flag, edit `apps/desktop/src/styles.css`, `apps/desktop/src/index.html`, or `apps/desktop/src/renderer.ts`, then repeat Steps 1 through 4.

- [ ] **Step 6: Commit final implementation**

Run:

```bash
git status --short
git add apps/desktop/src apps/desktop/test
git commit -m "feat: redesign desktop submission optimization UI"
```

## Self-Review

Spec coverage:

- Single-file submission limit, preservation preference, automatic plan, custom plan, and verification copy are covered by Tasks 1, 3, 4, 6, and 7.
- Batch entry, shared controls, file rows, target-status labels, and batch plan are covered by Task 5 and styled in Task 6.
- Persistence for submission settings is covered by Task 2.
- Tests and verification gates are covered by Tasks 1, 2, 5, and 8.
- No core optimization algorithm changes are included.

Gap scan:

- Every code-changing task includes concrete paths, snippets, commands, and expected outcomes.

Type consistency:

- `SubmissionLimit`, `PreservationPreference`, `SubmissionPlan`, `SubmissionActionRow`, and `OptimizationMode` names are introduced in Task 1 and reused consistently in later tasks.
- Renderer state fields match the shared types.
- Batch item fields are introduced before renderer usage.
