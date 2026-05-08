import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const assets = ["index.html", "styles.css"];

await mkdir(join(root, "dist"), { recursive: true });
for (const asset of assets) {
  await copyFile(join(root, "src", asset), join(root, "dist", asset));
}
