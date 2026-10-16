/** Synthetic only: no filesystem input corpus, no document/report uploads. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import sharp from "sharp";
import { analyzeHwpxBuffer, optimizeHwpxBufferSafe, optimizeHwpxBufferBalanced,
  optimizeHwpxBufferAggressive, evaluatePackageSizeEstimate, targetStatusForBytes,
  verifyHwpxOutput } from "../../packages/core/dist/index.js";

const raw = Buffer.alloc(1200 * 800 * 3);
for (let y = 0; y < 800; y++) for (let x = 0; x < 1200; x++) {
  const index = (y * 1200 + x) * 3;
  raw[index] = Math.round(125 + 80 * Math.sin(x / 101) * Math.cos(y / 67));
  raw[index + 1] = Math.round(120 + 70 * Math.sin(x / 83 + y / 129));
  raw[index + 2] = Math.round(125 + 70 * Math.cos(x / 137 - y / 47));
}
const photo = await sharp(raw, { raw: { width: 1200, height: 800, channels: 3 } }).jpeg({ quality: 97 }).toBuffer();
const chartRaw = Buffer.alloc(256 * 256 * 3);
for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
  const i = (y * 256 + x) * 3, shade = x % 32 < 3 || y % 32 < 3 ? 0 : 240;
  chartRaw[i] = shade; chartRaw[i + 1] = shade; chartRaw[i + 2] = Math.min(255, shade + 15);
}
const chart = await sharp(chartRaw, { raw: { width: 256, height: 256, channels: 3 } }).png({ compressionLevel: 1 }).toBuffer();
const bmp = Buffer.alloc(54 + 256 * 256 * 3); bmp.write("BM"); bmp.writeUInt32LE(bmp.length, 2);
bmp.writeUInt32LE(54, 10); bmp.writeUInt32LE(40, 14); bmp.writeInt32LE(256, 18); bmp.writeInt32LE(256, 22);
bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(24, 28);
for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) for (let c = 0; c < 3; c++) bmp[54 + ((255 - y) * 256 + x) * 3 + c] = chartRaw[(y * 256 + x) * 3 + 2 - c];
const corpus = [
  { name: "photo-jpeg", images: { "BinData/photo.jpg": photo } },
  { name: "chart-png-bmp", images: { "BinData/chart.png": chart, "BinData/chart.bmp": bmp } },
  { name: "mixed-duplicates", images: { "BinData/photo.jpg": photo, "BinData/chart.png": chart, "BinData/copy.png": chart, "BinData/chart.bmp": bmp } }
];
const runs = { safe: optimizeHwpxBufferSafe, balanced: optimizeHwpxBufferBalanced, aggressive: optimizeHwpxBufferAggressive };
let completed = 0, expected = corpus.length * 3;
console.log(JSON.stringify({ platform: process.platform, node: process.version, synthetic: true, expected, note: "Estimates use the policy baseline; actual target search and verification can differ. Equality is always a miss." }));
for (const item of corpus) {
  const zip = new JSZip(); zip.file("mimetype", "application/hwp+zip", { compression: "STORE" });
  const paths = Object.keys(item.images);
  zip.file("Contents/content.hpf", `<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest>${paths.map((path, i) => `<opf:item id="i${i}" href="${path}"/>`).join("")}</opf:manifest></opf:package>`);
  zip.file("Contents/section0.xml", `<root>${paths.map((_, i) => `<pic><sz width="72000" height="48000"/><img binaryItemIDRef="i${i}"/></pic>`).join("")}</root>`);
  for (const [path, data] of Object.entries(item.images)) zip.file(path, data);
  const source = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  const hash = createHash("sha256").update(source).digest("hex");
  const quick = await analyzeHwpxBuffer(source), deep = await analyzeHwpxBuffer(source, { analysisMode: "deep" });
  for (const analysis of [quick, deep]) {
    assert.equal(analysis.kind, "analysis");
    assert.equal(analysis.optimizedSize, undefined); assert.equal(analysis.targetStatus, undefined);
  }
  for (const [mode, optimize] of Object.entries(runs)) {
    const result = await optimize(source, { jpegQuality: 88, targetBytes: 1 });
    await verifyHwpxOutput(result.output, { original: source, mode });
    assert.equal(result.report.kind, "optimization");
    assert.equal(result.report.optimizedSize, result.output.length); assert.equal(result.report.estimatedSize, undefined);
    const actual = result.output.length;
    const boundaries = [];
    for (const targetBytes of [actual - 1, actual, actual + 1]) {
      const candidate = await optimize(source, { jpegQuality: 88, targetBytes });
      assert.equal(candidate.report.optimizedSize, candidate.output.length);
      assert.equal(candidate.output.length, actual, "Deterministic fixed-policy boundary fixture changed output");
      const status = targetStatusForBytes(source.length, candidate.output.length, targetBytes);
      assert.equal(candidate.report.targetStatus, status);
      assert.equal(candidate.report.targetStatus === "missed", candidate.output.length >= targetBytes);
      boundaries.push({ targetBytes, outputBytes: candidate.output.length, status });
    }
    const estimates = Object.fromEntries([["quick", quick], ["deep", deep]].map(([analysisMode, analysis]) => {
      const predicted = evaluatePackageSizeEstimate(analysis.estimates[mode]).size;
      return [analysisMode, { bytes: predicted, errorBytes: predicted - actual, errorPercent: Number(((predicted - actual) / actual * 100).toFixed(2)) }];
    }));
    assert.equal(createHash("sha256").update(source).digest("hex"), hash);
    console.log(JSON.stringify({ fixture: item.name, mode, sourceBytes: source.length, actualBytes: actual, estimates, boundaries, originalUnchanged: true }));
    completed++;
  }
}
assert.equal(completed, expected);
console.log(JSON.stringify({ completed, failed: 0, boundaryChecks: completed * 3 }));
