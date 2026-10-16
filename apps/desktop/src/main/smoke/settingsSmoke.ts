import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, readFile, rename, rmdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import type { SmokeSelection } from "./desktopSmoke.js";
import type { DesktopSettingsSnapshot } from "../../shared/desktopSettings.js";

/** Exercises recovery and save failures through real renderer events and settings IPC. */
export async function runSettingsSmoke(window: BrowserWindow, userData: string, inputPath: string, selection: SmokeSelection): Promise<void> {
  const path = join(userData, "settings.json");
  const backup = join(userData, "settings-smoke-backup.json");
  const original = await readFile(path);
  let blocked = false;
  let cases = 0;
  const evaluate = async <T = unknown>(script: string): Promise<T> => {
    const result = await window.webContents.executeJavaScript(`(async () => {
      try { return { value: await (${script}) }; }
      catch (error) { return { error: String(error?.stack || error) }; }
    })()`);
    if (result.error) throw new Error(result.error);
    return result.value;
  };
  const waitFor = async (condition: string): Promise<void> => {
    await evaluate(`new Promise((resolve, reject) => {
      const deadline = Date.now() + 15000;
      const poll = () => {
        if (${condition}) { resolve(); return; }
        if (Date.now() >= deadline) { reject(new Error("Settings smoke timed out: " + ${JSON.stringify(condition)})); return; }
        setTimeout(poll, 10);
      }; poll();
    })`);
  };
  const click = (id: string) => evaluate(`(() => {
    const element = document.getElementById(${JSON.stringify(id)});
    if (!element || element.disabled || !element.checkVisibility({ visibilityProperty: true })) throw new Error("Unavailable settings control: " + ${JSON.stringify(id)});
    element.click();
  })()`);
  const reload = async (): Promise<void> => {
    const loaded = once(window.webContents, "did-finish-load", { signal: AbortSignal.timeout(15000) });
    window.webContents.reload(); await loaded;
    await waitFor(`document.body.dataset.appReady === "true"`);
    await evaluate(`(() => {
      window.__settingsErrors = [];
      window.addEventListener("error", event => window.__settingsErrors.push(event.message));
      window.addEventListener("unhandledrejection", event => window.__settingsErrors.push(String(event.reason)));
    })()`);
  };
  const checked = async (name: string, test: () => Promise<void>): Promise<void> => {
    try { await test(); assert.deepEqual(await evaluate(`window.__settingsErrors`), []); }
    catch (error) { throw new Error(`Settings smoke "${name}": ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
    cases += 1;
    console.log(JSON.stringify({ check: "desktop-settings", name, passed: true }));
  };
  const saved = () => evaluate<DesktopSettingsSnapshot>(`window.hwpxOptimizer.loadSettings()`);
  const editLimit = (id: string, value: string) => evaluate(`(() => {
    const input = document.getElementById(${JSON.stringify(id)});
    input.value = ${JSON.stringify(value)};
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  try {
    await writeFile(path, "{broken"); await reload();
    await checked("corrupt settings are disclosed and repaired by an explicit UI save", async () => {
      assert.equal((await saved()).settingsNotice?.kind, "recovered");
      assert.equal(await evaluate(`document.getElementById("settings-notice").hidden`), false);
      assert.equal(await readFile(path, "utf8"), "{broken");
      await click("settings-button"); await click("setting-save-report");
      await waitFor(`document.getElementById("settings-notice").hidden`);
      assert.equal(JSON.parse(await readFile(path, "utf8")).saveReport, true);
      await click("settings-close-button");
      const partial = JSON.stringify({ settingsVersion: 3, defaultMode: "safe", preservationPreference: "recommended",
        submissionLimit: { id: "custom", customBytes: -1 } });
      await writeFile(path, partial); await reload();
      assert.equal((await saved()).settingsNotice?.kind, "recovered");
      assert.equal(await readFile(path, "utf8"), partial);
      await click("settings-button"); await click("setting-save-report");
      await waitFor(`document.getElementById("settings-notice").hidden`);
      await click("settings-close-button");
    });
    const legacy = JSON.stringify({ defaultMode: "safe", preservationPreference: "recommended", submissionLimit: { id: "mb41", ignored: "synthetic" } });
    await writeFile(path, legacy); await reload();
    await checked("legacy settings migrate with guidance and persist the current schema", async () => {
      const settings = await saved();
      assert.equal(settings.settingsNotice?.kind, "migrated"); assert.equal(settings.defaultMode, "balanced");
      assert.equal(settings.submissionLimit.id, "mb40");
      assert.equal(await readFile(path, "utf8"), legacy);
      await click("settings-button"); await click("setting-save-report");
      await waitFor(`document.getElementById("settings-notice").hidden`);
      const disk = JSON.parse(await readFile(path, "utf8"));
      assert.equal(disk.settingsVersion, 3); assert.deepEqual(disk.submissionLimit, { id: "mb40" });
      await click("settings-close-button");
    });
    await checked("invalid custom limits cannot become unlimited or overwrite the last valid limit", async () => {
      selection.paths = [inputPath];
      await click("empty-choose-button");
      await waitFor(`document.body.dataset.view === "single" && !document.body.dataset.busy && !document.getElementById("optimize-button").disabled`);
      await evaluate(`(() => {
        const select = document.getElementById("submission-limit-select");
        select.value = "custom"; select.dispatchEvent(new Event("change", { bubbles: true }));
      })()`);
      await saved();
      await editLimit("custom-limit-input", "0.5"); await saved();
      assert.equal((await saved()).submissionLimit.customBytes, 524288);
      const before = await readFile(path);
      await editLimit("custom-limit-input", "0");
      assert.equal(await evaluate(`document.getElementById("custom-limit-input").getAttribute("aria-invalid")`), "true");
      assert.equal(await evaluate(`document.getElementById("custom-limit-error").hidden`), false);
      assert.equal(await evaluate(`document.getElementById("optimize-button").disabled`), true);
      assert.deepEqual(await readFile(path), before);
      await editLimit("custom-limit-input", "0.00000095367431640625"); await saved();
      assert.equal((await saved()).submissionLimit.customBytes, 1);
      assert.equal(await evaluate(`Number(document.getElementById("custom-limit-input").value) > 0`), true);
      assert.equal(await evaluate(`document.getElementById("hero-chips").textContent.includes("1 B")`), true);
      await click("settings-button");
      await editLimit("setting-custom-limit-input", "1048577");
      assert.equal(await evaluate(`document.getElementById("setting-custom-limit-input").getAttribute("aria-invalid")`), "true");
      assert.equal((await saved()).submissionLimit.customBytes, 1);
      await editLimit("setting-custom-limit-input", "0.5"); await saved();
      await click("settings-close-button");
      await waitFor(`!document.getElementById("optimize-button").disabled`);
      assert.equal((await saved()).submissionLimit.customBytes, 524288);
    });
    await checked("failed settings save stays visible without an unhandled rejection and can be retried", async () => {
      const before = await readFile(path);
      await rename(path, backup); await mkdir(path); blocked = true;
      await click("settings-button"); await click("setting-save-report");
      await waitFor(`!document.getElementById("settings-notice").hidden && document.getElementById("settings-notice-text").textContent.includes("읽지 못해")`);
      assert.deepEqual(await readFile(backup), before);
      await rmdir(path); await rename(backup, path); blocked = false;
      await click("setting-save-report");
      await waitFor(`document.getElementById("settings-notice").hidden`);
      assert.equal(JSON.parse(await readFile(path, "utf8")).saveReport, true);
      await click("settings-close-button");
    });
    console.log(JSON.stringify({ check: "desktop-settings-complete", cases }));
  } finally {
    if (blocked) { await rmdir(path); await rename(backup, path); }
    await writeFile(path, original);
  }
}
