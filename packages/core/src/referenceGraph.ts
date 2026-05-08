import type { HwpxPackage, ReferenceGraph, ResourceReference } from "./types.js";

export function buildReferenceGraph(pkg: HwpxPackage): ReferenceGraph {
  const resources = new Map<string, ResourceReference>();
  const xmlText = pkg.entries
    .filter((entry) => entry.kind === "xml")
    .map((entry) => ({ path: entry.path, text: entry.data.toString("utf8") }));
  const manifestPathById = new Map<string, string>();

  for (const entry of pkg.entries) {
    if (entry.kind === "image" || entry.kind === "bindata" || entry.kind === "font" || entry.kind === "ole") {
      resources.set(entry.path, { path: entry.path, referenced: false, refs: [] });
    }
  }

  for (const xml of xmlText) {
    for (const item of extractManifestItems(xml.text)) {
      manifestPathById.set(item.id, item.path);
    }
  }

  const missingReferences: string[] = [];
  for (const xml of xmlText) {
    const refs = extractInternalRefs(xml.text, { includeDirectPackagePaths: !isPackageManifest(xml.path) });
    for (const ref of refs) {
      const normalized = normalizePackagePath(ref);
      if (!normalized) continue;
      markReference({ resources, missingReferences, path: normalized, referrer: xml.path });
    }

    if (isPackageManifest(xml.path)) continue;
    for (const idRef of extractBinaryItemIdRefs(xml.text)) {
      const path = manifestPathById.get(idRef);
      if (path) {
        markReference({ resources, missingReferences, path, referrer: xml.path });
      }
    }
  }

  return { resources, missingReferences };
}

function extractInternalRefs(xml: string, options: { includeDirectPackagePaths: boolean }): string[] {
  const refs = new Set<string>();
  if (options.includeDirectPackagePaths) {
    const pattern = /(?:href|src|binItem|file|filename)=["']([^"']+)["']/gi;
    for (const match of xml.matchAll(pattern)) {
      refs.add(match[1]);
    }
    for (const match of xml.matchAll(/BinData\/[^"'()<>\s]+/gi)) {
      refs.add(match[0]);
    }
  }
  return [...refs];
}

function extractBinaryItemIdRefs(xml: string): string[] {
  return [...xml.matchAll(/binaryItemIDRef=["']([^"']+)["']/gi)].map((match) => match[1]);
}

function extractManifestItems(xml: string): Array<{ id: string; path: string }> {
  const items: Array<{ id: string; path: string }> = [];
  for (const match of xml.matchAll(/<(?:\w+:)?item\b([^>]*)>/gi)) {
    const attrs = parseAttributes(match[1]);
    if (!attrs.id || !attrs.href) continue;
    const path = normalizePackagePath(attrs.href);
    if (path) items.push({ id: attrs.id, path });
  }
  return items;
}

function parseAttributes(input: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of input.matchAll(/([\w:-]+)=["']([^"']*)["']/g)) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function markReference(input: {
  resources: Map<string, ResourceReference>;
  missingReferences: string[];
  path: string;
  referrer: string;
}): void {
  const resource = input.resources.get(input.path);
  if (resource) {
    resource.referenced = true;
    resource.refs.push(input.referrer);
  } else if (input.path.startsWith("BinData/")) {
    input.missingReferences.push(input.path);
  }
}

function isPackageManifest(path: string): boolean {
  return path === "Contents/content.hpf";
}

function normalizePackagePath(value: string): string | null {
  const cleaned = value.replace(/^#/, "").replace(/^\.?\//, "");
  const binDataIndex = cleaned.toLowerCase().indexOf("bindata/");
  if (binDataIndex >= 0) {
    return cleaned.slice(binDataIndex).replace(/\\/g, "/");
  }
  return null;
}
