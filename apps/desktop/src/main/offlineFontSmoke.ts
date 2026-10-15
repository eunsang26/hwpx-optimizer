import type { BrowserWindow } from "electron";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

/** Test-only proof after external requests were verified blocked before navigation. */
export async function assertOfflineBundledFonts(window: BrowserWindow, packaged: boolean): Promise<void> {
  const debuggerApi = window.webContents.debugger;
  const assets = await Promise.all(["PretendardVariable.woff2", "OFL.txt"].map(async file => {
    const data = await readFile(new URL(`../fonts/${file}`, import.meta.url));
    if (!data.length) throw new Error(`Desktop font smoke failed: empty ${file}`);
    return { file, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") };
  }));
  try {
    // Do not accept a computed font-family alone: it can name a failed web font.
    const loaded = await window.webContents.executeJavaScript(`
      (async () => {
        await document.fonts.ready;
        const text = "한글 문서 압축 ABC0123";
        const probes = [];
        for (const weight of [400, 700]) {
          const faces = await document.fonts.load(weight + ' 16px "Pretendard Variable"', text);
          if (!faces.length || faces.some(face => face.status !== "loaded")) throw new Error("Bundled font did not load");
          const probe = document.createElement("span");
          probe.id = "font-smoke-" + weight;
          probe.textContent = text;
          probe.style.cssText = "position:fixed;left:0;top:0;font-size:16px;pointer-events:none";
          probe.style.fontFamily = getComputedStyle(document.body).fontFamily;
          probe.style.fontWeight = String(weight);
          document.body.append(probe);
          probes.push(probe.id);
        }
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return { probes, fontUrl: new URL("./fonts/PretendardVariable.woff2", document.baseURI).href };
      })()
    `) as { probes: string[]; fontUrl: string };
    if (!loaded.fontUrl.startsWith("file:")) throw new Error("Desktop font smoke failed: font is not a local file");

    debuggerApi.attach("1.3");
    await debuggerApi.sendCommand("DOM.enable");
    await debuggerApi.sendCommand("CSS.enable");
    const { root } = await debuggerApi.sendCommand("DOM.getDocument");
    const rendered = [];
    for (const id of loaded.probes) {
      const { nodeId } = await debuggerApi.sendCommand("DOM.querySelector", { nodeId: root.nodeId, selector: `#${id}` });
      const { fonts } = await debuggerApi.sendCommand("CSS.getPlatformFontsForNode", { nodeId }) as {
        fonts: Array<{ familyName: string; isCustomFont: boolean; glyphCount: number }>;
      };
      const used = fonts.filter(font => font.glyphCount > 0);
      if (!used.length || used.some(font => !font.isCustomFont || !/^Pretendard/i.test(font.familyName))) {
        throw new Error(`Desktop font smoke failed: fallback font rendered ${id}: ${JSON.stringify(used)}`);
      }
      rendered.push({ weight: Number(id.split("-").at(-1)), fonts: used });
    }
    console.log(JSON.stringify({ check: "offline-bundled-font", packaged, externalNetworkBlocked: true,
      networkEmulation: true,
      fontUrl: loaded.fontUrl, assets, rendered }));
  } finally {
    if (debuggerApi.isAttached()) debuggerApi.detach();
    await window.webContents.executeJavaScript(`
      for (const id of ["font-smoke-400", "font-smoke-700"]) document.getElementById(id)?.remove();
    `);
  }
}
