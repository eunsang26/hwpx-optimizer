import { extractManifestItems, resolveManifestHref } from "./manifest.js";
import { normalizePackagePath } from "./packagePath.js";
import { parseDocumentXml } from "./xmlDocument.js";
import { getXmlAttributes } from "./xmlNode.js";
import type { HwpxPackage, ResourceMapping } from "./types.js";
import type { XmlNode } from "./xmlNode.js";

function manifestPaths(pkg: HwpxPackage): Map<string, string> {
  const available = new Set(pkg.entries.map((entry) => entry.path));
  const xml = pkg.entries.find((entry) => entry.path === "Contents/content.hpf")?.data.toString("utf8") ?? "";
  return new Map(extractManifestItems(xml).flatMap((item) => {
    const path = resolveManifestHref(item.href, available);
    return path ? [[item.id, path] as const] : [];
  }));
}

export function describeResourceMappings(
  original: HwpxPackage, output: HwpxPackage, pairs: Iterable<readonly [string, string]>
): ResourceMapping[] {
  const originalImages = new Set(original.entries.filter((entry) => entry.kind === "image").map((entry) => entry.path));
  const outputImages = new Set(output.entries.filter((entry) => entry.kind === "image").map((entry) => entry.path));
  const originalIds = new Map([...manifestPaths(original)].map(([id, path]) => [path, id]));
  const outputIds = new Map([...manifestPaths(output)].map(([id, path]) => [path, id]));
  const seen = new Set<string>();
  return [...pairs].flatMap(([originalPath, outputPath]) => {
    const key = JSON.stringify([originalPath, outputPath]);
    if (!originalImages.has(originalPath) || !outputImages.has(outputPath) || seen.has(key)) return [];
    seen.add(key);
    const originalId = originalIds.get(originalPath);
    const outputId = outputIds.get(outputPath);
    return [{ originalPath, outputPath, ...(originalId ? { originalId } : {}), ...(outputId ? { outputId } : {}) }];
  });
}

/** Recover identities from stable manifest IDs and XML use positions, never filename guesses. */
export function inferResourceMappings(original: HwpxPackage, output: HwpxPackage): ResourceMapping[] {
  const originalIds = manifestPaths(original);
  const outputIds = manifestPaths(output);
  const pairs: Array<readonly [string, string]> = original.entries.filter((entry) => entry.kind === "image")
    .map((entry) => [entry.path, entry.path]);
  for (const [id, path] of originalIds) {
    const target = outputIds.get(id);
    if (target) pairs.push([path, target]);
  }
  function uses(pkg: HwpxPackage, ids: Map<string, string>): Map<string, string> {
    const result = new Map<string, string>();
    function visit(nodes: XmlNode[], parent: string): void {
      let elementIndex = 0;
      for (const node of nodes) {
        const name = Object.keys(node).find((key) => key !== ":@" && !key.startsWith("#") && !key.startsWith("?"));
        if (!name) continue;
        const key = `${parent}/${name}[${elementIndex++}]`;
        for (const [attribute, value] of Object.entries(getXmlAttributes(node) ?? {})) {
          if (typeof value !== "string") continue;
          const path = (/ref$/i.test(attribute) ? ids.get(value) : undefined) ??
            normalizePackagePath(value, { xmlDecoded: true });
          if (path) result.set(`${key}@${attribute}`, path);
        }
        const children = node[name];
        if (Array.isArray(children)) visit(children as XmlNode[], key);
      }
    }
    for (const entry of pkg.entries) {
      if (entry.kind === "xml" && entry.path !== "Contents/content.hpf") {
        visit(parseDocumentXml(entry.data.toString("utf8")), entry.path);
      }
    }
    return result;
  }
  const outputUses = uses(output, outputIds);
  for (const [position, path] of uses(original, originalIds)) {
    const target = outputUses.get(position);
    if (target) pairs.push([path, target]);
  }
  return describeResourceMappings(original, output, pairs);
}
