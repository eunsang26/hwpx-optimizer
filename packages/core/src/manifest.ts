import { XMLParser } from "fast-xml-parser";
import type { HwpxPackage } from "./types.js";
import { buildDocumentXml, parseDocumentXml } from "./xmlDocument.js";
import { getXmlAttributes, isXmlNode } from "./xmlNode.js";
import type { XmlNode } from "./xmlNode.js";

const ATTRIBUTE_PATTERN = /([\w:-]+)=["']([^"']*)["']/g;

const ITEM_PARSER = new XMLParser({
  ignoreAttributes: false,
  preserveOrder: true,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  trimValues: false,
  htmlEntities: true,
  parseTagValue: false,
  parseAttributeValue: false
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
    if (entry.path !== "Contents/content.hpf") continue;
    for (const item of extractManifestItems(entry.data.toString("utf8"))) {
      const normalized = transform(item.href);
      if (normalized) map.set(item.id, normalized);
    }
  }
  return map;
}

/** Resolve local OPF hrefs without touching the host filesystem. */
export function resolveManifestHref(href: string, availablePaths: Set<string>): string | null {
  let value = href.split("#")[0]!;
  try { value = decodeURIComponent(value); } catch { /* Retain literal malformed percent sequences. */ }
  value = value.replace(/\\/g, "/");
  if (/^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith("/")) return null;
  if (availablePaths.has(value)) return value;
  // Hancom packages commonly use root-relative BinData paths in content.hpf.
  const rootRelative = /^(BinData|Contents|Fonts|Object|Preview|META-INF)\//.test(value);
  const segments = rootRelative ? [] : ["Contents"];
  for (const segment of value.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
    } else segments.push(segment);
  }
  return segments.join("/");
}

export function removeManifestResources(data: Buffer, removedPaths: Set<string>, availablePaths: Set<string>): Buffer {
  if (removedPaths.size === 0) return data;
  const nodes = parseDocumentXml(data.toString("utf8"));
  let changed = false;
  function visit(children: XmlNode[]): void {
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const node = children[index]!;
      if (!isXmlNode(node)) continue;
      const item = Object.keys(node).some((name) => name.split(":").at(-1) === "item");
      const href = getXmlAttributes(node)?.href;
      if (item && typeof href === "string") {
        const path = resolveManifestHref(href, availablePaths);
        if (path && removedPaths.has(path)) {
          children.splice(index, 1);
          changed = true;
          continue;
        }
      }
      for (const value of Object.values(node)) if (Array.isArray(value)) visit(value as XmlNode[]);
    }
  }
  visit(nodes);
  return changed ? Buffer.from(buildDocumentXml(nodes)) : data;
}

export function parseTagAttributes(input: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of input.matchAll(ATTRIBUTE_PATTERN)) {
    attrs[match[1] ?? ""] = match[2] ?? "";
  }
  return attrs;
}
