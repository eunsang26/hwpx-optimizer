const { readdir, rm } = require("node:fs/promises");
const { join } = require("node:path");

const keptLocales = new Set(["en-US.pak", "ko.pak"]);

module.exports = async function pruneElectronLocales(context) {
  if (context.electronPlatformName !== "win32") return;

  const localesDir = join(context.appOutDir, "locales");
  let entries;
  try {
    entries = await readdir(localesDir, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") return;
    throw error;
  }

  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile() || keptLocales.has(entry.name)) continue;
    await rm(join(localesDir, entry.name), { force: true });
    removed += 1;
  }

  if (removed > 0) {
    console.log(`Pruned ${removed} Electron locale pack(s); kept ${Array.from(keptLocales).join(", ")}.`);
  }
};
