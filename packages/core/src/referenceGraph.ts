import { buildManifestPathById } from "./manifest.js";
import { BIN_DATA_PREFIX, normalizePackagePath } from "./packagePath.js";
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

  const manifestPathById = buildManifestPathById(pkg, normalizePackagePath);

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
    for (const match of xml.matchAll(/[\w:-]+\s*=\s*["']([^"']+)["']/g)) {
      refs.add(match[1]);
    }
    for (const match of xml.matchAll(/BinData\/[^"'()<>\s]+/gi)) {
      refs.add(match[0]);
    }
  }
  return [...refs];
}

function extractBinaryItemIdRefs(xml: string): string[] {
  const refs: string[] = [];
  for (const match of xml.matchAll(/([\w:-]+)\s*=\s*["']([^"']+)["']/g)) {
    const name = match[1] ?? "";
    const value = match[2] ?? "";
    if (isIdReferenceAttribute(name)) refs.push(value);
  }
  return refs;
}

function isIdReferenceAttribute(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized === "binaryitemidref" || normalized.endsWith("ref") || normalized.endsWith("idref");
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
  } else if (input.path.startsWith(BIN_DATA_PREFIX)) {
    input.missingReferences.push(input.path);
  }
}

function isPackageManifest(path: string): boolean {
  return path === "Contents/content.hpf";
}
