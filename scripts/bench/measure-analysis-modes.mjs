// Run after npm run build. Each case uses a fresh process and synthetic inputs.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import JSZip from "jszip";
import { analyzeHwpxBuffer } from "../../packages/core/dist/optimize.js";

if (process.argv[2] === "--case") {
  const input = await readFile(process.argv[3]);
  const mode = process.argv[4];
  const counts = { metadataCalls: 0, rawOutputCalls: 0, encodedOutputCalls: 0 };
  const metadata = sharp.prototype.metadata, toBuffer = sharp.prototype.toBuffer;
  sharp.prototype.metadata = function (...args) { counts.metadataCalls += 1; return metadata.apply(this, args); };
  sharp.prototype.toBuffer = function (...args) {
    counts[this.options.formatOut === "raw" ? "rawOutputCalls" : "encodedOutputCalls"] += 1;
    return toBuffer.apply(this, args);
  };
  const start = performance.now();
  const report = await analyzeHwpxBuffer(input, mode === "default" ? {} : { analysisMode: mode });
  if (report.images.length !== Number(process.argv[5])) throw new Error("Synthetic image inventory mismatch");
  if (mode !== "deep" && (counts.rawOutputCalls || counts.encodedOutputCalls)) throw new Error("Quick performed pixel/encode work");
  if (mode === "deep" && (!counts.rawOutputCalls || !counts.encodedOutputCalls)) throw new Error("Deep work was not observed");
  console.log(JSON.stringify({ mode, imageCount: report.images.length, inputBytes: input.length,
    durationMs: Number((performance.now() - start).toFixed(1)), ...counts, coverage: report.analysis }));
} else {
  const run = promisify(execFile);
  await mkdir(resolve(".tmp"), { recursive: true });
  const work = await mkdtemp(resolve(".tmp/analysis-modes-"));
  const rows = [];
  for (const imageCount of [1, 8, 24]) {
    const zip = new JSZip();
    zip.file("mimetype", "application/hwp+zip", { compression: "STORE" });
    const manifest = [], pictures = [];
    for (let image = 0; image < imageCount; image += 1) {
      const width = 512, height = 384, pixels = Buffer.alloc(width * height * 3);
      let seed = image + 1;
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
        seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
        const noise = seed >>> 27, offset = (y * width + x) * 3;
        pixels[offset] = 20 + Math.floor(x * 180 / width) + noise;
        pixels[offset + 1] = 20 + Math.floor(y * 180 / height) + noise;
        pixels[offset + 2] = 70 + image + noise;
      }
      const format = ["jpeg", "png", "tiff"][image % 3];
      const data = await sharp(pixels, { raw: { width, height, channels: 3 } })
        .toFormat(format, format === "jpeg" ? { quality: 96 } : format === "tiff" ? { compression: "none" } : {}).toBuffer();
      const path = `BinData/image${image}.${format}`;
      zip.file(path, data);
      manifest.push(`<opf:item id="i${image}" href="${path}"/>`);
      pictures.push(`<hp:pic><hp:sz width="14400" height="10800"/><hc:img binaryItemIDRef="i${image}"/></hp:pic>`);
    }
    zip.file("Contents/content.hpf", `<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest>${manifest.join("")}</opf:manifest></opf:package>`);
    zip.file("Contents/section0.xml", `<root>${pictures.join("")}</root>`);
    const input = join(work, `${imageCount}.hwpx`);
    await writeFile(input, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
    for (const mode of ["default", "quick", "deep"]) {
      const { stdout } = await run(process.execPath, [fileURLToPath(import.meta.url), "--case", input, mode, String(imageCount)],
        { timeout: 300_000, maxBuffer: 1024 * 1024 });
      const row = JSON.parse(stdout.trim()); rows.push(row); console.log(JSON.stringify(row));
    }
  }
  const output = resolve(process.argv[2] ?? ".tmp/analysis-mode-measurement.json");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ measuredAt: new Date().toISOString(), platform: process.platform, node: process.version,
    counterScope: "Sharp metadata(), raw toBuffer() requests, and encoded toBuffer() requests; not internal libvips decoder invocations", results: rows }, null, 2));
  console.log(`Saved synthetic analysis measurement: ${output}`);
}
