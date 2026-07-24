import { writeFile } from "node:fs/promises";
import JSZip from "jszip";

export async function createMinimalHwpxBuffer() {
  const zip = new JSZip();
  zip.file("mimetype", "application/hwp+zip", { compression: "STORE" });
  zip.file(
    "Contents/content.hpf",
    '<opf:package xmlns:opf="http://www.idpf.org/2007/opf" />'
  );
  zip.file("Contents/section0.xml", "<root />");
  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 }
  });
}

export async function writeMinimalHwpxFile(path) {
  await writeFile(path, await createMinimalHwpxBuffer());
}
