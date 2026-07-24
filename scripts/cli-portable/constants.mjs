export const NODE_VERSION = "20.20.2";
export const SHARP_VERSION = "0.33.5";
export const SHARP_WIN32_PACKAGE = `@img/sharp-win32-x64@${SHARP_VERSION}`;
export const STAGE_DIR_NAME = "hwpx-opt-win-x64";
export const ZIP_NAME = "hwpx-opt-win-x64.zip";
export const REQUIRED_WIN_SHARP_FILES = [
  "sharp-win32-x64.node",
  "libvips-42.dll",
  "libvips-cpp.dll"
];
export const FORBIDDEN_SHARP_DIR_SUBSTRINGS = [
  "sharp-linux",
  "sharp-libvips-linux",
  "sharp-darwin",
  "sharp-wasm"
];
