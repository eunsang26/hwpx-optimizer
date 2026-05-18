import { access, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Tauri desktop scaffold", () => {
  it("is registered as a workspace with top-level scripts", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts?: Record<string, string>;
      workspaces?: string[];
    };

    expect(packageJson.workspaces).toContain("apps/tauri-desktop");
    expect(packageJson.scripts?.["tauri:dev"]).toBe("npm run dev -w @hwpx-optimizer/tauri-desktop");
    expect(packageJson.scripts?.["tauri:build"]).toBe("npm run build:tauri -w @hwpx-optimizer/tauri-desktop");
    expect(packageJson.scripts?.["tauri:sidecar"]).toBe("npm run sidecar -w @hwpx-optimizer/tauri-desktop");
  });

  it("declares the Tauri bundle and Node sidecar contract", async () => {
    const tauriConfig = JSON.parse(await readFile("apps/tauri-desktop/src-tauri/tauri.conf.json", "utf8")) as {
      bundle?: { externalBin?: string[]; targets?: string };
      productName?: string;
    };

    expect(tauriConfig.productName).toBe("HWPX Optimizer");
    expect(tauriConfig.bundle?.targets).toBe("nsis");
    expect(tauriConfig.bundle?.externalBin).toContain("binaries/hwpx-sidecar");
    await expect(access("apps/tauri-desktop/src-tauri/src/main.rs")).resolves.toBeUndefined();
  });

  it("provides a browser adapter shaped like the Electron preload API", async () => {
    const adapter = await readFile("apps/tauri-desktop/src/tauriApi.ts", "utf8");

    expect(adapter).toContain("window.hwpxOptimizer");
    for (const method of [
      "selectHwpx",
      "selectHwpxMany",
      "selectDirectory",
      "loadSettings",
      "saveSettings",
      "analyze",
      "optimize",
      "verify",
      "showItem",
      "openPath"
    ]) {
      expect(adapter).toContain(`${method}:`);
    }
  });
});
