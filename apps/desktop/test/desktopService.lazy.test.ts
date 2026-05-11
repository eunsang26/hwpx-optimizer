import { describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("@hwpx-optimizer/core", () => {
  throw new Error("core should not be loaded while importing the desktop service module");
});

describe("desktop service startup", () => {
  it("does not load the core optimizer during module import", async () => {
    const service = await import("../src/main/desktopService.js");

    expect(service.defaultDesktopSettings.defaultMode).toBe("balanced");
  });

  it("rejects oversized image previews before loading the core optimizer", async () => {
    const service = await import("../src/main/desktopService.js");
    const dir = await mkdtemp(join(tmpdir(), "hwpx-preview-lazy-"));
    const originalPath = join(dir, "original.hwpx");
    const optimizedPath = join(dir, "optimized.hwpx");
    await writeFile(originalPath, Buffer.alloc(8));
    await writeFile(optimizedPath, Buffer.alloc(8));

    await expect(service.previewImageDiffs(originalPath, optimizedPath, { maxInputBytes: 10 })).rejects.toThrow(
      "too large for image preview"
    );
  });
});
