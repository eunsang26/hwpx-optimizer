import { buildDocumentXml, decodeDocumentXml, parseDocumentXml } from "./xmlDocument.js";
import { getXmlAttributes, isXmlNode } from "./xmlNode.js";
import type { XmlNode } from "./xmlNode.js";

// Only remove inter-element formatting in known element-only containers.
// Unknown XML and mixed content keep their whitespace. In particular hp:t,
// shapeComment and any descendants of xml:space="preserve" must stay intact.
const ELEMENT_ONLY_CONTAINERS = new Set([
  "root", "package", "manifest", "metadata", "spine", "head", "sec", "section",
  "p", "run", "tbl", "tr", "tc", "subList", "pic", "refList", "fontfaces",
  "fontface", "charProperties", "paraProperties", "styles", "borderFills",
  "tabProperties", "numberings", "bullets"
]);

export function minifyXmlBuffer(data: Buffer): Buffer {
  const nodes = parseDocumentXml(decodeDocumentXml(data));
  removeStructuralWhitespace(nodes);
  return Buffer.from(buildDocumentXml(nodes));
}

function removeStructuralWhitespace(
  nodes: XmlNode[],
  inheritedPreserve = false,
  inheritedNamespaces: Record<string, string> = {}
): void {
  for (const node of nodes) {
    if (!isXmlNode(node)) continue;
    const attrs = getXmlAttributes(node);
    const namespaces = { ...inheritedNamespaces };
    for (const [key, value] of Object.entries(attrs ?? {})) {
      if (typeof value === "string" && (key === "xmlns" || key.startsWith("xmlns:"))) {
        namespaces[key === "xmlns" ? "" : key.slice(6)] = value;
      }
    }
    const space = attrs?.["xml:space"];
    const preserve = space === "preserve" || (space !== "default" && inheritedPreserve);
    for (const [name, children] of Object.entries(node)) {
      if (!Array.isArray(children) || name.startsWith("#")) continue;
      const localName = name.split(":").at(-1)!;
      // Unqualified p/run are unfamiliar mixed-content XML, not HWPX containers.
      const prefix = name.includes(":") ? name.split(":")[0]! : "";
      const namespace = namespaces[prefix];
      const knownNamespace = namespace === undefined
        ? prefix === "" || ["hp", "hh", "hs", "hc", "opf"].includes(prefix)
        : /^http:\/\/www\.hancom\.co\.kr\/hwpml\/2011\/(paragraph|head|section|core)$/.test(namespace) ||
          /^http:\/\/www\.idpf\.org\/2007\/opf\/?$/.test(namespace);
      const knownContainer = knownNamespace && ELEMENT_ONLY_CONTAINERS.has(localName) &&
        (prefix !== "" || !["p", "run"].includes(localName));
      const hasElement = children.some((child) => isXmlNode(child) &&
        Object.keys(child).some((key) => key !== ":@" && !key.startsWith("#") && !key.startsWith("?")));
      const hasContent = children.some((child) => isXmlNode(child) &&
        ((typeof child["#text"] === "string" && child["#text"].trim() !== "") || "#cdata" in child));
      if (!preserve && knownContainer && hasElement && !hasContent) {
        node[name] = children.filter((child) => !isXmlNode(child) ||
          typeof child["#text"] !== "string" || child["#text"].trim() !== "");
      }
      const textContainer = ["t", "shapeComment", "script"].includes(localName);
      removeStructuralWhitespace(node[name] as XmlNode[], preserve || textContainer, namespaces);
    }
  }
}
