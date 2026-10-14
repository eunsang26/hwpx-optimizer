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
  const validation = XMLValidator.validate(text);
  if (validation !== true) {
    throw new Error(`XML is not well-formed at ${path}: ${validation.err.msg}`);
  }
}

export function parseDocumentXml(text: string): XmlNode[] {
  assertWellFormedXml(text);
  return new XMLParser(documentXmlParserOptions).parse(text) as XmlNode[];
}

export function buildDocumentXml(nodes: XmlNode[], suppressEmptyNode = false): string {
  return new XMLBuilder({
    ignoreAttributes: false,
    preserveOrder: true,
    attributeNamePrefix: "",
    cdataPropName: "#cdata",
    commentPropName: "#comment",
    suppressEmptyNode
  }).build(nodes);
}
