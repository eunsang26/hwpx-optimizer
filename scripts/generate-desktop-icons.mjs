import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const buildDir = "build";
const iconPngPath = join(buildDir, "icon.png");
const iconIcoPath = join(buildDir, "icon.ico");
const tauriIconDir = join("apps", "tauri-desktop", "src-tauri", "icons");
const tauriIconPngPath = join(tauriIconDir, "icon.png");
const tauriIconIcoPath = join(tauriIconDir, "icon.ico");

const iconSourcePath = join("apps", "desktop", "src", "app-icon.svg");

await mkdir(buildDir, { recursive: true });
await mkdir(tauriIconDir, { recursive: true });
const png = await sharp(await readFile(iconSourcePath)).resize(256, 256).png().toBuffer();
await writeFile(iconPngPath, png);
await writeFile(iconIcoPath, createIcoFromPng(png));
await writeFile(tauriIconPngPath, png);
await writeFile(tauriIconIcoPath, createIcoFromPng(png));

console.log(`Wrote ${iconPngPath}`);
console.log(`Wrote ${iconIcoPath}`);
console.log(`Wrote ${tauriIconPngPath}`);
console.log(`Wrote ${tauriIconIcoPath}`);

function createIcoFromPng(png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  const directory = Buffer.alloc(16);
  directory.writeUInt8(0, 0);
  directory.writeUInt8(0, 1);
  directory.writeUInt8(0, 2);
  directory.writeUInt8(0, 3);
  directory.writeUInt16LE(1, 4);
  directory.writeUInt16LE(32, 6);
  directory.writeUInt32LE(png.byteLength, 8);
  directory.writeUInt32LE(header.byteLength + directory.byteLength, 12);

  return Buffer.concat([header, directory, png]);
}
