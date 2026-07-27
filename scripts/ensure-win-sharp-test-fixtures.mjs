import { access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { REQUIRED_WIN_SHARP_FILES } from "./cli-portable/constants.mjs";
import { SHARP_WIN32_PACKAGE } from "./sharpPin.mjs";

const libDir = join(process.cwd(), "node_modules", "@img", "sharp-win32-x64", "lib");
const marker = join(libDir, REQUIRED_WIN_SHARP_FILES[0]);

try {
  await access(marker);
  console.log(`Win32 sharp test fixtures present (${marker})`);
} catch {
  console.log(`Installing ${SHARP_WIN32_PACKAGE} for CLI portable tests...`);
  const result = spawnSync("npm", ["install", "--force", "--no-save", SHARP_WIN32_PACKAGE], {
    stdio: "inherit"
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  await access(marker);
  console.log("Win32 sharp test fixtures installed.");
}
