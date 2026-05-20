import { readFile } from "node:fs/promises";
import { join } from "node:path";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const productName = packageJson.build?.productName ?? packageJson.name;
const version = packageJson.version;
const candidates = [
  join("release", `${productName}-${version}-x64.exe`),
  join("release", "win-unpacked", `${productName}.exe`)
];

for (const path of candidates) {
  const signature = await readPeCertificateTable(path);
  if (signature.size <= 0) {
    throw new Error(`${path} has no Authenticode certificate table.`);
  }
  console.log(
    `${path}: securityDirectoryFileOffset=${signature.fileOffset} size=${signature.size}`
  );
}

async function readPeCertificateTable(path) {
  const data = await readFile(path);
  if (data.length < 0x100 || data.toString("ascii", 0, 2) !== "MZ") {
    throw new Error(`${path} is not a PE executable.`);
  }

  const peOffset = data.readUInt32LE(0x3c);
  if (data.toString("ascii", peOffset, peOffset + 4) !== "PE\u0000\u0000") {
    throw new Error(`${path} has an invalid PE signature.`);
  }

  const optionalHeaderOffset = peOffset + 24;
  const magic = data.readUInt16LE(optionalHeaderOffset);
  const dataDirectoryOffset =
    magic === 0x10b ? optionalHeaderOffset + 96 : magic === 0x20b ? optionalHeaderOffset + 112 : null;
  if (dataDirectoryOffset === null) {
    throw new Error(`${path} has an unsupported PE optional-header magic: 0x${magic.toString(16)}`);
  }

  const securityDirectoryOffset = dataDirectoryOffset + 4 * 8;
  return {
    fileOffset: data.readUInt32LE(securityDirectoryOffset),
    size: data.readUInt32LE(securityDirectoryOffset + 4)
  };
}
