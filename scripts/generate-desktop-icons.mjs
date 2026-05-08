import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const buildDir = "build";
const iconPngPath = join(buildDir, "icon.png");
const iconIcoPath = join(buildDir, "icon.ico");

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect width="256" height="256" rx="48" fill="#1f6f64"/>
  <path d="M72 56h82l30 30v114H72z" fill="#f7faf9"/>
  <path d="M154 56v32h30z" fill="#c9e7e1"/>
  <rect x="92" y="112" width="72" height="12" rx="6" fill="#1f6f64"/>
  <rect x="92" y="140" width="72" height="12" rx="6" fill="#1f6f64"/>
  <rect x="92" y="168" width="46" height="12" rx="6" fill="#1f6f64"/>
  <circle cx="181" cy="181" r="35" fill="#e7b84b"/>
  <path d="M167 181h28M181 167v28" stroke="#263238" stroke-width="10" stroke-linecap="round"/>
</svg>
`;

await mkdir(buildDir, { recursive: true });
const png = await sharp(Buffer.from(svg)).png().toBuffer();
await writeFile(iconPngPath, png);
await writeFile(iconIcoPath, createIcoFromPng(png));

console.log(`Wrote ${iconPngPath}`);
console.log(`Wrote ${iconIcoPath}`);

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
