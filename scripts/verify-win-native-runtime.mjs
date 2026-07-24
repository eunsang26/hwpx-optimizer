import { stat } from "node:fs/promises";
import { join } from "node:path";
import { REQUIRED_WIN_SHARP_FILES } from "./cli-portable/constants.mjs";

const unpackedRoot = join(process.cwd(), "release", "win-unpacked", "resources", "app.asar.unpacked");

const requiredFiles = REQUIRED_WIN_SHARP_FILES.map(
  (file) => `node_modules/@img/sharp-win32-x64/lib/${file}`
);

for (const relativePath of requiredFiles) {
  const filePath = join(unpackedRoot, relativePath);
  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    throw new Error(`Missing unpacked Windows sharp runtime file: ${relativePath}`);
  }

  if (!fileStat.isFile() || fileStat.size <= 0) {
    throw new Error(`Invalid unpacked Windows sharp runtime file: ${relativePath}`);
  }
}

console.log("Verified unpacked Windows sharp runtime files.");
