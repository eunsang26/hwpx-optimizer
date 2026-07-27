import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const assets = ["index.html", "styles.css", "preload.cjs", "main.cjs", "app-icon.svg"];

await mkdir(join(root, "dist"), { recursive: true });
for (const asset of assets) {
  await copyFile(join(root, "src", asset), join(root, "dist", asset));
}
const iconSvg = await readFile(join(root, "src", "app-icon.svg"));
await writeFile(join(root, "dist", "app-icon.png"), await sharp(iconSvg).resize(256, 256).png().toBuffer());

// Bundle the locally-hosted Pretendard font (and its OFL license) so the packaged
// app renders it without a system install or any network fetch.
const fontsSource = join(root, "src", "fonts");
const fontsTarget = join(root, "dist", "fonts");
await mkdir(fontsTarget, { recursive: true });
for (const fontFile of await readdir(fontsSource)) {
  await copyFile(join(fontsSource, fontFile), join(fontsTarget, fontFile));
}
