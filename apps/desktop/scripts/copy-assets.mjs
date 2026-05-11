import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = resolve(root, "..", "..");
const assets = ["index.html", "styles.css", "preload.cjs", "main.cjs"];

await mkdir(join(root, "dist"), { recursive: true });
for (const asset of assets) {
  await copyFile(join(root, "src", asset), join(root, "dist", asset));
}

const bundledCoreRoot = join(root, "dist", "node_modules", "@hwpx-optimizer", "core");
await rm(bundledCoreRoot, { recursive: true, force: true });
await mkdir(bundledCoreRoot, { recursive: true });
await copyFile(join(repoRoot, "packages", "core", "package.json"), join(bundledCoreRoot, "package.json"));
await copyRuntimeAndTypeFiles(join(repoRoot, "packages", "core", "dist"), join(bundledCoreRoot, "dist"));

async function copyRuntimeAndTypeFiles(sourceDir, targetDir) {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  await mkdir(targetDir, { recursive: true });
  for (const entry of entries) {
    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copyRuntimeAndTypeFiles(sourcePath, targetPath);
      continue;
    }
    if (entry.isFile() && (entry.name.endsWith(".js") || entry.name.endsWith(".d.ts"))) {
      await copyFile(sourcePath, targetPath);
    }
  }
}
