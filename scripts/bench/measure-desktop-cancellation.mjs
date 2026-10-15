// Run after npm run build. Generates synthetic documents only; no sample lookup.
import { randomBytes, createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import JSZip from "jszip";
import sharp from "sharp";
import { DocumentWorkerClient } from "../../apps/desktop/dist/main/documentWorkerClient.js";
import { defaultDesktopSettings, saveDesktopOptimization, verifyDesktopFile } from "../../apps/desktop/dist/main/desktopService.js";
import { DOCUMENT_IDLE_TIMEOUT_MS } from "../../apps/desktop/dist/main/documentOperations.js";

const reportPath = resolve(process.argv[2] ?? ".tmp/desktop-cancellation-measurement.json");
await mkdir(resolve(".tmp"), { recursive: true });
const work = await mkdtemp(resolve(".tmp/desktop-cancellation-"));
const client = new DocumentWorkerClient();
const hash = buffer => createHash("sha256").update(buffer).digest("hex");

async function fixture(fontBytes, imageCount) {
  const zip = new JSZip();
  zip.file("mimetype", "application/hwp+zip", { compression: "STORE" });
  const manifest = []; const pictures = [];
  if (fontBytes) zip.file("Fonts/synthetic.ttf", randomBytes(fontBytes));
  for (let image = 0; image < imageCount; image += 1) {
    const width = 2048, height = 1536;
    const pixels = Buffer.alloc(width * height * 3);
    let seed = image + 1;
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      const noise = seed >>> 28;
      const offset = (y * width + x) * 3;
      pixels[offset] = 20 + Math.floor(x * 180 / width) + noise;
      pixels[offset + 1] = 20 + Math.floor(y * 180 / height) + noise;
      pixels[offset + 2] = 80 + image * 4 + noise;
    }
    zip.file(`BinData/image${image}.jpg`, await sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg({ quality: 96 }).toBuffer());
    manifest.push(`<opf:item id="image${image}" href="BinData/image${image}.jpg" media-type="image/jpeg"/>`);
    pictures.push(`<hp:pic><hp:sz width="144000" height="108000"/><hc:img binaryItemIDRef="image${image}"/></hp:pic>`);
  }
  zip.file("Contents/content.hpf", `<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest>${manifest.join("")}</opf:manifest></opf:package>`);
  zip.file("Contents/section0.xml", `<root>${pictures.join("")}</root>`);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
}

const results = [];
try {
  for (const spec of [
    { name: "opaque-5MiB", fontBytes: 5 * 1024 * 1024, images: 0, mode: "safe" },
    { name: "opaque-32MiB-images-4", fontBytes: 32 * 1024 * 1024, images: 4, mode: "safe" },
    { name: "images-8-balanced", fontBytes: 0, images: 8, mode: "balanced" }
  ]) {
    const bytes = await fixture(spec.fontBytes, spec.images);
    const filePath = join(work, `${spec.name}.hwpx`);
    await writeFile(filePath, bytes);
    const input = { filePath, mode: spec.mode, jpegQuality: 90,
      settings: { ...defaultDesktopSettings, saveReport: true } };
    const analysisStart = performance.now();
    const analysis = await client.analyze(filePath, new AbortController().signal);
    if (analysis.report.originalSize !== bytes.length) throw new Error("Synthetic analysis size mismatch");
    const analysisMs = performance.now() - analysisStart;
    const start = performance.now(); let previous = start;
    const gaps = [];
    const progress = item => {
      const now = performance.now(); gaps.push({ item: item.item, durationMs: Number((now - previous).toFixed(1)) }); previous = now;
    };
    const prepared = await client.prepare(input, new AbortController().signal, progress);
    const preparedAt = performance.now();
    const result = await saveDesktopOptimization(input, prepared, progress, { commitState: { committed: false } });
    const totalMs = performance.now() - start;
    await verifyDesktopFile(result.outputPath);
    if (hash(await readFile(filePath)) !== hash(bytes)) throw new Error("Synthetic original changed");
    results.push({ ...spec, inputBytes: bytes.length, outputBytes: result.report.optimizedSize, analysisMs: Number(analysisMs.toFixed(1)),
      computeAndTransferMs: Number((preparedAt - start).toFixed(1)), saveMs: Number((start + totalMs - preparedAt).toFixed(1)),
      totalMs: Number(totalMs.toFixed(1)), maxProgressGapMs: Math.max(...gaps.map(item => item.durationMs)), gaps });
    console.log(JSON.stringify(results.at(-1)));
  }
} finally { await client.dispose(); }
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, JSON.stringify({ measuredAt: new Date().toISOString(), platform: process.platform,
  node: process.version, idleTimeoutMs: DOCUMENT_IDLE_TIMEOUT_MS, results }, null, 2));
console.log(`Saved synthetic timing report: ${reportPath}`);
