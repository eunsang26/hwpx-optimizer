import { XMLBuilder, XMLParser } from "fast-xml-parser";

export function minifyXmlBuffer(data: Buffer): Buffer {
  const parser = new XMLParser({ ignoreAttributes: false, preserveOrder: true });
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    preserveOrder: true,
    suppressEmptyNode: false
  });
  return Buffer.from(builder.build(parser.parse(data.toString("utf8"))));
}
