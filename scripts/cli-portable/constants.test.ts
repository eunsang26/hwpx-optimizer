import { describe, expect, it } from "vitest";
import {
  NODE_VERSION,
  SHARP_VERSION,
  SHARP_WIN32_PACKAGE,
  STAGE_DIR_NAME,
  ZIP_NAME,
  REQUIRED_WIN_SHARP_FILES
} from "./constants.mjs";

describe("cli-portable constants", () => {
  it("pins Node and sharp to the design floors", () => {
    expect(NODE_VERSION).toBe("20.20.2");
    expect(SHARP_VERSION).toBe("0.35.3");
    expect(SHARP_WIN32_PACKAGE).toBe("@img/sharp-win32-x64@0.35.3");
    expect(STAGE_DIR_NAME).toBe("hwpx-opt-win-x64");
    expect(ZIP_NAME).toBe("hwpx-opt-win-x64.zip");
    expect(REQUIRED_WIN_SHARP_FILES).toEqual([
      "sharp-win32-x64-0.35.3.node",
      "libvips-42.dll",
      "libvips-cpp-8.18.3.dll"
    ]);
  });
});
