const { readdir, rm } = require("node:fs/promises");
const { join } = require("node:path");

const keptLocales = new Set(["ko.pak"]);

exports.default = async function pruneElectronLocales(context) {
  if (context.electronPlatformName !== "win32") return;

  const localesDir = join(context.appOutDir, "locales");
  let entries;
  try {
    entries = await readdir(localesDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile() || keptLocales.has(entry.name)) continue;
    await rm(join(localesDir, entry.name), { force: true });
    removed += 1;
  }

  console.log(`Pruned Electron locales: kept ko.pak, removed ${removed} file(s).`);
};
