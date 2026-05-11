import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

const roots = ["apps/desktop/dist", "packages/core/dist"];
const removablePatterns = [/\.map$/i, /\.d\.ts$/i, /\.tsbuildinfo$/i];

for (const root of roots) {
  await removePackageOnlyFiles(root);
}

async function removePackageOnlyFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
    throw error;
  }

  await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await removePackageOnlyFiles(path);
        return;
      }
      if (entry.isFile() && removablePatterns.some((pattern) => pattern.test(entry.name))) {
        await rm(path, { force: true });
      }
    })
  );
}
