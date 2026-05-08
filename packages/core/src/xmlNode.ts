export type XmlNode = Record<string, unknown>;

export type XmlAttributes = Record<string, unknown>;

export const XML_ATTRIBUTES_KEY = ":@" as const;

export function isXmlNode(value: unknown): value is XmlNode {
  return typeof value === "object" && value !== null;
}

export function getXmlAttributes(node: XmlNode): XmlAttributes | null {
  const value = node[XML_ATTRIBUTES_KEY];
  return value && typeof value === "object" ? (value as XmlAttributes) : null;
}

export function getStringAttribute(attributes: XmlAttributes | null, name: string): string | undefined {
  if (!attributes) return undefined;
  const value = attributes[name];
  return typeof value === "string" ? value : undefined;
}

export function setAttribute(attributes: XmlAttributes, name: string, value: string): void {
  attributes[name] = value;
}
