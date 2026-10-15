// Run after npm run build. All inputs are synthetic and remain under .tmp.
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainThread, parentPort } from "node:worker_threads";
import JSZip from "jszip";
import sharp from "sharp";
import { readHwpxPackage, withDecodedImageCache, MAX_DECODED_CACHE_BYTES } from "../../packages/core/dist/index.js";
import { optimizeByMode } from "../../packages/cli/dist/optimizeByMode.js";
import { WorkerPool } from "../../packages/cli/dist/workerPool.js";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const usage = () => ({ rssBytes: process.memoryUsage().rss, osPeakRssBytes: process.resourceUsage().maxRSS * 1024 });
function declaredSize(input, path, size) {
  const result = Buffer.from(input), end = result.length - 22;
  for (let offset = result.readUInt32LE(end + 16); offset < end;) {
    const nameLength = result.readUInt16LE(offset + 28);
    if (result.subarray(offset + 46, offset + 46 + nameLength).toString() === path) result.writeUInt32LE(size, offset + 24);
    offset += 46 + nameLength + result.readUInt16LE(offset + 30) + result.readUInt16LE(offset + 32);
  }
  return result;
}
function basicZip() {
  const zip = new JSZip(); zip.file("mimetype", "application/hwp+zip", { compression: "STORE" });
  zip.file("Contents/content.hpf", "<root/>"); zip.file("Contents/section0.xml", "<root/>"); return zip;
}

if (!isMainThread) {
  sharp.concurrency(1);
  parentPort.on("message", async ({ index, job }) => {
    try {
      const input = await readFile(job.sourcePath); const before = hash(input); let cache;
      const result = await withDecodedImageCache(() => optimizeByMode(input, "balanced", { imageConcurrency: 1 }),
        { onDispose: stats => { cache = stats; } });
      if (!cache || cache.rawBytes || cache.retainedBytes || cache.pendingEntries || cache.peakRetainedBytes > MAX_DECODED_CACHE_BYTES) throw new Error("Decode cache release/budget failed");
      if (hash(await readFile(job.sourcePath)) !== before) throw new Error("Synthetic original changed");
      await writeFile(job.outputPath, result.output);
      parentPort.postMessage({ index, result: { status: "ok", outputBytes: result.output.length, cache } });
    } catch (error) { parentPort.postMessage({ index, result: { status: "failed", error: String(error) } }); }
  });
} else if (process.argv[2] === "--zip-case") {
  const input = await readFile(process.argv[3]); const before = usage();
  const concat = Buffer.concat; let largestConcatBytes = 0, errorMessage;
  Buffer.concat = function (chunks, length) {
    largestConcatBytes = Math.max(largestConcatBytes, length ?? chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    return concat.call(this, chunks, length);
  };
  try { await readHwpxPackage(input, { limits: { maxEntryBytes: 64 * 1024 } }); }
  catch (error) { errorMessage = String(error); }
  finally { Buffer.concat = concat; }
  if (!errorMessage?.includes("entry exceeds supported size") || largestConcatBytes > 64 * 1024) throw new Error("Expected bounded expansion rejection");
  console.log(JSON.stringify({ kind: "zip", inputBytes: input.length, before, after: usage(), largestConcatBytes, errorMessage }));
} else if (process.argv[2] === "--pool-case") {
  const sourcePath = process.argv[3], workersRequested = Number(process.argv[4]);
  const directory = await mkdtemp(join(dirname(sourcePath), "pool-"));
  const before = usage(); let sampledPeakRssBytes = before.rssBytes;
  const sample = setInterval(() => { sampledPeakRssBytes = Math.max(sampledPeakRssBytes, process.memoryUsage().rss); }, 5);
  const pool = new WorkerPool({ size: workersRequested, workerUrl: new URL(import.meta.url) });
  const started = performance.now(); let results;
  try { results = await pool.run(Array.from({ length: workersRequested }, (_, index) => ({ sourcePath, outputPath: join(directory, `${index}.hwpx`) }))); }
  finally { clearInterval(sample); await pool.terminate(); }
  if (!results.every(result => result.status === "ok" && result.result.status === "ok")) throw new Error(JSON.stringify(results));
  console.log(JSON.stringify({ kind: "pool", workersRequested, imageConcurrencyPerWorker: 1,
    durationMs: Number((performance.now() - started).toFixed(1)), before, after: usage(), sampledPeakRssBytes,
    jobs: results.map(result => result.result) }));
} else {
  const run = promisify(execFile), script = fileURLToPath(import.meta.url);
  await mkdir(resolve(".tmp"), { recursive: true }); const work = await mkdtemp(resolve(".tmp/resource-limits-"));
  const results = [];
  async function measure(args, metadata) {
    const { stdout } = await run(process.execPath, [script, ...args], { timeout: 300_000, maxBuffer: 4 * 1024 * 1024 });
    const row = { ...metadata, ...JSON.parse(stdout.trim()) }; results.push(row); console.log(JSON.stringify(row));
  }
  for (const expandedMiB of [32, 128]) {
    const zip = basicZip(); zip.file("BinData/payload.bin", Buffer.alloc(expandedMiB * 1024 * 1024, 7));
    const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
    const file = join(work, `zip-${expandedMiB}.hwpx`); await writeFile(file, declaredSize(bytes, "BinData/payload.bin", 64 * 1024));
    await measure(["--zip-case", file], { expandedMiB, declaredEntryBytes: 64 * 1024 });
  }
  for (const spec of [{ name: "1MP-font-1MiB", width: 1024, height: 1024, fontMiB: 1 }, { name: "8MP-font-16MiB", width: 3072, height: 2560, fontMiB: 16 }]) {
    const zip = basicZip(), manifest = [], pictures = [];
    zip.file("Fonts/synthetic.ttf", randomBytes(spec.fontMiB * 1024 * 1024));
    for (let image = 0; image < 3; image += 1) {
      const pixels = Buffer.alloc(spec.width * spec.height * 3); let seed = image + 1;
      for (let y = 0; y < spec.height; y += 1) for (let x = 0; x < spec.width; x += 1) {
        seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
        const noise = seed >>> 28, offset = (y * spec.width + x) * 3;
        pixels[offset] = 20 + Math.floor(x * 180 / spec.width) + noise;
        pixels[offset + 1] = 20 + Math.floor(y * 180 / spec.height) + noise;
        pixels[offset + 2] = 70 + image * 20 + noise;
      }
      zip.file(`BinData/image${image}.jpg`, await sharp(pixels, { raw: { width: spec.width, height: spec.height, channels: 3 } }).jpeg({ quality: 96 }).toBuffer());
      manifest.push(`<opf:item id="i${image}" href="BinData/image${image}.jpg"/>`);
      pictures.push(`<hp:pic><hp:sz width="144000" height="120000"/><hc:img binaryItemIDRef="i${image}"/></hp:pic>`);
    }
    zip.file("Contents/content.hpf", `<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest>${manifest.join("")}</opf:manifest></opf:package>`);
    zip.file("Contents/section0.xml", `<root>${pictures.join("")}</root>`);
    const file = join(work, `${spec.name}.hwpx`), bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }); await writeFile(file, bytes);
    for (const workers of [1, 2, 4]) await measure(["--pool-case", file, String(workers)], { ...spec, imageCountPerWorker: 3, inputBytes: bytes.length });
  }
  const output = resolve(process.argv[2] ?? ".tmp/resource-limit-measurement.json"); await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ measuredAt: new Date().toISOString(), platform: process.platform, node: process.version, results }, null, 2));
  console.log(`Saved synthetic resource measurement: ${output}`);
}
