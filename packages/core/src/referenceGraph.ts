import { XMLParser } from "fast-xml-parser";
import { buildManifestPathById } from "./manifest.js";
import { BIN_DATA_PREFIX, normalizePackagePath } from "./packagePath.js";
import type { HwpxPackage, ReferenceGraph, ResourceReference } from "./types.js";
import { getXmlAttributes, isXmlNode } from "./xmlNode.js";

const ATTRIBUTE_PARSER = new XMLParser({ ignoreAttributes: false, preserveOrder: true, attributeNamePrefix: "" });

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
    for (const value of extractParsedAttributeValues(xml)) {
      refs.add(value);
    }
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
  for (const [name, value] of extractParsedAttributes(xml)) {
    if (isIdReferenceAttribute(name)) refs.push(value);
  }
  for (const match of xml.matchAll(/([\w:-]+)\s*=\s*["']([^"']+)["']/g)) {
    const name = match[1] ?? "";
    const value = match[2] ?? "";
    if (isIdReferenceAttribute(name)) refs.push(value);
  }
  return refs;
}

function extractParsedAttributeValues(xml: string): string[] {
  return extractParsedAttributes(xml).map(([, value]) => value);
}

function extractParsedAttributes(xml: string): Array<[string, string]> {
  try {
    const document = ATTRIBUTE_PARSER.parse(xml);
    const attrs: Array<[string, string]> = [];
    collectParsedAttributes(document, attrs);
    return attrs;
  } catch {
    return [];
  }
}

function collectParsedAttributes(nodes: unknown, attrs: Array<[string, string]>): void {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    if (!isXmlNode(node)) continue;
    const nodeAttrs = getXmlAttributes(node);
    if (nodeAttrs) {
      for (const [name, value] of Object.entries(nodeAttrs)) {
        if (typeof value === "string") attrs.push([name, value]);
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) collectParsedAttributes(value, attrs);
    }
  }
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
