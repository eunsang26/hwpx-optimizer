import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

const PRUNE_EXACT_NAMES = new Set(["package-lock.json", ".package-lock.json"]);
const PRUNE_NAME_PREFIXES = ["README", "CHANGELOG", "CHANGES", "CONTRIBUTING", "GOVERNANCE"];

export function shouldPrunePackagingFile(name) {
  if (name.endsWith(".map") || name.endsWith(".d.ts")) {
    return true;
  }
  if (PRUNE_EXACT_NAMES.has(name)) {
    return true;
  }
  const upper = name.toUpperCase();
  return PRUNE_NAME_PREFIXES.some((prefix) => upper.startsWith(prefix));
}

export async function prunePackagingTree(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      await prunePackagingTree(path);
    } else if (shouldPrunePackagingFile(entry.name)) {
      await rm(path, { force: true });
    }
  }
}
