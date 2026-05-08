import { describe, expect, it, vi } from "vitest";

vi.mock("@hwpx-optimizer/core", () => {
  throw new Error("core should not be loaded while importing the desktop service module");
});

describe("desktop service startup", () => {
  it("does not load the core optimizer during module import", async () => {
    const service = await import("../src/main/desktopService.js");

    expect(service.defaultDesktopSettings.defaultMode).toBe("safe");
  });
});
