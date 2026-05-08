import JSZip from "jszip";

export async function createHwpxFixture(input: {
  entries: Record<string, string | Buffer>;
  includeRequiredFiles?: boolean;
}): Promise<Buffer> {
  const zip = new JSZip();
  const entries =
    input.includeRequiredFiles === false
      ? input.entries
      : {
          "Contents/content.hpf": '<opf:package xmlns:opf="http://www.idpf.org/2007/opf" />',
          "Contents/section0.xml": "<root />",
          ...input.entries
        };

  for (const [path, value] of Object.entries(entries)) {
    zip.file(path, value);
  }
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}
