import { createHash } from "node:crypto";
import { mapLimit } from "./concurrency.js";
import { computeDecodedPixelHash } from "./visualSimilarity.js";
import type { DuplicateImageGroup, HwpxEntry, HwpxPackage } from "./types.js";

export type ImageConsolidationGroup = DuplicateImageGroup & {
  canonicalPath: string;
};

type ImageEntrySummary = {
  path: string;
  size: number;
  byteHash: string;
};

const byteIdenticalGroupsCache = new WeakMap<HwpxPackage, ImageConsolidationGroup[]>();
const sameVisualGroupsCache = new WeakMap<HwpxPackage, Promise<ImageConsolidationGroup[]>>();
const imageConsolidationGroupsCache = new WeakMap<HwpxPackage, Promise<ImageConsolidationGroup[]>>();

export function findByteIdenticalImageGroups(pkg: HwpxPackage): ImageConsolidationGroup[] {
  const cached = byteIdenticalGroupsCache.get(pkg);
  if (cached) return cached;

  const groups = new Map<string, ImageEntrySummary[]>();
  for (const entry of pkg.entries) {
    if (entry.kind !== "image") continue;
    const byteHash = hashBytes(entry.data);
    const group = groups.get(byteHash) ?? [];
    group.push({ path: entry.path, size: entry.size, byteHash });
    groups.set(byteHash, group);
  }

  const result = [...groups.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([hash, entries]) => toDuplicateGroup(hash, entries, { canonicalBySize: false }))
    .sort(compareDuplicateGroups);
  byteIdenticalGroupsCache.set(pkg, result);
  return result;
}

export async function findSameVisualImageGroups(pkg: HwpxPackage): Promise<ImageConsolidationGroup[]> {
  const cached = sameVisualGroupsCache.get(pkg);
  if (cached) return cached;

  const result = collectSameVisualImageGroups(pkg);
  sameVisualGroupsCache.set(pkg, result);
  return result;
}

async function collectSameVisualImageGroups(pkg: HwpxPackage): Promise<ImageConsolidationGroup[]> {
  const imageEntries = pkg.entries.filter((entry): entry is HwpxEntry & { kind: "image" } => entry.kind === "image");
  const decoded = await mapLimit(imageEntries, 4, async (entry) => {
    const decodedHash = await computeDecodedPixelHash(entry.data);
    if (!decodedHash) return null;
    return {
      path: entry.path,
      size: entry.size,
      byteHash: hashBytes(entry.data),
      decodedHash: decodedHash.hash
    };
  });

  const groups = new Map<string, ImageEntrySummary[]>();
  for (const item of decoded) {
    if (!item) continue;
    const group = groups.get(item.decodedHash) ?? [];
    group.push({ path: item.path, size: item.size, byteHash: item.byteHash });
    groups.set(item.decodedHash, group);
  }

  return [...groups.entries()]
    .filter(([, entries]) => entries.length > 1 && new Set(entries.map((entry) => entry.byteHash)).size > 1)
    .map(([hash, entries]) => toDuplicateGroup(hash, entries, { canonicalBySize: true }))
    .sort(compareDuplicateGroups);
}

export async function findImageConsolidationGroups(pkg: HwpxPackage): Promise<ImageConsolidationGroup[]> {
  const cached = imageConsolidationGroupsCache.get(pkg);
  if (cached) return cached;

  const result = collectImageConsolidationGroups(pkg);
  imageConsolidationGroupsCache.set(pkg, result);
  return result;
}

async function collectImageConsolidationGroups(pkg: HwpxPackage): Promise<ImageConsolidationGroup[]> {
  const sameVisualGroups = await findSameVisualImageGroups(pkg);
  const pathsCoveredBySameVisualGroups = new Set<string>();
  for (const group of sameVisualGroups) {
    for (const path of group.paths) {
      pathsCoveredBySameVisualGroups.add(path);
    }
  }
  return [
    ...sameVisualGroups,
    ...findByteIdenticalImageGroups(pkg).filter((group) => group.paths.every((path) => !pathsCoveredBySameVisualGroups.has(path)))
  ].sort(compareDuplicateGroups);
}

function hashBytes(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function toDuplicateGroup(
  hash: string,
  entries: ImageEntrySummary[],
  options: { canonicalBySize: boolean }
): ImageConsolidationGroup {
  const paths = entries.map((entry) => entry.path).sort((left, right) => left.localeCompare(right));
  const canonical = options.canonicalBySize
    ? [...entries].sort((left, right) => left.size - right.size || left.path.localeCompare(right.path))[0]
    : [...entries].sort((left, right) => left.path.localeCompare(right.path))[0];
  const canonicalPath = canonical?.path ?? paths[0] ?? "";
  const totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  const wastedBytes = totalBytes - (canonical?.size ?? 0);
  return {
    hash,
    paths,
    canonicalPath,
    count: entries.length,
    totalBytes,
    wastedBytes
  };
}

function compareDuplicateGroups(left: DuplicateImageGroup, right: DuplicateImageGroup): number {
  return right.wastedBytes - left.wastedBytes || left.paths[0]?.localeCompare(right.paths[0] ?? "") || 0;
}
