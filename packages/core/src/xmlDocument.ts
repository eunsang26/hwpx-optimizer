import { XMLBuilder, XMLParser, XMLValidator } from "fast-xml-parser";
import type { X2jOptions } from "fast-xml-parser";
import type { XmlNode } from "./xmlNode.js";

/** Shared by every XML rewrite: document text is data, never a typed value. */
export const documentXmlParserOptions: X2jOptions = {
  ignoreAttributes: false,
  preserveOrder: true,
  attributeNamePrefix: "",
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  // FXP otherwise leaves numeric XML character references undecoded and the
  // builder escapes their ampersands, changing the visible text on round-trip.
  htmlEntities: true,
  cdataPropName: "#cdata",
  commentPropName: "#comment"
};

export function assertWellFormedXml(text: string, path = "XML document"): void {
  const encoding = /^\uFEFF?<\?xml\s[^>]*\bencoding\s*=\s*["']([^"']+)["']/i.exec(text)?.[1];
  if (encoding && !/^utf-?8$/i.test(encoding)) {
    throw new Error(`Unsupported XML encoding at ${path}: ${encoding}; UTF-8 is required`);
  }
  const validation = XMLValidator.validate(text);
  if (validation !== true) {
    throw new Error(`XML is not well-formed at ${path}: ${validation.err.msg}`);
  }
}

export function decodeDocumentXml(data: Buffer, path = "XML document"): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch (error) {
    throw new Error(`Invalid UTF-8 XML at ${path}`, { cause: error });
  }
}

function transformAttributeWhitespace(text: string, transform: (value: string) => string): string {
  // Skip comments, CDATA and processing instructions before matching quoted tags.
  return text.replace(/(<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>)|(<[A-Za-z_:][^"'<>]*(?:(?:"[^"]*"|'[^']*')[^"'<>]*)*>)/g,
    (token: string, skipped: string | undefined) => skipped ? token :
      token.replace(/"[^"]*"|'[^']*'/g, (attribute) => transform(attribute)));
}

export function parseDocumentXml(text: string): XmlNode[] {
  assertWellFormedXml(text);
  // XML 1.0 normalizes literal line endings and literal attribute whitespace;
  // numeric character references are decoded later and retain their characters.
  const normalized = transformAttributeWhitespace(text.replace(/\r\n?/g, "\n"),
    (attribute) => attribute.replace(/[\n\t]/g, " "));
  return new XMLParser(documentXmlParserOptions).parse(normalized) as XmlNode[];
}

export function buildDocumentXml(nodes: XmlNode[], suppressEmptyNode = false): string {
  // fast-xml-builder supports ordered entity rules, omitted from FXP's wrapper typings.
  const options: ConstructorParameters<typeof XMLBuilder>[0] & {
    entities: Array<{ regex: RegExp; val: string }>
  } = {
    ignoreAttributes: false,
    preserveOrder: true,
    attributeNamePrefix: "",
    cdataPropName: "#cdata",
    commentPropName: "#comment",
    suppressEmptyNode,
    entities: [
      { regex: /&/g, val: "&amp;" }, { regex: />/g, val: "&gt;" },
      { regex: /</g, val: "&lt;" }, { regex: /'/g, val: "&apos;" },
      { regex: /"/g, val: "&quot;" }, { regex: /\r/g, val: "&#13;" }
    ]
  };
  const xml = new XMLBuilder(options).build(nodes);
  return transformAttributeWhitespace(xml, (attribute) => attribute
    .replace(/\t/g, "&#9;").replace(/\n/g, "&#10;").replace(/\r/g, "&#13;"));
}
