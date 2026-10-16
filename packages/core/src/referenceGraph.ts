import { buildManifestPathById, extractManifestItems, resolveManifestHref } from "./manifest.js";
import { BIN_DATA_PREFIX, normalizePackagePath } from "./packagePath.js";
import type { HwpxPackage, ReferenceGraph, ResourceReference } from "./types.js";
import { getXmlAttributes, isXmlNode } from "./xmlNode.js";
import { parseDocumentXml } from "./xmlDocument.js";

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

  const availablePaths = new Set(pkg.entries.map((entry) => entry.path));
  const manifestPathById = buildManifestPathById(pkg, (href) => resolveManifestHref(href, availablePaths));

  const missingReferences: string[] = [];
  const declaredIds = new Set<string>();
  for (const item of extractManifestItems(xmlText.find((xml) => isPackageManifest(xml.path))?.text ?? "")) {
    if (declaredIds.has(item.id)) missingReferences.push(`duplicate manifest ID ${item.id}`);
    declaredIds.add(item.id);
    const path = resolveManifestHref(item.href, availablePaths);
    if (path && !availablePaths.has(path)) missingReferences.push(`manifest ${item.id}: ${path}`);
    if (!path && !/^[a-z][a-z\d+.-]*:/i.test(item.href)) {
      missingReferences.push(`invalid manifest href ${item.id}: ${item.href}`);
    }
  }
  for (const xml of xmlText) {
    const refs = extractInternalRefs(xml.text, { includeDirectPackagePaths: !isPackageManifest(xml.path) });
    for (const ref of refs) {
      const normalized = normalizePackagePath(ref, { xmlDecoded: true });
      if (!normalized) continue;
      markReference({ resources, missingReferences, path: normalized, referrer: xml.path });
    }

    if (isPackageManifest(xml.path)) continue;
    for (const idRef of extractBinaryItemIdRefs(xml.text)) {
      const path = manifestPathById.get(idRef.value);
      if (path) {
        markReference({ resources, missingReferences, path, referrer: xml.path });
      } else if (idRef.required) {
        missingReferences.push(`binaryItemIDRef ${idRef.value} at ${xml.path}`);
      }
    }
  }

  return { resources, missingReferences: [...new Set(missingReferences)] };
}

function extractInternalRefs(xml: string, options: { includeDirectPackagePaths: boolean }): string[] {
  const refs = new Set<string>();
  if (options.includeDirectPackagePaths) {
    for (const value of extractParsedAttributeValues(xml)) {
      refs.add(value);
    }
    for (const text of extractParsedText(xml)) {
      for (const match of text.matchAll(/BinData\/[^"'()<>\s]+/gi)) refs.add(match[0]);
    }
  }
  return [...refs];
}

function extractParsedText(xml: string): string[] {
  const text: string[] = [];
  function visit(value: unknown): void {
    if (Array.isArray(value)) { for (const node of value) visit(node); return; }
    if (!isXmlNode(value)) return;
    for (const [name, child] of Object.entries(value)) {
      if (name === "#text" && typeof child === "string") text.push(child);
      else if (name !== "#comment" && Array.isArray(child)) visit(child);
    }
  }
  visit(parseDocumentXml(xml));
  return text;
}

function extractBinaryItemIdRefs(xml: string): Array<{ value: string; required: boolean }> {
  const refs: Array<{ value: string; required: boolean }> = [];
  for (const { name, value, optionalEmptyFontReference } of extractParsedAttributes(xml)) {
    if (optionalEmptyFontReference) continue;
    if (isIdReferenceAttribute(name)) refs.push({ value,
      required: name.split(":").at(-1)?.toLowerCase() === "binaryitemidref" });
  }
  return refs;
}

function extractParsedAttributeValues(xml: string): string[] {
  return extractParsedAttributes(xml).map(({ value }) => value);
}

type ParsedAttribute = { name: string; value: string; optionalEmptyFontReference: boolean };

function extractParsedAttributes(xml: string): ParsedAttribute[] {
  try {
    const document = parseDocumentXml(xml);
    const attrs: ParsedAttribute[] = [];
    collectParsedAttributes(document, attrs);
    return attrs;
  } catch {
    return [];
  }
}

function collectParsedAttributes(
  nodes: unknown,
  attrs: ParsedAttribute[],
  inheritedNamespaces: Record<string, string> = {}
): void {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    if (!isXmlNode(node)) continue;
    const nodeAttrs = getXmlAttributes(node);
    const namespaces = { ...inheritedNamespaces };
    for (const [name, value] of Object.entries(nodeAttrs ?? {})) {
      if (typeof value === "string" && (name === "xmlns" || name.startsWith("xmlns:"))) {
        namespaces[name === "xmlns" ? "" : name.slice(6)] = value;
      }
    }
    const element = Object.keys(node).find(name => name !== ":@" && !name.startsWith("#") && !name.startsWith("?")) ?? "";
    const prefix = element.includes(":") ? element.split(":")[0]! : "";
    const namespace = namespaces[prefix];
    const localName = element.split(":").at(-1);
    const nonEmbeddedFont = (localName === "font" || localName === "substFont") &&
      (namespace === "http://www.hancom.co.kr/hwpml/2011/head" ||
        namespace === "http://www.owpml.org/owpml/2021/head") &&
      (nodeAttrs?.isEmbedded === "0" || nodeAttrs?.isEmbedded === "false");
    if (nodeAttrs) {
      for (const [name, value] of Object.entries(nodeAttrs)) {
        // Hancom emits an empty binaryItemIDRef for a non-embedded substitute font.
        // Empty images, embedded fonts and nonempty unresolved IDs still require a resource.
        if (typeof value === "string") attrs.push({ name, value,
          optionalEmptyFontReference: nonEmbeddedFont && name === "binaryItemIDRef" && value === "" });
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) collectParsedAttributes(value, attrs, namespaces);
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
