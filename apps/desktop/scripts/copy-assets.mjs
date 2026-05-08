import { copyFile, cp, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = resolve(root, "..", "..");
const assets = ["index.html", "styles.css", "preload.cjs"];

await mkdir(join(root, "dist"), { recursive: true });
for (const asset of assets) {
  await copyFile(join(root, "src", asset), join(root, "dist", asset));
}

const bundledCoreRoot = join(root, "dist", "node_modules", "@hwpx-optimizer", "core");
await mkdir(bundledCoreRoot, { recursive: true });
await copyFile(join(repoRoot, "packages", "core", "package.json"), join(bundledCoreRoot, "package.json"));
await cp(join(repoRoot, "packages", "core", "dist"), join(bundledCoreRoot, "dist"), {
  force: true,
  recursive: true
});
