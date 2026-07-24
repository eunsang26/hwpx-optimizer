import { readFile } from "node:fs/promises";
import { join } from "node:path";

const FORBIDDEN_MSVC_DLLS = ["vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll"];

export function listPeImports(buffer) {
  if (buffer.length < 64 || buffer.readUInt16LE(0) !== 0x5a4d) {
    throw new Error("Invalid PE file: missing MZ header");
  }

  const peOffset = buffer.readUInt32LE(0x3c);
  if (buffer.toString("ascii", peOffset, peOffset + 4) !== "PE\u0000\u0000") {
    throw new Error("Invalid PE file: missing PE signature");
  }

  const optionalHeaderOffset = peOffset + 24;
  const magic = buffer.readUInt16LE(optionalHeaderOffset);
  const isPe32Plus = magic === 0x20b;
  const isPe32 = magic === 0x10b;
  if (!isPe32Plus && !isPe32) {
    throw new Error(`Unsupported PE optional header magic: 0x${magic.toString(16)}`);
  }

  const numberOfSections = buffer.readUInt16LE(peOffset + 6);
  const sizeOfOptionalHeader = buffer.readUInt16LE(peOffset + 20);
  const dataDirectoryOffset = optionalHeaderOffset + (isPe32Plus ? 112 : 96);
  const importDirectoryRva = buffer.readUInt32LE(dataDirectoryOffset + 8);
  if (importDirectoryRva === 0) {
    return [];
  }

  const sectionTableOffset = optionalHeaderOffset + sizeOfOptionalHeader;
  const sections = [];
  for (let index = 0; index < numberOfSections; index += 1) {
    const sectionOffset = sectionTableOffset + index * 40;
    sections.push({
      virtualAddress: buffer.readUInt32LE(sectionOffset + 12),
      virtualSize: buffer.readUInt32LE(sectionOffset + 8),
      rawPointer: buffer.readUInt32LE(sectionOffset + 20),
      rawSize: buffer.readUInt32LE(sectionOffset + 16)
    });
  }

  function rvaToOffset(rva) {
    for (const section of sections) {
      const span = Math.max(section.virtualSize, section.rawSize);
      if (rva >= section.virtualAddress && rva < section.virtualAddress + span) {
        return section.rawPointer + (rva - section.virtualAddress);
      }
    }
    return undefined;
  }

  const importOffset = rvaToOffset(importDirectoryRva);
  if (importOffset === undefined) {
    throw new Error("Could not locate PE import directory");
  }

  const imports = [];
  for (let index = 0; ; index += 1) {
    const descriptorOffset = importOffset + index * 20;
    const nameRva = buffer.readUInt32LE(descriptorOffset + 12);
    if (nameRva === 0) {
      break;
    }
    const nameOffset = rvaToOffset(nameRva);
    if (nameOffset === undefined) {
      throw new Error("Could not locate PE import descriptor name");
    }
    let end = nameOffset;
    while (buffer[end] !== 0) end += 1;
    imports.push(buffer.toString("ascii", nameOffset, end).toLowerCase());
  }

  return imports;
}

export function assertUcrtOnlyPeImports(buffer, label) {
  const imports = listPeImports(buffer);
  const forbidden = imports.filter((name) => FORBIDDEN_MSVC_DLLS.includes(name));
  if (forbidden.length > 0) {
    throw new Error(
      `${label} imports legacy MSVC runtime DLL(s): ${forbidden.join(", ")}`
    );
  }
}

export async function assertWinSharpUsesUcrtOnly(stageRoot) {
  const sharpLib = join(stageRoot, "app", "node_modules", "@img", "sharp-win32-x64", "lib");
  for (const file of ["libvips-42.dll", "libvips-cpp.dll", "sharp-win32-x64.node"]) {
    assertUcrtOnlyPeImports(await readFile(join(sharpLib, file)), file);
  }
}
