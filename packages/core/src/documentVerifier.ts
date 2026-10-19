import { isBinaryResourceReference } from "./binaryReferences.js";
import { extractManifestItems, resolveManifestHref } from "./manifest.js";
import { cleanShapeComments, outputMediaType } from "./opportunities.js";
import { normalizePackagePath } from "./packagePath.js";
import { canRemoveUnusedResource } from "./resourcePolicy.js";
import { parseDocumentXml } from "./xmlDocument.js";
import { minifyXmlBuffer } from "./xmlMinify.js";
import { getXmlAttributes } from "./xmlNode.js";
import type { XmlNode } from "./xmlNode.js";
import type { HwpxPackage, ReferenceGraph, ResourceMapping } from "./types.js";

/** Compare serialized document semantics and every resource use in its original position. */
export function verifyDocumentPreservation(input: {
  original: HwpxPackage;
  output: HwpxPackage;
  originalGraph: ReferenceGraph;
  duplicatePathsByPath: Map<string, string[]>;
  mode: "safe" | "balanced" | "aggressive";
  resourceMappings?: ResourceMapping[];
}): Map<string, Set<string>> {
  const originalEntries = new Map(input.original.entries.map((entry) => [entry.path, entry]));
  const outputEntries = new Map(input.output.entries.map((entry) => [entry.path, entry]));
  const originalPaths = new Set(originalEntries.keys());
  const outputPaths = new Set(outputEntries.keys());
  function manifest(pkg: HwpxPackage, paths: Set<string>): Map<string, string> {
    const xml = pkg.entries.find((entry) => entry.path === "Contents/content.hpf")!.data.toString("utf8");
    return new Map(extractManifestItems(xml).flatMap((item) => {
      const path = resolveManifestHref(item.href, paths);
      return path ? [[item.id, path] as const] : [];
    }));
  }
  const originalIds = manifest(input.original, originalPaths);
  const outputIds = manifest(input.output, outputPaths);
  const mappedPaths = new Map<string, Set<string>>();
  const canonical = (path: string): string => input.duplicatePathsByPath.get(path)?.[0] ?? path;
  const explicitPairs = input.resourceMappings ? new Set(input.resourceMappings.map((mapping) =>
    JSON.stringify([mapping.originalPath, mapping.outputPath]))) : undefined;
  const survivingDuplicateGroups = new Set([...originalIds].filter(([id]) => outputIds.has(id))
    .map(([, path]) => canonical(path)));
  function fail(path: string, detail: string): never {
    throw new Error(`Verification failed: document content or layout changed at ${path}: ${detail}`);
  }
  function verifyPair(originalPath: string, outputPath: string, location: string): void {
    const source = originalEntries.get(originalPath);
    const target = outputEntries.get(outputPath);
    if (!source || !target) fail(location, `resource use cannot resolve ${originalPath} → ${outputPath}`);
    if (originalPath !== outputPath) {
      if (input.mode === "safe" || source.kind !== "image" || target.kind !== "image") {
        fail(location, `resource use changed ${originalPath} → ${outputPath}`);
      }
      if (originalEntries.has(outputPath)) {
        if (canonical(originalPath) !== canonical(outputPath)) {
          fail(location, `image placement changed ${originalPath} → ${outputPath}`);
        }
      } else {
        const seeds = input.duplicatePathsByPath.get(originalPath) ?? [originalPath];
        const allowed = seeds.some((seed) => {
          const stem = seed.replace(/\.[^./]+$/, "");
          const suffix = /\.(bmp|tiff?)$/i.test(seed) ? ".png" : /\.jpe?g$/i.test(seed) ? ".jpg" : undefined;
          if (!suffix) return false;
          if (outputPath === `${stem}${suffix}`) return true;
          if (!outputPath.startsWith(`${stem}-opt`) || !outputPath.endsWith(suffix)) return false;
          const number = outputPath.slice(stem.length + 4, -suffix.length);
          return number === "" || /^[2-9]\d*$|^1\d+$/.test(number);
        });
        if (!allowed || outputPaths.has(originalPath)) fail(location,
          `${input.mode} mode image conversion is not allowed ${originalPath} → ${outputPath}`);
      }
    }
    if (source.kind === "image" && explicitPairs && !explicitPairs.has(JSON.stringify([originalPath, outputPath]))) {
      fail(location, "explicit resource mapping does not match serialized use");
    }
    const paths = mappedPaths.get(originalPath) ?? new Set<string>();
    paths.add(outputPath);
    mappedPaths.set(originalPath, paths);
  }
  for (const mapping of input.resourceMappings ?? []) {
    if (originalEntries.get(mapping.originalPath)?.kind !== "image" ||
        outputEntries.get(mapping.outputPath)?.kind !== "image" ||
        (mapping.originalId !== undefined && originalIds.get(mapping.originalId) !== mapping.originalPath) ||
        (mapping.outputId !== undefined && outputIds.get(mapping.outputId) !== mapping.outputPath)) {
      fail(mapping.originalPath, "invalid explicit resource mapping");
    }
    verifyPair(mapping.originalPath, mapping.outputPath, mapping.originalPath);
  }
  function canRemoveManifestItem(node: XmlNode): boolean {
    if (!Object.keys(node).some((name) => name.split(":").at(-1) === "item")) return false;
    const attrs = getXmlAttributes(node);
    if (typeof attrs?.id !== "string" || outputIds.has(attrs.id)) return false;
    const path = originalIds.get(attrs.id);
    const entry = path ? originalEntries.get(path) : undefined;
    if (!entry || outputPaths.has(entry.path)) return false;
    if (!input.originalGraph.resources.get(entry.path)?.referenced && canRemoveUnusedResource(entry)) return true;
    return input.mode !== "safe" && entry.kind === "image" && input.duplicatePathsByPath.has(entry.path) &&
      survivingDuplicateGroups.has(canonical(entry.path));
  }
  function pruneRemovedManifestItems(nodes: XmlNode[]): XmlNode[] {
    return nodes.filter((node) => !canRemoveManifestItem(node)).map((node) => Object.fromEntries(
      Object.entries(node).map(([key, value]) => [key,
        Array.isArray(value) ? pruneRemovedManifestItems(value as XmlNode[]) : value])));
  }
  function compareNodes(original: XmlNode[], output: XmlNode[], location: string, inManifest: boolean): void {
    if (original.length !== output.length) fail(location, "XML nodes added or removed");
    for (let index = 0; index < original.length; index += 1) {
      const before = original[index]!;
      const after = output[index]!;
      const beforeNames = Object.keys(before).filter((key) => key !== ":@").sort();
      const afterNames = Object.keys(after).filter((key) => key !== ":@").sort();
      if (JSON.stringify(beforeNames) !== JSON.stringify(afterNames)) fail(location, "XML element changed");
      const element = beforeNames[0] ?? "";
      const nodeLocation = `${location}/${element}[${index}]`;
      const beforeAttrs = getXmlAttributes(before) ?? {};
      const afterAttrs = getXmlAttributes(after) ?? {};
      if (JSON.stringify(Object.keys(beforeAttrs).sort()) !== JSON.stringify(Object.keys(afterAttrs).sort())) {
        fail(nodeLocation, "XML attributes added or removed");
      }
      const item = inManifest && element.split(":").at(-1) === "item";
      const manifestPath = item && typeof beforeAttrs.id === "string" ? originalIds.get(beforeAttrs.id) : undefined;
      const changedHref = item && beforeAttrs.href !== afterAttrs.href;
      for (const [name, value] of Object.entries(beforeAttrs)) {
        const next = afterAttrs[name];
        if (typeof value === "string" && typeof next === "string") {
          const originalIdPath = /ref$/i.test(name) ? originalIds.get(value) : undefined;
          if (originalIdPath) {
            const outputIdPath = outputIds.get(next);
            if (!outputIdPath || (value !== next && !isBinaryResourceReference(name, element))) {
              fail(nodeLocation, `reference attribute ${name} changed or unresolved`);
            }
            verifyPair(originalIdPath, outputIdPath, nodeLocation);
            continue;
          }
          if (item && name === "href" && manifestPath) {
            const outputPath = resolveManifestHref(next, outputPaths);
            if (!outputPath) fail(nodeLocation, "manifest resource cannot resolve");
            verifyPair(manifestPath, outputPath, nodeLocation);
            continue;
          }
          if (item && changedHref && name === "media-type" && manifestPath) {
            const outputPath = outputIds.get(String(afterAttrs.id));
            if (outputPath && next === outputMediaType(outputPath)) continue;
          }
          const originalPath = normalizePackagePath(value, { xmlDecoded: true });
          if (originalPath && originalEntries.has(originalPath)) {
            const outputPath = normalizePackagePath(next, { xmlDecoded: true });
            if (!outputPath) fail(nodeLocation, `resource path ${name} changed`);
            verifyPair(originalPath, outputPath, nodeLocation);
            continue;
          }
        }
        if (value !== next) fail(nodeLocation, `attribute ${name} changed`);
      }
      for (const name of beforeNames) {
        const value = before[name];
        const next = after[name];
        if (Array.isArray(value) && Array.isArray(next)) compareNodes(value as XmlNode[], next as XmlNode[], nodeLocation, inManifest);
        else if (value !== next) fail(nodeLocation, "document text changed");
      }
    }
  }
  for (const entry of input.original.entries) {
    const output = outputEntries.get(entry.path);
    if (entry.kind === "xml") {
      if (!output || output.kind !== "xml") fail(entry.path, "XML part removed");
      const normalized = (data: Buffer): XmlNode[] => parseDocumentXml(minifyXmlBuffer(Buffer.from(
        input.mode === "safe" ? data.toString("utf8") : cleanShapeComments(data.toString("utf8"))
      )).toString("utf8"));
      const inManifest = entry.path === "Contents/content.hpf";
      const before = normalized(entry.data);
      compareNodes(inManifest ? pruneRemovedManifestItems(before) : before, normalized(output.data), entry.path, inManifest);
    } else if (entry.kind !== "image") {
      if (!output) {
        if (!input.originalGraph.resources.get(entry.path)?.referenced && canRemoveUnusedResource(entry)) continue;
        fail(entry.path, "protected package part removed");
      }
      if (!entry.data.equals(output.data)) fail(entry.path, "protected package bytes changed");
    }
  }
  for (const entry of input.output.entries) {
    if (originalEntries.has(entry.path)) continue;
    // The writer repairs accepted legacy inputs that omitted the required marker.
    if (entry.path === "mimetype" && entry.data.equals(Buffer.from("application/hwp+zip"))) continue;
    if (entry.kind !== "image" || ![...mappedPaths.values()].some((paths) => paths.has(entry.path))) {
      fail(entry.path, "unexpected package part added");
    }
  }
  return mappedPaths;
}
