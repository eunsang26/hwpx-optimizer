import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("CommonJS preload bridge", () => {
  it("exposes the same analysis cancellation and preview APIs used by the renderer", async () => {
    const source = await readFile(join(process.cwd(), "apps", "desktop", "src", "preload.cjs"), "utf8");
    const invokedChannels: string[] = [];
    let exposedApi: Record<string, unknown> | undefined;
    const fakeElectron = {
      contextBridge: {
        exposeInMainWorld: (_name: string, api: Record<string, unknown>) => {
          exposedApi = api;
        }
      },
      ipcRenderer: {
        invoke: (channel: string, payload?: unknown) => {
          invokedChannels.push(channel);
          return Promise.resolve(payload ?? null);
        },
        on: () => undefined,
        off: () => undefined
      },
      webUtils: {
        getPathForFile: () => "/tmp/a.hwpx"
      }
    };

    const runPreload = new Function("require", source);
    runPreload((name: string) => {
      if (name !== "electron") throw new Error(`Unexpected require: ${name}`);
      return fakeElectron;
    });

    expect(typeof exposedApi?.cancelAnalyze).toBe("function");
    expect((exposedApi?.getPathForFile as (file: File) => string)({} as File)).toBe("/tmp/a.hwpx");
    await (exposedApi?.cancelAnalyze as () => Promise<unknown>)();
    await (exposedApi?.previewImageDiffs as (input: unknown) => Promise<unknown>)({
      originalPath: "/tmp/original.hwpx",
      optimizedPath: "/tmp/optimized.hwpx",
      maxInputBytes: 10
    });

    expect(invokedChannels).toContain("hwpx:cancel-analyze");
    expect(invokedChannels).toContain("hwpx:image-preview");
  });

  it("exposes a dedicated dropped-file registration API before renderer analysis", async () => {
    const source = await readFile(join(process.cwd(), "apps", "desktop", "src", "preload.cjs"), "utf8");
    const invokedChannels: string[] = [];
    let exposedApi: Record<string, unknown> | undefined;
    const fakeElectron = {
      contextBridge: {
        exposeInMainWorld: (_name: string, api: Record<string, unknown>) => {
          exposedApi = api;
        }
      },
      ipcRenderer: {
        invoke: (channel: string, payload?: unknown) => {
          invokedChannels.push(channel);
          return Promise.resolve(payload ?? null);
        },
        on: () => undefined,
        off: () => undefined
      },
      webUtils: {
        getPathForFile: () => "/tmp/a.hwpx"
      }
    };

    const runPreload = new Function("require", source);
    runPreload((name: string) => {
      if (name !== "electron") throw new Error(`Unexpected require: ${name}`);
      return fakeElectron;
    });

    await (exposedApi?.registerDroppedHwpxFiles as (files: File[]) => Promise<unknown>)([{} as File]);

    expect(typeof exposedApi?.registerDroppedHwpxFiles).toBe("function");
    expect(invokedChannels).toContain("hwpx:register-dropped-paths");
  });
});
