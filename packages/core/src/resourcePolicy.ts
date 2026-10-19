import type { HwpxEntryKind } from "./types.js";

/** Fonts and embedded objects can have uses outside the supported reference graph. */
export function canRemoveUnusedResource(resource: { path: string; kind: HwpxEntryKind }): boolean {
  return resource.path.startsWith("BinData/") &&
    (resource.kind === "image" || resource.kind === "bindata");
}
