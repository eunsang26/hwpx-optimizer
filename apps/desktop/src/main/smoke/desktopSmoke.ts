import type { App, BrowserWindow } from "electron";
import { mkdir, readFile as readFileFs, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { OptimizationMode } from "../desktopService.js";
import type { DesktopPathPermissions } from "../pathPermissions.js";
import type { DocumentWorkerClient } from "../documentWorkerClient.js";
import type { DocumentOperations } from "../documentOperations.js";
import { assertOfflineBundledFonts } from "../offlineFontSmoke.js";
import { DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT } from "../../shared/windowConfig.js";

export type SmokeSelection = { paths?: string[]; delivery?: { consumed: boolean } };
type SmokeContext = {
  app: App;
  permissions: DesktopPathPermissions;
  worker: DocumentWorkerClient;
  operations: DocumentOperations;
  selection: SmokeSelection;
};

export async function runDesktopSmoke(window: BrowserWindow, context: SmokeContext): Promise<void> {
  const { app, permissions, worker: documentWorkerClient, operations: documentOperations, selection } = context;
  await assertOfflineBundledFonts(window, app.isPackaged);
  const smokeDir = join(app.getPath("userData"), "smoke-workspace");
  await rm(smokeDir, { recursive: true, force: true });
  await mkdir(smokeDir, { recursive: true });
  const smokeInputPath = join(smokeDir, "smoke.hwpx");
  const smokeSecondInputPath = join(smokeDir, "smoke-second.hwpx");
  const smokeThirdInputPath = join(smokeDir, "smoke-third.hwpx");
  const smokeFourthInputPath = join(smokeDir, "smoke-fourth.hwpx");
  const smokeSourcePath = process.env.HWPX_OPT_SMOKE_INPUT;
  const smokeMode = parseSmokeMode(process.env.HWPX_OPT_SMOKE_MODE);
  await writeFile(
    smokeInputPath,
    smokeSourcePath ? await readFileFs(resolve(smokeSourcePath)) : await createSmokeHwpxFixture()
  );
  await writeFile(smokeSecondInputPath, await createSmokeHwpxFixture());
  await writeFile(smokeThirdInputPath, await createSmokeHwpxFixture());
  await writeFile(smokeFourthInputPath, await createSmokeHwpxFixture());
  const smokeInputExceedsDefaultTarget = (await stat(smokeInputPath)).size > 40 * 1024 * 1024;
  await permissions.registerInput(smokeInputPath);
  await permissions.registerInput(smokeSecondInputPath);
  await permissions.registerInput(smokeThirdInputPath);
  await permissions.registerInput(smokeFourthInputPath);
  await permissions.registerOutputDirectory(smokeDir);
  selection.paths = [smokeInputPath];

  const result = (await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      let attempts = 0;
      const poll = () => {
        attempts += 1;
        if (document.body.dataset.appReady === "true" || attempts > 50) {
          document.getElementById("settings-button")?.click();
          resolve({
            title: document.title,
            fileName: document.getElementById("file-name")?.textContent,
            safetyText: document.getElementById("safety-text")?.textContent,
            appReady: document.body.dataset.appReady,
            preloadApi: document.body.dataset.preloadApi,
            settingsOpen: document.getElementById("settings-panel")?.classList.contains("is-open"),
            settingsSubmissionLimit: document.getElementById("setting-submission-limit")?.value,
            settingsOutputButton: document.getElementById("setting-output-button")?.textContent,
            settingsOutputResetButton: document.getElementById("setting-output-reset-button")?.textContent
          });
          return;
        }
        setTimeout(poll, 50);
      };
      poll();
    })
  `)) as {
    title?: string;
    fileName?: string;
    safetyText?: string;
    appReady?: string;
    preloadApi?: string;
    settingsOpen?: boolean;
    settingsSubmissionLimit?: string;
    settingsOutputButton?: string;
    settingsOutputResetButton?: string;
  };

  if (result.title !== "HWPX 보고서 용량 최적화") {
    throw new Error(`Desktop smoke failed: unexpected title ${String(result.title)}`);
  }
  if (result.fileName !== "HWPX 파일 가져오기") {
    throw new Error(`Desktop smoke failed: renderer did not load expected start view`);
  }
  if (!result.safetyText?.includes("보안 문서")) {
    throw new Error(`Desktop smoke failed: local security policy text is missing`);
  }
  if (result.appReady !== "true" || result.preloadApi !== "ready") {
    throw new Error(`Desktop smoke failed: renderer/preload init did not complete`);
  }
  if (
    result.settingsOpen !== true ||
    result.settingsSubmissionLimit !== "mb40" ||
    result.settingsOutputButton !== "폴더 선택" ||
    result.settingsOutputResetButton !== "원본 폴더 사용"
  ) {
    throw new Error("Desktop smoke failed: settings output folder controls did not render");
  }

  const concurrentSettings = (await window.webContents.executeJavaScript(`
    (async () => {
      await Promise.all([
        window.hwpxOptimizer.saveSettings({ saveReport: true }),
        window.hwpxOptimizer.saveSettings({ preventOverwrite: false })
      ]);
      const loaded = await window.hwpxOptimizer.loadSettings();
      await window.hwpxOptimizer.saveSettings({ saveReport: false, preventOverwrite: true });
      return {
        saveReport: loaded.saveReport,
        preventOverwrite: loaded.preventOverwrite
      };
    })()
  `)) as { saveReport?: boolean; preventOverwrite?: boolean };
  if (concurrentSettings.saveReport !== true || concurrentSettings.preventOverwrite !== false) {
    throw new Error(
      `Desktop smoke failed: concurrent settings patches lost an update ${JSON.stringify(concurrentSettings)}`
    );
  }

  const layout = (await window.webContents.executeJavaScript(`
    (() => {
      document.getElementById("settings-close-button")?.click();
      document.getElementById("help-button")?.click();
      const workspace = document.getElementById("single-workspace");
      const shell = document.querySelector(".shell");
      const planSidebar = document.getElementById("plan-sidebar");
      const optionsSheet = document.getElementById("detail-options-sheet");
      const summaryPanel = document.querySelector(".summary-panel");
      const emptyReview = document.getElementById("empty-policy-review");
      const helpPanel = document.getElementById("help-panel");
      const workspaceRect = workspace?.getBoundingClientRect();
      const shellRect = shell?.getBoundingClientRect();
      const shellStyle = shell ? getComputedStyle(shell) : undefined;
      const shellContentWidth = shellRect
        ? shellRect.width -
          Number.parseFloat(shellStyle?.paddingLeft ?? "0") -
          Number.parseFloat(shellStyle?.paddingRight ?? "0")
        : 0;
      return {
        planInsideOptions: optionsSheet?.contains(planSidebar) ?? false,
        planHiddenWithOptions: planSidebar?.getClientRects().length === 0,
        singleColumn: getComputedStyle(workspace ?? document.body).gridTemplateColumns.split(" ").length === 1,
        emptySummaryHidden: summaryPanel?.getClientRects().length === 0,
        emptyReviewVisible: (emptyReview?.getBoundingClientRect().width ?? 0) > 0,
        workspaceWidth: workspaceRect?.width ?? 0,
        shellWidth: shellRect?.width ?? 0,
        shellContentWidth,
        workspaceWidthDelta: Math.abs((workspaceRect?.width ?? 0) - shellContentWidth),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        helpOpen: helpPanel?.classList.contains("is-open") ?? false,
        helpTitle: document.getElementById("help-title")?.textContent,
        manualStepCount: document.querySelectorAll(".manual-steps li").length
      };
    })()
  `)) as {
    planInsideOptions?: boolean;
    planHiddenWithOptions?: boolean;
    singleColumn?: boolean;
    emptySummaryHidden?: boolean;
    emptyReviewVisible?: boolean;
    workspaceWidth?: number;
    shellWidth?: number;
    shellContentWidth?: number;
    workspaceWidthDelta?: number;
    viewportWidth?: number;
    viewportHeight?: number;
    helpOpen?: boolean;
    helpTitle?: string;
    manualStepCount?: number;
  };

  if (
    layout.planInsideOptions !== true ||
    layout.planHiddenWithOptions !== true ||
    layout.singleColumn !== true ||
    layout.emptySummaryHidden !== true ||
    layout.emptyReviewVisible !== true ||
    layout.viewportWidth !== DEFAULT_WINDOW_WIDTH ||
    !layout.viewportHeight ||
    layout.viewportHeight < DEFAULT_WINDOW_HEIGHT - 20 ||
    layout.viewportHeight > DEFAULT_WINDOW_HEIGHT
  ) {
    throw new Error(
      `Desktop smoke failed: canonical empty layout did not render in the compact default window ${JSON.stringify(layout)}`
    );
  }
  if (
    !layout.shellWidth ||
    !layout.workspaceWidth ||
    (layout.workspaceWidthDelta ?? Number.POSITIVE_INFINITY) > 1
  ) {
    throw new Error(
      `Desktop smoke failed: workspace width ${String(layout.workspaceWidth)} does not fill shell width ${String(layout.shellWidth)}`
    );
  }
  if (layout.helpOpen !== true || layout.helpTitle !== "사용 매뉴얼" || layout.manualStepCount !== 10) {
    throw new Error("Desktop smoke failed: manual-style help panel did not render");
  }

  const dragUi = (await window.webContents.executeJavaScript(`
    (() => {
      document.getElementById("help-close-button")?.click();
      const dragEnter = new DragEvent("dragenter", { bubbles: true, cancelable: true });
      document.dispatchEvent(dragEnter);
      const overlay = document.getElementById("drop-overlay");
      const active = document.body.dataset.dragOver === "true";
      const overlayVisible = overlay?.hidden === false;
      const overlayText = overlay?.textContent ?? "";
      const drop = new DragEvent("drop", { bubbles: true, cancelable: true });
      document.dispatchEvent(drop);
      return {
        active,
        overlayVisible,
        overlayText,
        statusBannerExists: Boolean(document.getElementById("status-banner")),
        hasSubmission40Preset: Boolean(document.querySelector("#submission-limit-select option[value='mb40']")),
        batchResultDetailsExists: Boolean(document.getElementById("batch-result-details")),
        cleared: document.body.dataset.dragOver !== "true" && overlay?.hidden === true
      };
    })()
  `)) as {
    active?: boolean;
    overlayVisible?: boolean;
    overlayText?: string;
    statusBannerExists?: boolean;
    hasSubmission40Preset?: boolean;
    batchResultDetailsExists?: boolean;
    cleared?: boolean;
  };

  if (
    dragUi.active !== true ||
    dragUi.overlayVisible !== true ||
    !dragUi.overlayText?.includes("HWPX 파일을 여기에 놓으세요") ||
    dragUi.statusBannerExists !== true ||
    dragUi.hasSubmission40Preset !== true ||
    dragUi.batchResultDetailsExists !== true ||
    dragUi.cleared !== true
  ) {
    throw new Error("Desktop smoke failed: full-window drag overlay did not respond to drag/drop events");
  }

  const selectedUi = (await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      document.getElementById("empty-choose-button")?.click();
      let attempts = 0;
      const poll = () => {
        attempts += 1;
        const selected = document.getElementById("selected-file-card");
        const optimize = document.getElementById("optimize-button");
        const status = document.getElementById("summary-status");
        if (
          document.body.dataset.view === "single" &&
          selected?.hidden === false &&
          optimize?.disabled === false &&
          status?.textContent?.includes("제출")
        ) {
          const policyRect = document.getElementById("policy-toolbar")?.getBoundingClientRect();
          const fileRect = document.querySelector(".file-panel")?.getBoundingClientRect();
          const summaryRect = document.querySelector(".summary-panel")?.getBoundingClientRect();
          const dockRect = document.getElementById("run-dock")?.getBoundingClientRect();
          const outputRect = document.getElementById("output-button")?.getBoundingClientRect();
          const optionsRect = document.getElementById("toggle-options-button")?.getBoundingClientRect();
          const detailsRect = document.getElementById("analysis-details")?.getBoundingClientRect();
          const workspaceRect = document.getElementById("single-workspace")?.getBoundingClientRect();
          resolve({
            policyBeforeFile: Boolean(policyRect && fileRect && policyRect.top < fileRect.top),
            fileBeforeHero: Boolean(fileRect && summaryRect && fileRect.top < summaryRect.top),
            ctaSingleRow: Boolean(outputRect && optionsRect) &&
              Math.abs(outputRect.top + outputRect.height / 2 - optionsRect.top - optionsRect.height / 2) <= 1,
            dockSeparated: Boolean(dockRect && workspaceRect && dockRect.top >= workspaceRect.bottom && dockRect.bottom <= innerHeight),
            ctaVisible: [
              optimize.getClientRects().length > 0,
              document.getElementById("output-button")?.getClientRects().length > 0,
              document.getElementById("toggle-options-button")?.getClientRects().length > 0
            ],
            reviewVisible: (document.getElementById("review-strip")?.getBoundingClientRect().width ?? 0) > 0,
            emptyReviewHidden: document.getElementById("empty-policy-review")?.getClientRects().length === 0,
            expectedMeta: document.getElementById("summary-verdict")?.textContent,
            heroText: status.textContent,
            optimizeText: optimize.textContent,
            visiblePolicyControls: document.querySelectorAll(
              '#policy-toolbar label:not([hidden]):not(.policy-toolbar-batch)'
            ).length,
            singleBatchPolicyHidden:
              document.querySelector(".policy-toolbar-batch")?.getClientRects().length === 0,
            targetMarkerVisible:
              document.getElementById("target-track-limit")?.getClientRects().length > 0,
            targetLabelVisible:
              document.getElementById("gauge-mid-label")?.getClientRects().length > 0,
            workspaceWidth: (() => {
              const workspace = document.getElementById("single-workspace");
              const style = getComputedStyle(workspace);
              return workspace.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
            })(),
            detailsWidth: detailsRect?.width ?? 0,
            selectedFileName: document.getElementById("selected-file-name")?.textContent
          });
          return;
        }
        if (attempts > 2400) {
          resolve({ timedOut: true });
          return;
        }
        setTimeout(poll, 50);
      };
      poll();
    })
  `)) as {
    timedOut?: boolean;
    policyBeforeFile?: boolean;
    fileBeforeHero?: boolean;
    ctaSingleRow?: boolean;
    ctaVisible?: Array<boolean | undefined>;
    dockSeparated?: boolean;
    reviewVisible?: boolean;
    emptyReviewHidden?: boolean;
    expectedMeta?: string;
    heroText?: string;
    optimizeText?: string;
    visiblePolicyControls?: number;
    singleBatchPolicyHidden?: boolean;
    targetMarkerVisible?: boolean;
    targetLabelVisible?: boolean;
    workspaceWidth?: number;
    detailsWidth?: number;
    selectedFileName?: string;
  };

  if (
    selectedUi.timedOut ||
    selectedUi.policyBeforeFile !== true ||
    selectedUi.fileBeforeHero !== true ||
    selectedUi.ctaSingleRow !== true ||
    selectedUi.dockSeparated !== true ||
    JSON.stringify(selectedUi.ctaVisible) !== JSON.stringify([false, true, true]) ||
    selectedUi.reviewVisible !== true ||
    selectedUi.emptyReviewHidden !== true ||
    !selectedUi.expectedMeta?.includes("예상") ||
    !selectedUi.heroText?.includes("제출") ||
    selectedUi.optimizeText !== "최적화 실행" ||
    selectedUi.visiblePolicyControls !== 2 ||
    selectedUi.singleBatchPolicyHidden !== true ||
    selectedUi.targetMarkerVisible !== smokeInputExceedsDefaultTarget ||
    selectedUi.targetLabelVisible !== smokeInputExceedsDefaultTarget ||
    !selectedUi.selectedFileName?.endsWith(".hwpx") ||
    !selectedUi.workspaceWidth ||
    Math.abs(selectedUi.workspaceWidth - (selectedUi.detailsWidth ?? 0)) > 1
  ) {
    throw new Error(`Desktop smoke failed: canonical selected layout mismatch ${JSON.stringify(selectedUi)}`);
  }

  selection.paths = [smokeInputPath, smokeSecondInputPath];
  const batchUi = (await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      document.getElementById("choose-button")?.click();
      let attempts = 0;
      const poll = () => {
        attempts += 1;
        const rows = Array.from(document.querySelectorAll("#batch-list tr"));
        const optimize = document.getElementById("optimize-button");
        if (
          document.body.dataset.view === "batch" &&
          document.body.dataset.busy !== "analysis" &&
          rows.length === 2 &&
          optimize?.disabled === false
        ) {
          const judge = document.getElementById("batch-target-mode-select");
          judge.value = "per-file";
          judge.dispatchEvent(new Event("change", { bubbles: true }));
          const perFileState = {
            heroMeta: document.getElementById("summary-verdict")?.textContent,
            scope: judge.value,
            limit: document.getElementById("submission-limit-select")?.value,
            optimizeText: optimize.textContent,
            qualityTitle: document.getElementById("quality-head-label")?.textContent,
            pendingRemoveActions: document.querySelectorAll('#batch-list [data-action="remove"]').length,
            selectedRows: rows.filter((row) => row.querySelector(".batch-select")?.checked).length
          };

          judge.value = "aggregate";
          judge.dispatchEvent(new Event("change", { bubbles: true }));
          const aggregateMeta = document.getElementById("summary-verdict")?.textContent;
          const allocatedRows = Array.from(document.querySelectorAll("#batch-list .name .sub"))
            .filter((item) => item.textContent?.includes("배분 목표")).length;

          const firstCheckbox = document.querySelector("#batch-list .batch-select");
          firstCheckbox.checked = false;
          firstCheckbox.dispatchEvent(new Event("change", { bubbles: true }));
          const firstRow = document.querySelector("#batch-list tr");
          const excludedState = {
            status: firstRow?.querySelector(".status")?.textContent,
            size: firstRow?.querySelector(".batch-size-cell")?.textContent,
            qualityControls: firstRow?.querySelectorAll(".row-q-btn, .batch-quality-input").length,
            selectedLive: document.getElementById("policy-live")?.textContent
          };

          document.getElementById("quality-mode-manual")?.click();
          const manualState = {
            title: document.getElementById("quality-head-label")?.textContent,
            manualVisible: document.getElementById("quality-manual")?.getClientRects().length > 0,
            selectedQualityInputs: Array.from(document.querySelectorAll("#batch-list tr"))
              .filter((row) => row.querySelector(".batch-select")?.checked)
              .filter((row) => row.querySelector(".batch-quality-input")).length,
            excludedQualityInputs: firstRow?.querySelectorAll(".batch-quality-input").length
          };

          document.getElementById("toggle-options-button")?.click();
          const optionsSheet = document.getElementById("detail-options-sheet");
          const optionsState = {
            visible: optionsSheet?.getClientRects().length > 0
          };
          const selectAll = document.getElementById("batch-select-all");
          selectAll.checked = false;
          selectAll.dispatchEvent(new Event("change", { bubbles: true }));
          const selectNoneState = {
            hero: document.getElementById("summary-status")?.textContent,
            optimizeDisabled: document.getElementById("optimize-button")?.disabled,
            excludedRows: Array.from(document.querySelectorAll("#batch-list .status"))
              .filter((item) => item.textContent === "제외").length
          };
          selectAll.checked = true;
          selectAll.dispatchEvent(new Event("change", { bubbles: true }));
          const selectAllState = {
            selectedLive: document.getElementById("policy-live")?.textContent,
            optimizeDisabled: document.getElementById("optimize-button")?.disabled,
            qualityInputs: document.querySelectorAll("#batch-list .batch-quality-input").length
          };
          resolve({
            perFileState,
            aggregateMeta,
            aggregateScope: judge.value,
            allocatedRows,
            excludedState,
            manualState,
            optionsState,
            selectNoneState,
            selectAllState
          });
          return;
        }
        if (attempts > 2400) {
          resolve({ timedOut: true });
          return;
        }
        setTimeout(poll, 50);
      };
      poll();
    })
  `)) as {
    timedOut?: boolean;
    perFileState?: {
      heroMeta?: string;
      scope?: string;
      limit?: string;
      optimizeText?: string;
      qualityTitle?: string;
      pendingRemoveActions?: number;
      selectedRows?: number;
    };
    aggregateMeta?: string;
    aggregateScope?: string;
    allocatedRows?: number;
    excludedState?: {
      status?: string;
      size?: string;
      qualityControls?: number;
      selectedLive?: string;
    };
    manualState?: {
      title?: string;
      manualVisible?: boolean;
      selectedQualityInputs?: number;
      excludedQualityInputs?: number;
    };
    optionsState?: {
      visible?: boolean;
    };
    selectNoneState?: {
      hero?: string;
      optimizeDisabled?: boolean;
      excludedRows?: number;
    };
    selectAllState?: {
      selectedLive?: string;
      optimizeDisabled?: boolean;
      qualityInputs?: number;
    };
  };

  if (
    batchUi.timedOut ||
    !batchUi.perFileState ||
    !batchUi.perFileState.heroMeta?.includes("예상 합계") ||
    batchUi.perFileState.scope !== "per-file" ||
    batchUi.perFileState.limit !== "mb40" ||
    batchUi.perFileState.optimizeText !== "선택 파일 일괄 최적화" ||
    batchUi.perFileState.qualityTitle !== "품질 · 파일별 자동" ||
    batchUi.perFileState.pendingRemoveActions !== 2 ||
    batchUi.perFileState.selectedRows !== 2 ||
    !batchUi.aggregateMeta?.includes("예상 합계") ||
    batchUi.aggregateScope !== "aggregate" ||
    batchUi.allocatedRows !== 2 ||
    batchUi.excludedState?.status !== "제외" ||
    !batchUi.excludedState.size?.includes("—") ||
    batchUi.excludedState.qualityControls !== 0 ||
    !batchUi.excludedState.selectedLive?.includes("선택 1") ||
    batchUi.manualState?.title !== "일괄 품질 (선택 파일)" ||
    batchUi.manualState.manualVisible !== true ||
    batchUi.manualState.selectedQualityInputs !== 1 ||
    batchUi.manualState.excludedQualityInputs !== 0 ||
    batchUi.optionsState?.visible !== true ||
    !batchUi.selectNoneState?.hero?.includes("선택·분석 대기") ||
    batchUi.selectNoneState.optimizeDisabled !== true ||
    batchUi.selectNoneState.excludedRows !== 2 ||
    !batchUi.selectAllState?.selectedLive?.includes("선택 2") ||
    batchUi.selectAllState.optimizeDisabled !== false ||
    batchUi.selectAllState.qualityInputs !== 2
  ) {
    throw new Error(`Desktop smoke failed: canonical batch event flow mismatch ${JSON.stringify(batchUi)}`);
  }

  selection.paths = [smokeInputPath];
  const batchDuplicateAddUi = (await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      document.getElementById("choose-button")?.click();
      let attempts = 0;
      const poll = () => {
        attempts += 1;
        if (document.body.dataset.busy !== "analysis") {
          resolve({
            view: document.body.dataset.view,
            rowCount: document.querySelectorAll("#batch-list tr").length,
            fileMeta: document.getElementById("file-meta")?.textContent
          });
          return;
        }
        if (attempts > 2400) {
          resolve({ timedOut: true });
          return;
        }
        setTimeout(poll, 50);
      };
      setTimeout(poll, 0);
    })
  `)) as {
    timedOut?: boolean;
    view?: string;
    rowCount?: number;
    fileMeta?: string;
  };
  if (
    batchDuplicateAddUi.timedOut ||
    batchDuplicateAddUi.view !== "batch" ||
    batchDuplicateAddUi.rowCount !== 2 ||
    !batchDuplicateAddUi.fileMeta?.includes("2개 파일")
  ) {
    throw new Error(
      `Desktop smoke failed: adding one file to an existing batch replaced the batch ${JSON.stringify(batchDuplicateAddUi)}`
    );
  }

  selection.paths = [smokeThirdInputPath];
  const batchSingleAddUi = (await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const cleanup = document.getElementById("cleanup-document-toggle");
      cleanup.checked = false;
      cleanup.dispatchEvent(new Event("change", { bubbles: true }));
      document.getElementById("choose-button")?.click();
      let attempts = 0;
      const poll = () => {
        attempts += 1;
        const rows = document.querySelectorAll("#batch-list tr");
        if (
          document.body.dataset.view === "batch" &&
          document.body.dataset.busy !== "analysis" &&
          rows.length === 3
        ) {
          resolve({
            view: document.body.dataset.view,
            rowCount: rows.length,
            fileMeta: document.getElementById("file-meta")?.textContent,
            cleanupChecked: cleanup.checked,
            targetMode: document.getElementById("batch-target-mode-select")?.value,
            manualPressed: document.getElementById("quality-mode-manual")?.getAttribute("aria-pressed")
          });
          return;
        }
        if (attempts > 2400) {
          resolve({ timedOut: true });
          return;
        }
        setTimeout(poll, 50);
      };
      poll();
    })
  `)) as {
    timedOut?: boolean;
    view?: string;
    rowCount?: number;
    fileMeta?: string;
    cleanupChecked?: boolean;
    targetMode?: string;
    manualPressed?: string;
  };
  if (
    batchSingleAddUi.timedOut ||
    batchSingleAddUi.view !== "batch" ||
    batchSingleAddUi.rowCount !== 3 ||
    !batchSingleAddUi.fileMeta?.includes("3개 파일") ||
    batchSingleAddUi.cleanupChecked !== false ||
    batchSingleAddUi.targetMode !== "aggregate" ||
    batchSingleAddUi.manualPressed !== "true"
  ) {
    throw new Error(
      `Desktop smoke failed: adding one new file did not preserve the active batch policy ${JSON.stringify(batchSingleAddUi)}`
    );
  }

  const completedBatchUi = (await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      document.getElementById("run-dock-button")?.click();
      let attempts = 0;
      const poll = () => {
        attempts += 1;
        if (
          document.body.dataset.batchResult === "visible" &&
          document.body.dataset.busy === ""
        ) {
          resolve({
            doneRows: Array.from(document.querySelectorAll("#batch-list .status"))
              .filter((item) => item.textContent === "완료").length,
            actualSummary: document.getElementById("summary-result-line")?.textContent?.includes("실제 합계"),
            actualRows: Array.from(document.querySelectorAll("#batch-list .batch-size-cell")).every(cell => cell.textContent?.includes("실제")),
            resultVisible: document.getElementById("batch-result-panel")?.getClientRects().length > 0
          });
          return;
        }
        if (attempts > 2400) {
          resolve({ timedOut: true });
          return;
        }
        setTimeout(poll, 50);
      };
      poll();
    })
  `)) as { timedOut?: boolean; doneRows?: number; resultVisible?: boolean; actualSummary?: boolean; actualRows?: boolean };
  if (completedBatchUi.timedOut || completedBatchUi.doneRows !== 3 || completedBatchUi.resultVisible !== true || !completedBatchUi.actualSummary || !completedBatchUi.actualRows) {
    throw new Error(`Desktop smoke failed: real batch completion flow mismatch ${JSON.stringify(completedBatchUi)}`);
  }

  selection.paths = [smokeFourthInputPath];
  const batchPostResultAddUi = (await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      document.getElementById("choose-button")?.click();
      let attempts = 0;
      const poll = () => {
        attempts += 1;
        const rows = document.querySelectorAll("#batch-list tr");
        if (
          document.body.dataset.view === "batch" &&
          document.body.dataset.busy !== "analysis" &&
          rows.length === 4
        ) {
          resolve({
            batchResult: document.body.dataset.batchResult,
            resultHidden: document.getElementById("batch-result-panel")?.hidden,
            rowCount: rows.length,
            fileMeta: document.getElementById("file-meta")?.textContent
          });
          return;
        }
        if (attempts > 2400) {
          resolve({ timedOut: true });
          return;
        }
        setTimeout(poll, 50);
      };
      poll();
    })
  `)) as {
    timedOut?: boolean;
    batchResult?: string;
    resultHidden?: boolean;
    rowCount?: number;
    fileMeta?: string;
  };
  if (
    batchPostResultAddUi.timedOut ||
    batchPostResultAddUi.batchResult !== "" ||
    batchPostResultAddUi.resultHidden !== true ||
    batchPostResultAddUi.rowCount !== 4 ||
    !batchPostResultAddUi.fileMeta?.includes("4개 파일")
  ) {
    throw new Error(
      `Desktop smoke failed: adding a file after batch completion left stale result UI ${JSON.stringify(batchPostResultAddUi)}`
    );
  }

  window.setContentSize(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT);
  const compactBatchUi = (await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const settingsPanel = document.getElementById("settings-panel");
      settingsPanel.style.transition = "none";
      document.getElementById("settings-button")?.click();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const settings = settingsPanel?.getBoundingClientRect();
        const toolbar = document.getElementById("policy-toolbar")?.getBoundingClientRect();
        resolve({
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          settingsLeft: settings?.left,
          settingsRight: settings?.right,
          toolbarLeft: toolbar?.left,
          toolbarRight: toolbar?.right
        });
      }));
    })
  `)) as {
    viewportWidth?: number;
    documentWidth?: number;
    settingsLeft?: number;
    settingsRight?: number;
    toolbarLeft?: number;
    toolbarRight?: number;
  };
  await window.webContents.executeJavaScript(`document.getElementById("settings-close-button")?.click()`);
  window.setContentSize(DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT);
  if (
    !compactBatchUi.viewportWidth ||
    (compactBatchUi.documentWidth ?? 0) > compactBatchUi.viewportWidth + 1 ||
    (compactBatchUi.settingsLeft ?? -1) < 0 ||
    (compactBatchUi.settingsRight ?? Number.POSITIVE_INFINITY) > compactBatchUi.viewportWidth + 1 ||
    (compactBatchUi.toolbarLeft ?? -1) < 0 ||
    (compactBatchUi.toolbarRight ?? Number.POSITIVE_INFINITY) > compactBatchUi.viewportWidth + 1
  ) {
    throw new Error(`Desktop smoke failed: compact batch layout overflowed ${JSON.stringify(compactBatchUi)}`);
  }

  const workflow = (await window.webContents.executeJavaScript(`
    (async () => {
      const progress = [];
      const unsubscribe = window.hwpxOptimizer.onOptimizeProgress((item) => progress.push(item));
      const saved = await window.hwpxOptimizer.saveSettings({ outputDirectory: ${JSON.stringify(smokeDir)} });
      const analysis = await window.hwpxOptimizer.analyze(${JSON.stringify(smokeInputPath)});
      let invalidAnalysisRejected = false;
      try { await window.hwpxOptimizer.analyze(${JSON.stringify(smokeInputPath)}, { analysisMode: "invalid" }); }
      catch { invalidAnalysisRejected = true; }
      const detailed = await window.hwpxOptimizer.analyze(${JSON.stringify(smokeInputPath)}, { analysisMode: "deep" });
      const result = await window.hwpxOptimizer.optimize({
        filePath: ${JSON.stringify(smokeInputPath)},
        mode: ${JSON.stringify(smokeMode)},
        outputDirectory: ${JSON.stringify(smokeDir)}
      });
      const verification = await window.hwpxOptimizer.verify(result.outputPath);
      unsubscribe();
      return {
        originalSize: analysis.report.originalSize,
        analysisMode: analysis.report.analysis?.mode,
        reportPhasesValid: analysis.report.kind === "analysis" && detailed.report.kind === "analysis" &&
          analysis.report.optimizedSize === undefined && analysis.report.targetStatus === undefined &&
          typeof analysis.report.estimatedSize === "number" && result.report.kind === "optimization" &&
          result.report.estimatedSize === undefined,
        outputBytes: result.report.optimizedSize,
        detailedAnalysisMode: detailed.report.analysis?.mode,
        invalidAnalysisRejected,
        outputPath: result.outputPath,
        reportPath: result.reportPath,
        verified: verification.ok,
        progressCount: progress.length,
        savedOutputDirectory: saved.outputDirectory
      };
    })()
  `)) as {
    originalSize?: number;
    reportPhasesValid?: boolean;
    outputBytes?: number;
    analysisMode?: string;
    detailedAnalysisMode?: string;
    invalidAnalysisRejected?: boolean;
    outputPath?: string;
    reportPath?: string;
    verified?: boolean;
    progressCount?: number;
    savedOutputDirectory?: string;
  };

  if (!workflow.originalSize || workflow.originalSize <= 0) {
    throw new Error("Desktop smoke failed: analysis did not return a document size");
  }
  window.webContents.send("hwpx:optimize-progress", { percent: 100, item: "Optimization complete" });
  const lateProgressHidden = await window.webContents.executeJavaScript(`
    new Promise(resolve => setTimeout(() => resolve(document.getElementById("progress-panel")?.hidden), 30))
  `);
  if (!lateProgressHidden) throw new Error("Desktop smoke failed: late progress reopened the idle progress panel");
  if (!workflow.reportPhasesValid || workflow.outputBytes !== (await readFileFs(workflow.outputPath!)).length) {
    throw new Error("Desktop smoke failed: forecast and measured report contracts crossed the IPC boundary incorrectly");
  }
  if (workflow.analysisMode !== "quick" || workflow.detailedAnalysisMode !== "deep" || !workflow.invalidAnalysisRejected) {
    throw new Error("Desktop smoke failed: analysis mode did not cross the preload/IPC/worker boundary");
  }
  if (!workflow.outputPath?.endsWith("_optimized.hwpx")) {
    throw new Error(`Desktop smoke failed: unexpected output path ${String(workflow.outputPath)}`);
  }
  if (workflow.reportPath !== undefined) {
    throw new Error(`Desktop smoke failed: report path was returned with default report saving disabled`);
  }
  if (workflow.savedOutputDirectory !== undefined) {
    throw new Error("Desktop smoke failed: output directory was persisted in settings");
  }
  if (workflow.verified !== true) {
    throw new Error("Desktop smoke failed: optimized output did not verify");
  }
  if (!workflow.progressCount || workflow.progressCount < 1) {
    throw new Error("Desktop smoke failed: no optimization progress was emitted");
  }

  const screenshotPath = process.env.HWPX_OPT_SMOKE_SCREENSHOT;
  if (screenshotPath) {
    await window.webContents.executeJavaScript(`
      (() => {
        for (const id of ["settings-backdrop", "help-backdrop", "drop-overlay", "progress-panel", "status-banner"]) {
          const element = document.getElementById(id);
          if (element) element.hidden = true;
        }
        document.body.dataset.dragOver = "false";
        document.getElementById("drop-zone")?.classList.remove("is-over");
        document.getElementById("settings-panel")?.classList.remove("is-open");
        document.getElementById("help-panel")?.classList.remove("is-open");
      })()
    `);
    const screenshot = await window.webContents.capturePage();
    await writeFile(resolve(screenshotPath), screenshot.toPNG());
  }

  const spoofedDropRegistration = (await window.webContents.executeJavaScript(`
    window.hwpxOptimizer.registerDroppedHwpxFiles([
      { name: "spoof.hwpx", path: ${JSON.stringify(smokeInputPath)} }
    ])
  `)) as string[];

  if (spoofedDropRegistration.length !== 0) {
    throw new Error("Desktop smoke failed: spoofed dropped-file path was registered");
  }
  const savedOutputBeforeReset = await readFileFs(workflow.outputPath!);
  const resetUi = await window.webContents.executeJavaScript(`
    (() => {
      const controls = ["submission-limit-select", "preservation-select", "batch-target-mode-select"];
      const policy = controls.map((id) => document.getElementById(id)?.value).join("|");
      document.getElementById("start-over-button")?.click();
      return {
        view: document.body.dataset.view,
        focus: document.activeElement?.id,
        batchRows: document.querySelectorAll("#batch-list tr").length,
        resultHidden: document.getElementById("result-panel")?.hidden,
        batchResultHidden: document.getElementById("batch-result-panel")?.hidden,
        progressHidden: document.getElementById("progress-panel")?.hidden,
        optimizeDisabled: document.getElementById("optimize-button")?.disabled,
        resetHidden: document.getElementById("start-over-button")?.hidden,
        policyRetained: policy === controls.map((id) => document.getElementById(id)?.value).join("|")
      };
    })()
  `);
  if (resetUi.view !== "empty" || resetUi.focus !== "empty-choose-button" || resetUi.batchRows !== 0 ||
      !resetUi.resultHidden || !resetUi.batchResultHidden || !resetUi.progressHidden || !resetUi.optimizeDisabled ||
      !resetUi.resetHidden || !resetUi.policyRetained || !(await readFileFs(workflow.outputPath!)).equals(savedOutputBeforeReset)) {
    throw new Error(`Desktop smoke failed: return to start did not reset the view and retain saved files/settings ${JSON.stringify(resetUi)}`);
  }
  await window.webContents.executeJavaScript(`
    window.hwpxOptimizer.saveSettings({ batchTargetMode: "per-file" })
  `);
  const { runWorkflowRegressionSmoke } = await import("../workflowSmoke.js");
  await runWorkflowRegressionSmoke(window, {
    directory: smokeDir,
    fixture: createSmokeHwpxFixture,
    selectFiles: paths => {
      selection.paths = paths;
      selection.delivery = { consumed: false };
      return selection.delivery;
    },
    registerInput: path => permissions.registerInput(path),
    worker: documentWorkerClient,
    operations: documentOperations
  });
  const { runSettingsSmoke } = await import("./settingsSmoke.js");
  await runSettingsSmoke(window, app.getPath("userData"), smokeSecondInputPath, selection);
  const { runInteractionSmoke } = await import("./interactionSmoke.js");
  await runInteractionSmoke(window, { directory: smokeDir, fixture: createSmokeHwpxFixture, worker: documentWorkerClient, selection });
  const { runReadabilitySmoke } = await import("./readabilitySmoke.js");
  await runReadabilitySmoke(window, { directory: smokeDir, fixture: createSmokeHwpxFixture, selection });
}

function parseSmokeMode(value: string | undefined): OptimizationMode {
  if (value === "safe" || value === "balanced" || value === "aggressive") return value;
  return "safe";
}

async function createSmokeHwpxFixture(): Promise<Buffer> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file("Contents/content.hpf", '<opf:package xmlns:opf="http://www.idpf.org/2007/opf" />');
  zip.file("Contents/section0.xml", '<root><img href="BinData/used.bin" /></root>');
  zip.file("BinData/used.bin", "used");
  zip.file("BinData/unused.bin", "unused");
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}

