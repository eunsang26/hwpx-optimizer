import type { HwpxPackage } from "./types.js";

const ITEM_PATTERN = /<(?:\w+:)?item\b([^>]*)>/gi;
const ATTRIBUTE_PATTERN = /([\w:-]+)=["']([^"']*)["']/g;

export type ManifestItem = {
  id: string;
  href: string;
};

export function extractManifestItems(xml: string): ManifestItem[] {
  const items: ManifestItem[] = [];
  for (const match of xml.matchAll(ITEM_PATTERN)) {
    const attrs = parseTagAttributes(match[1] ?? "");
    if (typeof attrs.id === "string" && typeof attrs.href === "string") {
      items.push({ id: attrs.id, href: attrs.href });
    }
  }
  return items;
}

export function buildManifestPathById(pkg: HwpxPackage, transform: (href: string) => string | null): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of pkg.entries) {
    if (entry.kind !== "xml") continue;
    for (const item of extractManifestItems(entry.data.toString("utf8"))) {
      const normalized = transform(item.href);
      if (normalized) map.set(item.id, normalized);
    }
  }
  return map;
}

export function parseTagAttributes(input: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of input.matchAll(ATTRIBUTE_PATTERN)) {
    attrs[match[1] ?? ""] = match[2] ?? "";
  }
  return attrs;
}
