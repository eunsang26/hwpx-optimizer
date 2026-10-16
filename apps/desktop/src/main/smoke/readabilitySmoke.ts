import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import type { SmokeSelection } from "./desktopSmoke.js";
import { DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT } from "../../shared/windowConfig.js";

type Context = { directory: string; fixture: () => Promise<Buffer>; selection: SmokeSelection };

/** Real layout/AX checks at desktop and magnified viewports, including the packaged app. */
export async function runReadabilitySmoke(window: BrowserWindow, context: Context): Promise<void> {
  const directory = join(context.directory, "readability-regressions");
  await mkdir(directory, { recursive: true });
  const bytes = await context.fixture();
  const longName = `합성_제출자료_${"긴파일명검증".repeat(9)}.hwpx`;
  const input = join(directory, longName), other = join(directory, "두 번째.hwpx"), broken = join(directory, "손상.hwpx");
  const invalid = Buffer.from("synthetic invalid ZIP");
  await writeFile(input, bytes); await writeFile(other, bytes); await writeFile(broken, invalid);
  const originalBounds = window.getContentBounds(), originalZoom = window.webContents.getZoomFactor();
  const wasVisible = window.isVisible();
  const evaluate = <T = unknown>(script: string): Promise<T> => window.webContents.executeJavaScript(`(async () => (${script}))()`);
  const waitFor = async (condition: string): Promise<void> => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await evaluate(condition)) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`Readability smoke timed out: ${condition}`);
  };
  const click = async (id: string): Promise<void> => {
    await evaluate(`(() => {
      const element = document.getElementById(${JSON.stringify(id)});
      element.scrollIntoView({ block: "center", inline: "nearest" });
      element.click();
    })()`);
  };
  const choose = async (paths: string[]): Promise<void> => {
    context.selection.paths = paths; context.selection.delivery = { consumed: false };
    await click("empty-choose-button");
    await waitFor(`!document.body.dataset.busy && !document.getElementById("run-dock").hidden`);
  };
  const sizes = [[DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT, 1],
    ...[0.75, 1, 1.25, 1.5, 1.75, 2, 2.25].map(zoom => [MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT, zoom])];
  const matrix = async (name: string, planned: boolean): Promise<void> => {
    for (const [width, height, zoom] of sizes) {
      window.setContentSize(width, height); window.webContents.setZoomFactor(zoom);
      await new Promise(resolve => setTimeout(resolve, 30));
      const geometry = await evaluate<Record<string, unknown>>(`(() => {
        const workspace = document.getElementById("single-workspace"), dock = document.getElementById("run-dock");
        const box = workspace.getBoundingClientRect(), footer = dock.getBoundingClientRect();
        const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }; };
        const header = document.querySelector(".local-strip").getBoundingClientRect();
        return { rootFits: document.documentElement.scrollWidth <= innerWidth + 1 && document.body.scrollLeft === 0,
          workspaceFits: workspace.scrollWidth <= workspace.clientWidth + 1 && box.height > 30,
          headerFits: header.left >= 0 && header.right <= innerWidth + 1,
          footerFits: dock.hidden || (footer.left >= 0 && footer.right <= innerWidth + 1 && footer.bottom <= innerHeight + 1 && footer.top >= box.bottom),
          singlePrimary: ${planned} ? !document.getElementById("optimize-button").checkVisibility() && !dock.hidden : dock.hidden,
          viewport: { width: innerWidth, height: innerHeight }, workspace: rect(workspace), footer: rect(dock) };
      })()`);
      for (const key of ["rootFits", "workspaceFits", "headerFits", "footerFits", "singlePrimary"]) {
        assert.equal(geometry[key], true, `${name} ${width}x${height} @${zoom}: ${JSON.stringify(geometry)}`);
      }
      const controls = planned ? ["run-dock-button", "settings-button", "help-button"] : ["empty-choose-button", "empty-folder-button", "settings-button", "help-button"];
      for (const id of controls) {
        assert.equal(await evaluate(`(() => {
          const element = document.getElementById(${JSON.stringify(id)});
          element.scrollIntoView({ block: "center", inline: "nearest" });
          const r = element.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return !element.disabled && r.width >= 24 && r.height >= 24 && r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1 && (hit === element || element.contains(hit));
        })()`), true, `Unreachable or small ${id}: ${name} @${zoom}`);
      }
    }
  };
  let cases = 0;
  try {
    window.show(); window.focus(); window.webContents.focus();
    await waitFor("document.hasFocus()");
    await click("start-over-button");
    await matrix("empty", false); cases++;
    window.webContents.setZoomFactor(1);
    for (const [keyCode, expected] of [["+", 1.25], ["-", 1], ["-", 0.75], ["0", 1]] as const) {
      window.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers: ["control"] });
      window.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers: ["control"] });
      await waitFor(`Math.abs(innerWidth - ${MIN_WINDOW_WIDTH / expected}) < 2`);
      assert.ok(Math.abs(window.webContents.getZoomFactor() - expected) < 1e-9);
    }
    console.log(JSON.stringify({ check: "desktop-readability", name: "empty/import controls and native zoom shortcuts fit at 75–225%", passed: true }));
    window.webContents.setZoomFactor(1); await choose([input]);
    await matrix("long single plan", true);
    assert.equal(await evaluate(`(() => { const e = document.getElementById("selected-file-name"); return e.textContent === ${JSON.stringify(longName)} && e.scrollWidth <= e.clientWidth + 1; })()`), true);
    await click("run-dock-button");
    await waitFor(`!document.body.dataset.busy && document.body.dataset.result === "visible"`);
    await matrix("single result", true); cases++;
    console.log(JSON.stringify({ check: "desktop-readability", name: "long single input and completed actions remain available without overlap", passed: true }));
    window.webContents.setZoomFactor(1); await click("start-over-button"); await choose([input, other, broken]);
    await matrix("partial batch plan", true); await click("run-dock-button");
    await waitFor(`!document.body.dataset.busy && document.getElementById("batch-result-panel").dataset.reportState !== "saving" && document.body.dataset.batchResult === "visible"`);
    await matrix("partial batch result", true);
    assert.equal(await evaluate(`document.getElementById("gauge-mid-label").textContent`), "2/3");
    await click("settings-button");
    await evaluate(`(() => {
      const select = document.getElementById("setting-submission-limit");
      select.value = "custom"; select.dispatchEvent(new Event("change", { bubbles: true }));
      const input = document.getElementById("setting-custom-limit-input");
      input.value = ""; input.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await waitFor(`document.getElementById("setting-custom-limit-input").getAttribute("aria-invalid") === "true"`);
    await click("settings-close-button");
    assert.equal(await evaluate(`document.getElementById("run-dock-button").disabled`), false);
    await click("run-dock-button");
    assert.equal(await evaluate(`document.activeElement.id`), "batch-result-title");
    const attachedHere = !window.webContents.debugger.isAttached();
    try {
      if (attachedHere) window.webContents.debugger.attach("1.3");
      const tree = await window.webContents.debugger.sendCommand("Accessibility.getFullAXTree");
      assert.equal(tree.nodes.filter((node: { ignored?: boolean; role?: { value?: string } }) => !node.ignored && node.role?.value === "table").length, 1);
      assert.equal(tree.nodes.filter((node: { ignored?: boolean; role?: { value?: string } }) => !node.ignored && node.role?.value === "rowheader").length, 3);
    } finally { if (attachedHere) window.webContents.debugger.detach(); }
    assert.equal(await evaluate(`document.getElementById("batch-result-panel").dataset.tone`), "warning");
    await click("settings-button");
    await evaluate(`(() => { const select = document.getElementById("setting-submission-limit");
      select.value = "mb40"; select.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await click("settings-close-button");
    cases++;
    console.log(JSON.stringify({ check: "desktop-readability", name: "batch cards retain table accessibility and partial-result actions at 320 CSS pixels", passed: true }));
    const digest = (value: Buffer) => createHash("sha256").update(value).digest("hex");
    assert.equal(digest(await readFile(input)), digest(bytes)); assert.equal(digest(await readFile(other)), digest(bytes));
    assert.equal(digest(await readFile(broken)), digest(invalid));
    console.log(JSON.stringify({ check: "desktop-readability-complete", cases, viewportCases: sizes.length * 5 }));
  } finally {
    window.webContents.setZoomFactor(originalZoom);
    window.setContentSize(originalBounds.width, originalBounds.height);
    if (!wasVisible) window.hide();
  }
}
