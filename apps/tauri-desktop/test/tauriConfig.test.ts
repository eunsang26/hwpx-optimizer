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
      app?: { security?: { csp?: string } };
      bundle?: { externalBin?: string[]; icon?: string[]; resources?: Record<string, string>; targets?: string };
      productName?: string;
    };

    expect(tauriConfig.productName).toBe("HWPX Optimizer");
    expect(tauriConfig.app?.security?.csp).toContain("connect-src ipc: http://ipc.localhost");
    expect(tauriConfig.bundle?.targets).toBe("nsis");
    expect(tauriConfig.bundle?.externalBin).toContain("binaries/hwpx-sidecar");
    expect(tauriConfig.bundle?.resources?.["../dist/sidecar"]).toBe("sidecar");
    expect(tauriConfig.bundle?.resources?.["../../../packages/core/dist"]).toBe("node_modules/@hwpx-optimizer/core/dist");
    expect(tauriConfig.bundle?.resources?.["../../../node_modules/sharp"]).toBe("node_modules/sharp");
    expect(tauriConfig.bundle?.resources?.["../../../node_modules/@img"]).toBe("node_modules/@img");
    expect(tauriConfig.bundle?.icon).toEqual(["icons/icon.png", "icons/icon.ico"]);
    await expect(access("apps/tauri-desktop/src-tauri/src/main.rs")).resolves.toBeUndefined();
  });

  it("prepares target-triple sidecar binaries from the Node runtime", async () => {
    const packageJson = JSON.parse(await readFile("apps/tauri-desktop/package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };
    const script = await readFile("scripts/prepare-tauri-sidecar.mjs", "utf8");
    const rustMain = await readFile("apps/tauri-desktop/src-tauri/src/main.rs", "utf8");
    const cargoToml = await readFile("apps/tauri-desktop/src-tauri/Cargo.toml", "utf8");
    const capabilities = await readFile("apps/tauri-desktop/src-tauri/capabilities/default.json", "utf8");

    expect(packageJson.scripts?.["build:tauri"]).toContain("npm --prefix ../.. run desktop:icons");
    expect(packageJson.scripts?.dev).toContain("npm --prefix ../.. run desktop:icons");
    expect(packageJson.scripts?.["prepare-sidecar"]).toBe("node ../../scripts/prepare-tauri-sidecar.mjs");
    expect(script).toContain("hwpx-sidecar");
    expect(script).toContain("process.execPath");
    expect(script).toContain("x86_64-unknown-linux-gnu");
    expect(script).toContain("x86_64-pc-windows-msvc");
    expect(rustMain).toContain('.sidecar("hwpx-sidecar")');
    expect(rustMain).toContain("sidecar/index.js");
    expect(rustMain).toContain("child.kill()");
    expect(cargoToml).toContain("tauri-plugin-dialog");
    expect(capabilities).toContain("shell:allow-spawn");
    expect(capabilities).not.toContain("dialog:");
    expect(capabilities).not.toContain("shell:allow-open");
  });

  it("builds the Tauri frontend through Vite instead of shipping bare imports", async () => {
    const packageJson = JSON.parse(await readFile("apps/tauri-desktop/package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };
    const tsconfig = JSON.parse(await readFile("apps/tauri-desktop/tsconfig.json", "utf8")) as {
      references?: Array<{ path?: string }>;
    };
    const viteConfig = await readFile("apps/tauri-desktop/vite.config.ts", "utf8");

    expect(packageJson.scripts?.build).toContain("vite build --config vite.config.ts");
    expect(tsconfig.references).toContainEqual({ path: "../../packages/core" });
    expect(viteConfig).toContain('outDir: resolve(import.meta.dirname, "dist", "src")');
    expect(viteConfig).toContain("emptyOutDir: true");
  });

  it("pins reproducible Windows Tauri PoC CI inputs", async () => {
    const workflow = await readFile(".github/workflows/windows-release.yml", "utf8");

    expect(workflow).toContain('node-version: "20.20.2"');
    expect(workflow).toContain("tauri-size-report.txt");
    expect(workflow).toContain("Get-FileHash");
  });

  it("cleans Tauri build output before workspace builds", async () => {
    const cleanScript = await readFile("scripts/clean-build-artifacts.mjs", "utf8");

    expect(cleanScript).toContain('"apps/tauri-desktop/dist"');
    expect(cleanScript).toContain('"apps/tauri-desktop/tsconfig.tsbuildinfo"');
  });

  it("provides a browser adapter shaped like the Electron preload API", async () => {
    const adapter = await readFile("apps/tauri-desktop/src/tauriApi.ts", "utf8");

    expect(adapter).toContain('import { listen } from "@tauri-apps/api/event"');
    expect(adapter).toContain("window.hwpxOptimizer");
    expect(adapter).toContain('listen("hwpx:optimize-progress"');
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

  it("keeps generated-path actions implemented in the Rust shell instead of as PoC stubs", async () => {
    const rustMain = await readFile("apps/tauri-desktop/src-tauri/src/main.rs", "utf8");

    expect(rustMain).toContain('app.emit("hwpx:optimize-progress"');
    expect(rustMain).toContain('"saveBatchReport"');
    expect(rustMain).toContain('"previewImageDiffs"');
    expect(rustMain).toContain("Command::new");
    expect(rustMain).not.toContain("Batch report saving is outside the Tauri PoC scope.");
    expect(rustMain).not.toContain("showItem is outside the Tauri PoC scope");
    expect(rustMain).not.toContain("openPath is outside the Tauri PoC scope");
  });
});
