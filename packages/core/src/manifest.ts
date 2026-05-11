import { XMLParser } from "fast-xml-parser";
import type { HwpxPackage } from "./types.js";

const ATTRIBUTE_PATTERN = /([\w:-]+)=["']([^"']*)["']/g;

const ITEM_PARSER = new XMLParser({
  ignoreAttributes: false,
  preserveOrder: true,
  attributeNamePrefix: "",
  removeNSPrefix: true
});

export type ManifestItem = {
  id: string;
  href: string;
};

export function extractManifestItems(xml: string): ManifestItem[] {
  const items: ManifestItem[] = [];
  let document: unknown;
  try {
    document = ITEM_PARSER.parse(xml);
  } catch {
    return items;
  }
  collectItems(document, items);
  return items;
}

function collectItems(node: unknown, items: ManifestItem[]): void {
  if (Array.isArray(node)) {
    for (const child of node) collectItems(child, items);
    return;
  }
  if (!node || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (key === ":@") continue;
    if (key.toLowerCase() === "item" || key.toLowerCase().endsWith(":item")) {
      const attrs = (record[":@"] as Record<string, unknown> | undefined) ?? {};
      const id = attrs.id;
      const href = attrs.href;
      if (typeof id === "string" && typeof href === "string") {
        items.push({ id, href });
      }
    }
    if (Array.isArray(value)) collectItems(value, items);
    else if (value && typeof value === "object") collectItems(value, items);
  }
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
