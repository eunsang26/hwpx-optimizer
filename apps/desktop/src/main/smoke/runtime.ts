import type { App, BrowserWindow, session as SessionApi } from "electron";
import { join } from "node:path";
import type { DesktopDocumentController } from "../documentController.js";
import { runDesktopSmoke, type SmokeSelection } from "./desktopSmoke.js";

/** Loaded only in smoke mode; production startup does not load test scenarios. */
export function createDesktopSmokeRuntime(app: App, session: typeof SessionApi) {
  const selection: SmokeSelection = {};
  let blockedRequests = 0;
  app.setPath("userData", join(process.cwd(), ".tmp", "electron-smoke"));
  app.on("child-process-gone", (_event, details) => console.error(JSON.stringify({
    check: "smoke-child-process-gone", type: details.type, reason: details.reason, exitCode: details.exitCode
  })));
  return {
    selection,
    requestBlocked(url: string): void {
      if (url === "https://font-smoke.invalid/blocked-check") blockedRequests += 1;
    },
    observeWindow(window: BrowserWindow): void {
      window.webContents.on("render-process-gone", (_event, details) => console.error(JSON.stringify({
        check: "smoke-render-process-gone", reason: details.reason, exitCode: details.exitCode
      })));
      window.webContents.on("did-fail-load", (_event, errorCode, description, url, isMainFrame) => console.error(JSON.stringify({
        check: "smoke-load-failed", errorCode, description, url, isMainFrame
      })));
    },
    async prepareSession(): Promise<void> {
      const before = blockedRequests;
      let connected = false;
      try { await session.defaultSession.fetch("https://font-smoke.invalid/blocked-check"); connected = true; }
      catch { /* Expected cancellation before any DNS/socket attempt. */ }
      if (connected || blockedRequests !== before + 1) throw new Error("Desktop smoke failed: external network policy did not cancel the probe.");
      console.log(JSON.stringify({ check: "external-network-block", packaged: app.isPackaged, blocked: true }));
      session.defaultSession.enableNetworkEmulation({ offline: true });
    },
    async run(window: BrowserWindow, documents: DesktopDocumentController): Promise<void> {
      await runDesktopSmoke(window, { app, permissions: documents.permissions,
        worker: documents.worker, operations: documents.operations, selection });
      console.log(JSON.stringify({ check: "desktop-smoke-complete", packaged: app.isPackaged }));
    }
  };
}
