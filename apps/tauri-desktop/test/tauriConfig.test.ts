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
    expect(packageJson.scripts?.["tauri:sidecar:prepare"]).toBe("node scripts/prepare-tauri-sidecar.mjs");
  });

  it("declares the Tauri bundle and Node sidecar contract", async () => {
    const tauriConfig = JSON.parse(await readFile("apps/tauri-desktop/src-tauri/tauri.conf.json", "utf8")) as {
      bundle?: { externalBin?: string[]; targets?: string };
      productName?: string;
    };

    expect(tauriConfig.productName).toBe("HWPX Optimizer");
    expect(tauriConfig.bundle?.targets).toBe("nsis");
    expect(tauriConfig.bundle?.externalBin).toContain("binaries/hwpx-sidecar");
    expect(JSON.stringify(tauriConfig.bundle)).toContain("../dist/sidecar");
    await expect(access("apps/tauri-desktop/src-tauri/src/main.rs")).resolves.toBeUndefined();
  });

  it("prepares target-triple sidecar binaries from the Node runtime", async () => {
    const packageJson = JSON.parse(await readFile("apps/tauri-desktop/package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };
    const script = await readFile("scripts/prepare-tauri-sidecar.mjs", "utf8");
    const rustMain = await readFile("apps/tauri-desktop/src-tauri/src/main.rs", "utf8");

    expect(packageJson.scripts?.["prepare-sidecar"]).toBe("node ../../scripts/prepare-tauri-sidecar.mjs");
    expect(script).toContain("hwpx-sidecar");
    expect(script).toContain("process.execPath");
    expect(script).toContain("x86_64-unknown-linux-gnu");
    expect(script).toContain("x86_64-pc-windows-msvc");
    expect(rustMain).toContain('.sidecar("hwpx-sidecar")');
    expect(rustMain).toContain("sidecar/index.js");
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
