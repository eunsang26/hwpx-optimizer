import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { BrowserWindow } from "electron";
import { verifyHwpxOutput } from "@hwpx-optimizer/core";
import type { DocumentWorkerClient } from "./documentWorkerClient.js";
import type { DocumentOperations } from "./documentOperations.js";

type Context = {
  directory: string;
  fixture: () => Promise<Buffer>;
  selectFiles: (paths: string[]) => { consumed: boolean };
  registerInput: (path: string) => Promise<string>;
  worker: DocumentWorkerClient;
  operations: DocumentOperations;
};

/** Runs only from --smoke-test, through real DOM events, preload, IPC and worker. */
export async function runWorkflowRegressionSmoke(window: BrowserWindow, context: Context): Promise<void> {
  const directory = join(context.directory, "workflow-regressions");
  await mkdir(directory, { recursive: true });
  const inputs = ["선택 A", "추가 B", "제외 C", "보고서 실패"].map(name => join(directory, `${name}.hwpx`));
  const originalHashes = new Map<string, string>();
  for (const path of inputs) {
    const bytes = await context.fixture();
    await writeFile(path, bytes);
    await context.registerInput(path);
    originalHashes.set(path, digest(bytes));
  }
  const sentinel = join(directory, "unrelated.txt");
  await writeFile(sentinel, "An unrelated file must survive every flow.");
  originalHashes.set(sentinel, digest(await readFile(sentinel)));
  const originalAnalyze = context.worker.analyze;
  const originalPrepare = context.worker.prepare;
  const completedCases: string[] = [];
  const evaluate = async <T = unknown>(script: string): Promise<T> => {
    const result = await window.webContents.executeJavaScript(`(async () => {
      try { return { value: await (${script}) }; }
      catch (error) { return { error: String(error?.stack || error) }; }
    })()`);
    if (result.error) throw new Error(result.error);
    return result.value as T;
  };
  const click = async (selector: string): Promise<void> => {
    await waitFor(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      return element && !element.disabled && element.checkVisibility({ visibilityProperty: true, opacityProperty: true });
    })()`);
    await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element || element.disabled || !element.checkVisibility({ visibilityProperty: true })) throw new Error("Unavailable control: " + ${JSON.stringify(selector)} + " " + JSON.stringify({ view: document.body.dataset.view, busy: document.body.dataset.busy, result: document.body.dataset.result, disabled: element?.disabled, detailsOpen: document.getElementById("analysis-details").open }));
      element.click();
    })()`);
  };
  const waitFor = async (condition: string): Promise<void> => {
    await evaluate(`new Promise((resolve, reject) => {
      const deadline = Date.now() + 15000;
      const poll = () => {
        try {
          if (${condition}) { resolve(); return; }
          if (Date.now() >= deadline) { reject(new Error("Workflow wait timed out: " + ${JSON.stringify(condition)})); return; }
          setTimeout(poll, 10);
        } catch (error) { reject(error); }
      };
      poll();
    })`);
  };
  const idle = () => waitFor(`!document.body.dataset.busy`);
  const select = async (paths: string[], empty = false, rows = 0): Promise<void> => {
    const selection = context.selectFiles(paths);
    await click(empty ? "#empty-choose-button" : "#choose-button");
    await until(() => selection.consumed);
    if (rows) await waitFor(`document.body.dataset.view === "batch" && document.querySelectorAll("#batch-list tr").length === ${rows} && !document.body.dataset.busy`);
    else if (paths.length) await waitFor(`document.body.dataset.view === "single" && document.getElementById("selected-file-name").textContent === ${JSON.stringify(basename(paths[0]))} && !document.body.dataset.busy && !document.getElementById("optimize-button").disabled`);
    else await idle();
  };
  const text = (id: string) => evaluate<string>(`document.getElementById(${JSON.stringify(id)}).textContent`);
  const reset = async (selector = "#start-over-button"): Promise<void> => {
    await click(selector);
    assert.equal(await evaluate(`document.body.dataset.view`), "empty");
    assert.equal(await evaluate(`document.activeElement.id`), "empty-choose-button");
  };
  const assertDock = async (action: string): Promise<void> => {
    assert.equal(await evaluate(`(() => {
      const dock = document.getElementById("run-dock");
      const button = document.getElementById("run-dock-button");
      const box = button.getBoundingClientRect();
      return dock.dataset.action === ${JSON.stringify(action)} &&
        button.checkVisibility({ visibilityProperty: true }) && !button.disabled &&
        box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth;
    })()`), true, `Next action must be available inside the viewport: ${action}`);
  };
  const preserved = async (): Promise<void> => {
    for (const [path, expected] of originalHashes) assert.equal(digest(await readFile(path)), expected, `Source changed: ${basename(path)}`);
  };
  const checked = async (name: string, test: () => Promise<void>): Promise<void> => {
    try { await test(); await preserved(); }
    catch (error) { throw new Error(`Desktop workflow "${name}": ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
    completedCases.push(name);
    console.log(JSON.stringify({ check: "desktop-workflow", name, passed: true }));
  };
  const assertPair = async (output: string, source: string): Promise<void> => {
    const bytes = await readFile(output);
    await verifyHwpxOutput(bytes, { original: await readFile(source), mode: "safe" });
    const report = JSON.parse(await readFile(`${output}.report.json`, "utf8"));
    assert.equal(report.kind, "optimization");
    assert.equal(report.originalSize, (await readFile(source)).length);
    assert.equal(report.optimizedSize, bytes.length);
  };
  const busyControls = async (): Promise<void> => {
    assert.equal(await evaluate(`["batch-clear", "start-over-button", "submission-limit-select"].every(id => document.getElementById(id).disabled)`), true, "Reset, clear and policy must remain disabled during work");
    assert.equal(await evaluate(`document.getElementById("cancel-button").disabled`), false);
    if (await evaluate(`document.getElementById("choose-button").getClientRects().length > 0`)) {
      const selection = context.selectFiles([inputs[1]]);
      await click("#choose-button");
      await until(() => selection.consumed);
      await waitFor(`document.getElementById("status-text").textContent.includes("처리 중에는 새 파일을 추가할 수 없습니다")`);
    }
    assert.equal(await text("selected-file-name"), basename(inputs[0]));
    assert.equal(await evaluate(`document.body.dataset.view`), "single");
  };

  try {
    // Fresh settings are loaded by the actual renderer; no renderer model is mocked.
    await evaluate(`window.hwpxOptimizer.saveSettings({ saveReport: true, preventOverwrite: false,
      saveNextToOriginal: true, defaultMode: "safe", preservationPreference: "preserve",
      batchTargetMode: "per-file", submissionLimit: { id: "mb40" } })`);
    const loaded = new Promise<void>(resolve => window.webContents.once("did-finish-load", () => resolve()));
    window.webContents.reload();
    await loaded;
    await waitFor(`document.body.dataset.appReady === "true"`);
    await evaluate(`(() => {
      window.__workflowErrors = [];
      window.addEventListener("error", event => window.__workflowErrors.push(event.message));
      window.addEventListener("unhandledrejection", event => window.__workflowErrors.push(String(event.reason)));
    })()`);

    await checked("cancelled chooser leaves the initial view unchanged", async () => {
      await select([], true);
      assert.equal(await evaluate(`document.body.dataset.view`), "empty");
      assert.equal(await evaluate(`document.querySelectorAll("#batch-list tr").length`), 0);
    });
    await checked("single selection starts actual analysis", async () => {
      await select([inputs[0]], true);
      await waitFor(`document.body.dataset.view === "single" && !document.getElementById("optimize-button").disabled`);
      assert.equal(await text("selected-file-name"), basename(inputs[0]));
      assert.match(await text("status-text"), /빠른 분석이 완료/);
      await assertDock("optimize");
    });

    await checked("cancel detailed analysis retains the plan and allows retry", async () => {
      const before = await tree(directory);
      const plan = await text("summary-result-line");
      const gate = abortGate();
      context.worker.analyze = async function (path, signal, mode) {
        const result = await originalAnalyze.call(this, path, signal, mode);
        gate.reached = true;
        await gate.wait(signal);
        return result;
      };
      await click("#analysis-detail-summary");
      await click("#deep-analysis-button");
      await until(() => gate.reached);
      await busyControls();
      await click("#cancel-button");
      await waitFor(`document.body.dataset.busy === "" && document.getElementById("status-text").textContent.includes("분석을 취소")`);
      context.worker.analyze = originalAnalyze;
      assert.equal(await text("summary-result-line"), plan);
      assert.equal(await evaluate(`document.activeElement.id`), "deep-analysis-button");
      assert.deepEqual(await tree(directory), before);
      await click("#deep-analysis-button");
      await waitFor(`document.body.dataset.busy === "" && document.getElementById("status-text").textContent.includes("상세 분석이 완료")`);
    });

    await checked("cancel optimization before publication leaves no files and enables retry", async () => {
      const before = await tree(directory);
      const gate = abortGate();
      context.worker.prepare = async function (input, signal, progress) {
        const result = await originalPrepare.call(this, input, signal, progress);
        gate.reached = true;
        await gate.wait(signal);
        return result;
      };
      await click("#run-dock-button");
      await until(() => gate.reached);
      await busyControls();
      await click("#cancel-button");
      await waitFor(`document.body.dataset.busy === "" && document.getElementById("status-text").textContent.includes("최적화를 취소")`);
      context.worker.prepare = originalPrepare;
      assert.equal(await evaluate(`document.getElementById("result-panel").hidden`), true);
      assert.equal(await evaluate(`document.getElementById("optimize-button").disabled`), false);
      assert.deepEqual(await tree(directory), before);
    });
    await checked("retry publishes a verified output and matching measured report", async () => {
      await click("#run-dock-button");
      await waitFor(`document.body.dataset.busy === "" && document.body.dataset.result === "visible"`);
      await assertPair(join(directory, "선택 A_optimized.hwpx"), inputs[0]);
      const before = await tree(directory);
      await assertDock("open-file");
      assert.equal(await evaluate(`document.getElementById("quality-controls").checkVisibility()`), false);
      assert.equal(await evaluate(`document.getElementById("submission-limit-select").disabled`), true);
      await click("#result-retry-button");
      await assertDock("optimize");
      assert.equal(await evaluate(`document.getElementById("result-panel").hidden`), true);
      assert.match(await text("summary-result-line"), /예상/);
      assert.match(await text("verification-body"), /이미지 품질 검증은 최적화 실행 시/);
      assert.equal(await evaluate(`document.getElementById("analysis-details").open`), false);
      assert.deepEqual(await tree(directory), before);
      await click("#run-dock-button");
      await waitFor(`document.body.dataset.busy === "" && document.body.dataset.result === "visible"`);
      await assertPair(join(directory, "선택 A_optimized.hwpx"), inputs[0]);
      const repeated = await tree(directory);
      await reset("#run-dock-start-over");
      assert.deepEqual(await tree(directory), repeated);
    });

    await checked("cancel batch analysis stops the remaining queue without changing files", async () => {
      const before = await tree(directory);
      const gate = abortGate();
      context.worker.analyze = async function (path, signal, mode) {
        const result = await originalAnalyze.call(this, path, signal, mode);
        gate.reached = true;
        await gate.wait(signal);
        return result;
      };
      const selection = context.selectFiles([inputs[0], inputs[1]]);
      await click("#empty-choose-button");
      await until(() => selection.consumed && gate.reached);
      assert.equal(await evaluate(`document.getElementById("start-over-button").disabled`), true);
      await click("#cancel-button");
      await waitFor(`!document.body.dataset.busy && Array.from(document.querySelectorAll("#batch-list .status")).filter(cell => cell.textContent === "취소").length === 2`);
      context.worker.analyze = originalAnalyze;
      assert.equal(await evaluate(`document.getElementById("batch-result-panel").hidden`), true);
      assert.deepEqual(await tree(directory), before);
      await reset();
    });

    await checked("add and deduplicate files, remove rows, promote to single and clear", async () => {
      await select([inputs[0]], true);
      await select([inputs[0]]);
      assert.equal(await evaluate(`document.body.dataset.view`), "single");
      await select([inputs[1]], false, 2);
      await waitFor(`document.body.dataset.view === "batch" && document.querySelectorAll("#batch-list tr").length === 2 && document.body.dataset.busy === ""`);
      await select([inputs[2], inputs[1]], false, 3);
      assert.equal(await evaluate(`document.querySelectorAll("#batch-list tr").length`), 3);
      assert.equal(await evaluate(`document.getElementById("preservation-select").value`), "preserve");
      await click('#batch-list button[data-action="remove"][data-index="2"]');
      assert.equal(await evaluate(`document.querySelectorAll("#batch-list tr").length`), 2);
      await click('#batch-list button[data-action="remove"][data-index="1"]');
      assert.equal(await evaluate(`document.body.dataset.view`), "single");
      assert.equal(await text("selected-file-name"), basename(inputs[0]));
      const before = await tree(directory);
      await click("#batch-clear");
      assert.equal(await evaluate(`document.body.dataset.view`), "empty");
      assert.deepEqual(await tree(directory), before);
    });

    await checked("single report failure publishes no partial result and permits a real retry", async () => {
      const output = join(directory, "보고서 실패_optimized.hwpx");
      await mkdir(`${output}.report.json`);
      const before = await tree(directory);
      await select([inputs[3]], true);
      await click("#run-dock-button");
      await idle();
      assert.equal(await evaluate(`document.getElementById("result-panel").hidden`), true);
      assert.doesNotMatch(await text("status-text"), /최적화가 완료/);
      assert.equal(await evaluate(`document.getElementById("optimize-button").disabled`), false);
      assert.deepEqual(await tree(directory), before);
      await rm(`${output}.report.json`, { recursive: true });
      await click("#run-dock-button");
      await waitFor(`document.body.dataset.busy === "" && document.body.dataset.result === "visible"`);
      await assertPair(output, inputs[3]);
      await reset();
    });

    const batchDirectory = join(directory, "output");
    const batchReport = join(batchDirectory, "batch-report.json");
    await checked("batch report failure remains visible and preserves completed document pairs", async () => {
      await mkdir(batchReport, { recursive: true });
      await select([inputs[0], inputs[1]], true, 2);
      await click("#run-dock-button");
      await waitFor(`document.body.dataset.busy === "" && document.body.dataset.batchResult === "visible" && document.getElementById("batch-result-panel").dataset.reportState !== "saving" && document.getElementById("batch-result-panel").hidden === false`);
      assert.match(await text("status-text"), /리포트를 저장하지 못했습니다/);
      assert.equal(await evaluate(`document.getElementById("status-banner").dataset.tone`), "warning");
      assert.equal(await evaluate(`document.getElementById("batch-open-report-button").disabled`), true);
      await assertPair(join(batchDirectory, "선택 A_optimized.hwpx"), inputs[0]);
      await assertPair(join(batchDirectory, "추가 B_optimized.hwpx"), inputs[1]);
      const before = await tree(directory);
      await reset();
      assert.deepEqual(await tree(directory), before);
      await rm(batchReport, { recursive: true });
    });
    await checked("cancel batch optimization retains prior outputs and retries from the analysis plan", async () => {
      await select([inputs[1], inputs[2]], true, 2);
      const before = await tree(directory);
      const gate = abortGate();
      context.worker.prepare = async function (input, signal, progress) {
        const result = await originalPrepare.call(this, input, signal, progress);
        gate.reached = true;
        await gate.wait(signal);
        return result;
      };
      await click("#run-dock-button");
      await until(() => gate.reached);
      await click("#cancel-button");
      await waitFor(`!document.body.dataset.busy && document.body.dataset.batchResult === "visible" && document.getElementById("batch-result-panel").dataset.reportState !== "saving"`);
      context.worker.prepare = originalPrepare;
      assert.match(await text("batch-result-panel"), /확인 필요/);
      await assertDock("review-results");
      assert.match(await text("policy-live"), /미완료/);
      await click("#run-dock-button");
      assert.equal(await evaluate(`document.activeElement.id`), "batch-result-title");
      const report = JSON.parse(await readFile(batchReport, "utf8"));
      assert.equal(report.totals.done, 0);
      assert.equal(report.totals.cancelled, 2);
      assert.equal(report.items.length, 2);
      const after = await tree(directory);
      delete after["output/batch-report.json"];
      assert.deepEqual(after, before);
      const completedFiles = await tree(directory);
      await click("#batch-retry-button");
      assert.equal(await evaluate(`document.getElementById("batch-result-panel").hidden`), true);
      assert.equal(await evaluate(`document.getElementById("optimize-button").disabled`), false);
      assert.match(await text("summary-result-line"), /예상/);
      assert.deepEqual(await tree(directory), completedFiles);
    });
    await checked("batch runs selected files only and writes a measured aggregate report", async () => {
      await click('#batch-list .batch-select[data-batch-index="1"]');
      assert.match(await text("summary-status"), /예상/);
      await assertDock("optimize");
      await click("#run-dock-button");
      await waitFor(`document.body.dataset.busy === "" && document.body.dataset.batchResult === "visible" && document.getElementById("batch-result-panel").dataset.reportState !== "saving" && !document.getElementById("batch-open-report-button").disabled`);
      const report = JSON.parse(await readFile(batchReport, "utf8"));
      assert.equal(report.totals.done, 1);
      assert.equal(report.items.length, 1);
      assert.equal(report.items[0].input, basename(inputs[1]));
      await assertPair(report.items[0].output, inputs[1]);
      assert.equal(report.totals.totalOptimizedSize, (await readFile(report.items[0].output)).length);
      assert.equal(await evaluate(`Array.from(document.querySelectorAll("#batch-list .status")).filter(cell => cell.textContent === "완료").length`), 1);
      assert.equal((await readdir(batchDirectory)).some(name => name.includes("제외 C")), false);
      await assertDock("open-folder");
      assert.equal(await evaluate(`document.getElementById("status-banner").dataset.tone`), "success");
    });
    assert.deepEqual(await evaluate(`window.__workflowErrors`), []);
    console.log(JSON.stringify({ check: "desktop-workflow-complete", cases: completedCases.length, sourceHashesVerified: originalHashes.size }));
  } finally {
    await context.operations.cancel();
    context.worker.analyze = originalAnalyze;
    context.worker.prepare = originalPrepare;
  }
}

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function tree(directory: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      result[entry.name + "/"] = "directory";
      for (const [child, hash] of Object.entries(await tree(path))) result[entry.name + "/" + child] = hash;
    } else result[entry.name] = digest(await readFile(path));
  }
  return result;
}

// Only the delivery boundary is paused, after the real worker has returned.
// Cancellation inside worker CPU phases and transaction rollback are covered by
// documentCancellation.test.ts, with real worker threads and exact phase gates.
function abortGate(): { reached: boolean; wait: (signal: AbortSignal) => Promise<void> } {
  return {
    reached: false,
    wait: async signal => {
      signal.throwIfAborted();
      await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
      signal.throwIfAborted();
    }
  };
}

async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error("Real worker did not reach the smoke delivery gate.");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
