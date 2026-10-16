import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import { DesktopDocumentController } from "../documentController.js";
import type { DocumentWorkerClient } from "../documentWorkerClient.js";
import type { SmokeSelection } from "./desktopSmoke.js";

type Context = { directory: string; fixture: () => Promise<Buffer>; worker: DocumentWorkerClient; selection: SmokeSelection };

/** Smoke-only native keyboard/IPC/filesystem checks; never loaded by ordinary startup. */
export async function runInteractionSmoke(window: BrowserWindow, context: Context): Promise<void> {
  const directory = join(context.directory, "interaction-regressions");
  await mkdir(directory, { recursive: true });
  const bytes = await context.fixture();
  const inputs = ["키보드 A.hwpx", "키보드 B.hwpx", "다음 C.hwpx"].map(name => join(directory, name));
  for (const path of inputs) await writeFile(path, bytes);
  const sourceHash = digest(bytes);
  const originalPrepare = context.worker.prepare;
  const originalReport = DesktopDocumentController.prototype.saveBatchReport;
  const wasVisible = window.isVisible();
  let release: (() => void) | undefined;
  let cases = 0;
  const evaluate = async <T = unknown>(script: string): Promise<T> => {
    const result = await window.webContents.executeJavaScript(`(async () => {
      try { return { value: await (${script}) }; } catch(error) { return { error: String(error?.stack || error) }; }
    })()`);
    if (result.error) throw new Error(result.error);
    return result.value;
  };
  const waitFor = async (predicate: () => Promise<unknown> | unknown): Promise<void> => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
    throw new Error("Interaction smoke wait timed out");
  };
  const waitDom = (predicate: string) => waitFor(() => evaluate(predicate));
  const key = async (keyCode: string, shift = false): Promise<void> => {
    window.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers: shift ? ["shift"] : [] });
    if (keyCode === "Enter") window.webContents.sendInputEvent({ type: "char", keyCode: "\r" });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers: shift ? ["shift"] : [] });
    await new Promise(resolve => setTimeout(resolve, 15));
  };
  const enter = async (id: string): Promise<void> => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(`document.activeElement.id === ${JSON.stringify(id)}`)) { await key("Enter"); return; }
      await key("Tab");
    }
    throw new Error(`Keyboard cannot reach ${id}`);
  };
  const choose = async (paths: string[]): Promise<void> => {
    context.selection.paths = paths; context.selection.delivery = { consumed: false };
    await enter("empty-choose-button");
    await waitDom(`document.getElementById("run-dock").hidden === false && !document.body.dataset.busy`);
  };
  const reset = async (): Promise<void> => {
    await enter("start-over-button");
    assert.equal(await evaluate(`document.activeElement.id`), "empty-choose-button");
  };
  const checked = async (name: string, test: () => Promise<void>): Promise<void> => {
    try { await test(); for (const path of inputs) assert.equal(digest(await readFile(path)), sourceHash); }
    catch(error) { throw new Error(`Interaction smoke "${name}": ${String(error)}`, { cause: error }); }
    cases++; console.log(JSON.stringify({ check: "desktop-interaction", name, passed: true }));
  };
  try {
    await evaluate(`window.hwpxOptimizer.saveSettings({ defaultMode: "balanced", preservationPreference: "recommended",
      saveReport: true, preventOverwrite: false, submissionLimit: { id: "mb40" }, batchTargetMode: "per-file" })`);
    const loaded = new Promise<void>(resolve => window.webContents.once("did-finish-load", () => resolve()));
    window.webContents.reload(); await loaded;
    window.show(); window.focus(); window.webContents.focus();
    await waitDom(`document.body.dataset.appReady === "true" && document.hasFocus()`);
    await evaluate(`(() => { window.__interactionErrors = []; window.addEventListener("error", e => window.__interactionErrors.push(e.message));
      window.addEventListener("unhandledrejection", e => window.__interactionErrors.push(String(e.reason))); })()`);
    await checked("native keyboard enters, confines and restores modal focus", async () => {
      await enter("settings-button");
      await waitDom(`document.getElementById("settings-panel").classList.contains("is-open")`);
      assert.equal(await evaluate(`document.activeElement.id`), "settings-close-button");
      for (let i = 0; i < 12; i++) {
        await key("Tab", i % 3 === 0);
        assert.equal(await evaluate(`document.getElementById("settings-panel").contains(document.activeElement)`), true);
      }
      assert.equal(await evaluate(`document.getElementById("single-workspace").inert`), true);
      assert.equal(await evaluate(`(() => { document.getElementById("empty-choose-button").focus(); return document.getElementById("settings-panel").contains(document.activeElement); })()`), true);
      await key("Escape"); assert.equal(await evaluate(`document.activeElement.id`), "settings-button");
      await enter("help-button"); await key("Escape");
      assert.equal(await evaluate(`document.activeElement.id`), "help-button");
    });
    await checked("keyboard starts real work, progress is named and focus stays with cancel", async () => {
      await choose([inputs[0]]);
      let reached = false;
      context.worker.prepare = async function(input, signal, progress) {
        const result = await originalPrepare.call(this, input, signal, progress);
        progress({ percent: 88, item: "Preparing output file" }); reached = true;
        await new Promise<void>(resolve => { release = resolve; signal.addEventListener("abort", () => resolve(), { once: true }); });
        signal.throwIfAborted(); return result;
      };
      await enter("run-dock-button"); await waitFor(() => reached);
      assert.equal(await evaluate(`document.activeElement.id`), "cancel-button");
      for (let i = 0; i < 3; i++) { await key("Tab"); assert.equal(await evaluate(`document.activeElement.id`), "cancel-button"); }
      assert.equal(await evaluate(`document.getElementById("single-workspace").inert`), true);
      assert.equal(await evaluate(`document.getElementById("progress-bar").getAttribute("aria-valuenow")`), "88");
      assert.match(await evaluate<string>(`document.getElementById("progress-bar").getAttribute("aria-valuetext")`), /결과 파일 저장/);
      assert.equal(await evaluate(`parseFloat(getComputedStyle(document.activeElement).outlineWidth) >= 2`), true);
      context.worker.prepare = originalPrepare; release!(); release = undefined;
      await waitDom(`!document.body.dataset.busy && document.body.dataset.result === "visible"`);
      assert.equal(await evaluate(`document.activeElement.id`), "run-dock-button");
      assert.match(await evaluate<string>(`document.getElementById("interaction-announcement").textContent`), /최적화가 완료/);
    });
    await checked("keyboard opens and closes the comparison dialog", async () => {
      await enter("compare-button"); await waitDom(`!document.getElementById("compare-modal").hidden`);
      assert.equal(await evaluate(`document.activeElement.id`), "compare-close");
      await key("Tab"); assert.equal(await evaluate(`document.activeElement.id`), "compare-close");
      await key("Escape"); assert.equal(await evaluate(`document.activeElement.id`), "compare-button");
    });
    await checked("failed summary can be retried without recompressing outputs", async () => {
      await reset(); const report = join(directory, "output", "batch-report.json"); await mkdir(report, { recursive: true });
      await choose([inputs[0], inputs[1]]); await enter("run-dock-button");
      await waitDom(`document.getElementById("batch-result-panel").dataset.reportState === "failed"`);
      const names = (await readdir(join(directory, "output"))).filter(name => name.endsWith(".hwpx"));
      const before = await Promise.all(names.map(async name => digest(await readFile(join(directory, "output", name)))));
      assert.match(await evaluate<string>(`document.getElementById("interaction-announcement").textContent`), /재시도/);
      await rm(report, { recursive: true }); await enter("batch-retry-report-button");
      await waitDom(`document.getElementById("batch-result-panel").dataset.reportState === "saved"`);
      assert.equal(await evaluate(`document.activeElement.id`), "batch-open-report-button");
      assert.deepEqual(await Promise.all(names.map(async name => digest(await readFile(join(directory, "output", name))))), before);
    });
    for (const fail of [false, true]) await checked(`late ${fail ? "failed" : "successful"} report cannot replace the next selection`, async () => {
      await reset();
      const work = join(directory, fail ? "late-error" : "late-success");await mkdir(work, { recursive: true });
      const paths = [join(work, "A.hwpx"), join(work, "B.hwpx")];for (const path of paths) await writeFile(path, bytes);
      if (fail) await mkdir(join(work, "output", "batch-report.json"), { recursive: true });
      let reached = false, finished = false, rejected = false;
      DesktopDocumentController.prototype.saveBatchReport = async function(input) {
        reached = true; await new Promise<void>(resolve => { release = resolve; });
        try { return await originalReport.call(this, input); }
        catch(error) { rejected = true; throw error; } finally { finished = true; }
      };
      await choose(paths);await enter("run-dock-button");await waitFor(() => reached);
      assert.equal(await evaluate(`document.getElementById("batch-result-panel").dataset.reportState`), "saving");
      await reset();await choose([inputs[2]]);
      const status = await evaluate(`document.getElementById("status-text").textContent`);
      DesktopDocumentController.prototype.saveBatchReport = originalReport;release!();release = undefined;
      await waitFor(() => finished); await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(rejected, fail);
      assert.equal(await evaluate(`document.getElementById("status-text").textContent`), status);
      assert.equal(await evaluate(`document.getElementById("selected-file-name").textContent`), "다음 C.hwpx");
      assert.equal(await evaluate(`document.getElementById("batch-result-panel").hidden`), true);
      for (const path of paths) assert.equal(digest(await readFile(path)), sourceHash);
    });
    assert.deepEqual(await evaluate(`window.__interactionErrors`), []);
    console.log(JSON.stringify({ check: "desktop-interaction-complete", cases }));
  } finally {
    release?.(); context.worker.prepare = originalPrepare; DesktopDocumentController.prototype.saveBatchReport = originalReport;
    if (!wasVisible) window.hide();
  }
}
function digest(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
