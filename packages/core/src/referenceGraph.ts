import type { HwpxPackage, ReferenceGraph, ResourceReference } from "./types.js";

export function buildReferenceGraph(pkg: HwpxPackage): ReferenceGraph {
  const resources = new Map<string, ResourceReference>();
  const xmlText = pkg.entries
    .filter((entry) => entry.kind === "xml")
    .map((entry) => ({ path: entry.path, text: entry.data.toString("utf8") }));

  for (const entry of pkg.entries) {
    if (entry.kind === "image" || entry.kind === "bindata" || entry.kind === "font" || entry.kind === "ole") {
      resources.set(entry.path, { path: entry.path, referenced: false, refs: [] });
    }
  }

  const missingReferences: string[] = [];
  for (const xml of xmlText) {
    const refs = extractInternalRefs(xml.text);
    for (const ref of refs) {
      const normalized = normalizePackagePath(ref);
      if (!normalized) continue;
      const resource = resources.get(normalized);
      if (resource) {
        resource.referenced = true;
        resource.refs.push(xml.path);
      } else if (normalized.startsWith("BinData/")) {
        missingReferences.push(normalized);
      }
    }
  }

  return { resources, missingReferences };
}

function extractInternalRefs(xml: string): string[] {
  const refs = new Set<string>();
  const pattern = /(?:href|src|binaryItemIDRef|binItem|file|filename)=["']([^"']+)["']/gi;
  for (const match of xml.matchAll(pattern)) {
    refs.add(match[1]);
  }
  for (const match of xml.matchAll(/BinData\/[^"'()<>\s]+/gi)) {
    refs.add(match[0]);
  }
  return [...refs];
}

function normalizePackagePath(value: string): string | null {
  const cleaned = value.replace(/^#/, "").replace(/^\.?\//, "");
  const binDataIndex = cleaned.toLowerCase().indexOf("bindata/");
  if (binDataIndex >= 0) {
    return cleaned.slice(binDataIndex).replace(/\\/g, "/");
  }
  return null;
}
