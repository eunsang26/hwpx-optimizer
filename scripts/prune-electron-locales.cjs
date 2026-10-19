const { readdir, rm, stat } = require("node:fs/promises");
const { join } = require("node:path");

const keptLocales = new Set(["ko.pak", "en-US.pak"]);

exports.default = async function pruneElectronLocales(context) {
  if (context.electronPlatformName !== "win32") return;

  const localesDir = join(context.appOutDir, "locales");
  let entries;
  try {
    entries = await readdir(localesDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error("Required Windows locale directory is missing.");
    throw error;
  }

  // Validate before deleting anything: Chromium needs its default fallback on
  // Windows hosts whose preferred UI language is not included in this package.
  for (const name of keptLocales) {
    const entry = entries.find(entry => entry.name === name && entry.isFile());
    if (!entry || !(await stat(join(localesDir, name))).size) {
      throw new Error(`Required Windows locale resource is missing or empty: ${name}`);
    }
  }

  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile() || keptLocales.has(entry.name)) continue;
    await rm(join(localesDir, entry.name), { force: true });
    removed += 1;
  }

  console.log(`Pruned Electron locales: kept ko.pak and en-US.pak, removed ${removed} file(s).`);
};
