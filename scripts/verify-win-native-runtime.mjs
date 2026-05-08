import { stat } from "node:fs/promises";
import { join } from "node:path";

const unpackedRoot = join(process.cwd(), "release", "win-unpacked", "resources", "app.asar.unpacked");

const requiredFiles = [
  "node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64.node",
  "node_modules/@img/sharp-win32-x64/lib/libvips-cpp.dll",
  "node_modules/@img/sharp-win32-x64/lib/libvips-42.dll"
];

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
