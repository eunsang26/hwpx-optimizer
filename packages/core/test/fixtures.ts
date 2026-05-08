import JSZip from "jszip";

export async function createHwpxFixture(input: {
  entries: Record<string, string | Buffer>;
}): Promise<Buffer> {
  const zip = new JSZip();
  for (const [path, value] of Object.entries(input.entries)) {
    zip.file(path, value);
  }
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}
