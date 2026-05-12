import { createHash } from "node:crypto";
import { mapLimit } from "./concurrency.js";
import { computeAverageHash, computeDecodedPixelHash, hammingDistance } from "./visualSimilarity.js";
import type { DuplicateImageGroup, HwpxEntry, HwpxPackage, NearDuplicateImageGroup } from "./types.js";

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
const nearDuplicateGroupsCache = new WeakMap<HwpxPackage, Promise<NearDuplicateImageGroup[]>>();
const NEAR_DUPLICATE_MAX_DISTANCE = 6;

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

export async function findNearDuplicateImageGroups(pkg: HwpxPackage): Promise<NearDuplicateImageGroup[]> {
  const cached = nearDuplicateGroupsCache.get(pkg);
  if (cached) return cached;

  const result = collectNearDuplicateImageGroups(pkg);
  nearDuplicateGroupsCache.set(pkg, result);
  return result;
}

async function collectNearDuplicateImageGroups(pkg: HwpxPackage): Promise<NearDuplicateImageGroup[]> {
  const exactGroups = await findImageConsolidationGroups(pkg);
  const exactPaths = new Set(exactGroups.flatMap((group) => group.paths));
  const imageEntries = pkg.entries.filter((entry): entry is HwpxEntry & { kind: "image" } => entry.kind === "image");
  const hashed = (
    await mapLimit(imageEntries, 4, async (entry) => {
      const averageHash = await computeAverageHash(entry.data);
      if (!averageHash) return null;
      return {
        path: entry.path,
        size: entry.size,
        byteHash: hashBytes(entry.data),
        averageHash
      };
    })
  ).filter((item): item is NonNullable<typeof item> => Boolean(item));

  const parent = new Map<string, string>();
  for (const item of hashed) parent.set(item.path, item.path);

  for (let leftIndex = 0; leftIndex < hashed.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < hashed.length; rightIndex += 1) {
      const left = hashed[leftIndex]!;
      const right = hashed[rightIndex]!;
      if (left.byteHash === right.byteHash) continue;
      if (exactPaths.has(left.path) && exactPaths.has(right.path)) continue;
      const distance = hammingDistance(left.averageHash, right.averageHash);
      if (distance > NEAR_DUPLICATE_MAX_DISTANCE) continue;
      union(parent, left.path, right.path);
    }
  }

  const groups = new Map<string, typeof hashed>();
  for (const item of hashed) {
    const root = findParent(parent, item.path);
    const group = groups.get(root) ?? [];
    group.push(item);
    groups.set(root, group);
  }

  return [...groups.values()]
    .filter((items) => items.length > 1 && new Set(items.map((item) => item.byteHash)).size > 1)
    .map((items) => {
      const duplicateGroup = toDuplicateGroup(hashBytes(Buffer.from(items.map((item) => item.path).join("\0"))), items, {
        canonicalBySize: true
      });
      return {
        ...duplicateGroup,
        maxDistance: maxHashDistance(items),
        reason: "Images have similar average hashes and should be reviewed before manual consolidation."
      };
    })
    .sort(compareDuplicateGroups);
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

function findParent(parent: Map<string, string>, path: string): string {
  const current = parent.get(path) ?? path;
  if (current === path) return current;
  const root = findParent(parent, current);
  parent.set(path, root);
  return root;
}

function union(parent: Map<string, string>, left: string, right: string): void {
  const leftRoot = findParent(parent, left);
  const rightRoot = findParent(parent, right);
  if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
}

function maxHashDistance(items: Array<{ averageHash: Awaited<ReturnType<typeof computeAverageHash>> }>): number {
  let maxDistance = 0;
  for (let leftIndex = 0; leftIndex < items.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < items.length; rightIndex += 1) {
      const left = items[leftIndex]?.averageHash;
      const right = items[rightIndex]?.averageHash;
      if (!left || !right) continue;
      maxDistance = Math.max(maxDistance, hammingDistance(left, right));
    }
  }
  return maxDistance;
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
