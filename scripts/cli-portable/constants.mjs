import { SHARP_VERSION, SHARP_WIN32_PACKAGE } from "../sharpPin.mjs";

export { SHARP_VERSION, SHARP_WIN32_PACKAGE };

export const NODE_VERSION = "20.20.2";
export const STAGE_DIR_NAME = "hwpx-opt-win-x64";
export const ZIP_NAME = "hwpx-opt-win-x64.zip";
export const REQUIRED_WIN_SHARP_FILES = [
  "sharp-win32-x64-0.35.3.node",
  "libvips-42.dll",
  "libvips-cpp-8.18.3.dll"
];
export const FORBIDDEN_SHARP_DIR_SUBSTRINGS = [
  "sharp-linux",
  "sharp-libvips-linux",
  "sharp-darwin",
  "sharp-wasm"
];
