import { createHash } from "node:crypto";
import { readHwpxPackage, writeHwpxPackage } from "@hwpx-optimizer/core";
import type { HwpxEntry, HwpxPackage } from "@hwpx-optimizer/core";

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function rewriteHrefInXml(xml: string, fromHref: string, toHref: string): string {
  if (fromHref === toHref) return xml;
  return xml.split(fromHref).join(toHref);
}

function collapseByteIdenticalImages(pkg: HwpxPackage): HwpxPackage {
  const imageEntries = pkg.entries.filter((entry) => entry.kind === "image");
  const byHash = new Map<string, HwpxEntry[]>();
  for (const entry of imageEntries) {
    const hash = sha256(entry.data);
    const group = byHash.get(hash) ?? [];
    group.push(entry);
    byHash.set(hash, group);
  }

  const removePaths = new Set<string>();
  const redirect = new Map<string, string>();

  for (const group of byHash.values()) {
    if (group.length <= 1) continue;
    const kept = group[0]!;
    for (const dup of group.slice(1)) {
      removePaths.add(dup.path);
      redirect.set(dup.path, kept.path);
    }
  }

  if (removePaths.size === 0) {
    return pkg;
  }

  const entries = pkg.entries
    .filter((entry) => !removePaths.has(entry.path))
    .map((entry) => {
      if (entry.kind !== "xml") return entry;
      let xml = entry.data.toString("utf8");
      for (const [fromPath, toPath] of redirect) {
        xml = rewriteHrefInXml(xml, fromPath, toPath);
      }
      if (xml === entry.data.toString("utf8")) return entry;
      const data = Buffer.from(xml, "utf8");
      return { ...entry, data, size: data.byteLength };
    });

  return { entries };
}

export async function repackWithImageBytes(
  original: Buffer,
  replacements: Map<string, Buffer>,
  options?: { collapseByteIdentical?: boolean }
): Promise<Buffer> {
  const pkg = await readHwpxPackage(original);
  const entries = pkg.entries.map((entry) => {
    const replacement = replacements.get(entry.path);
    if (replacement === undefined) return entry;
    return {
      ...entry,
      data: replacement,
      size: replacement.byteLength,
      kind: "image" as const
    };
  });

  let next: HwpxPackage = { entries };
  if (options?.collapseByteIdentical) {
    next = collapseByteIdenticalImages(next);
  }

  return writeHwpxPackage(next);
}
