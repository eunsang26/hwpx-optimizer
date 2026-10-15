import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeBmp } from "../src/bmp.js";
import { clearDecodedImageCache, decodedImageCacheStats, getDecodedImage, peekDecodedImageCache, withDecodedImageCache } from "../src/decodedImage.js";
import type { DecodedImageCacheStats } from "../src/decodedImage.js";
import { computeVisualMetrics, extractImageDiffPreviews } from "../src/imagePreview.js";
import { readImageMetadata } from "../src/imageMetadata.js";
import { analyzeHwpxBuffer, optimizeHwpxBufferBalanced } from "../src/optimize.js";
import { transformImageBalanced } from "../src/opportunities.js";
import { MAX_IMAGE_PIXELS, imagePixelLimitReason } from "../src/resourceLimits.js";
import { readHwpxPackage } from "../src/reader.js";
import { createHwpxFixture } from "./fixtures.js";

beforeEach(() => clearDecodedImageCache());
afterEach(() => { clearDecodedImageCache(); vi.restoreAllMocks(); });
const smallPng = (color = "#336699") => sharp({ create: { width: 16, height: 12, channels: 3, background: color } }).png().toBuffer();
function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
async function oversizedPng() {
  const png = Buffer.from(await smallPng());
  png.writeUInt32BE(5000, 16); png.writeUInt32BE(5000, 20); png.writeUInt32BE(crc32(png.subarray(12, 29)), 29);
  return png;
}

describe("bounded decoded image cache", () => {
  it("evicts old raw images by byte budget and releases all retained data at operation end", async () => {
    const a = await smallPng(), b = await smallPng("#663399"); let disposed!: DecodedImageCacheStats;
    const decoded = await getDecodedImage(a);
    const budget = Math.max(a.buffer.byteLength, b.buffer.byteLength) + decoded!.data.buffer.byteLength;
    clearDecodedImageCache();
    await withDecodedImageCache(async () => {
      expect(await getDecodedImage(a)).not.toBeNull(); expect(await getDecodedImage(b)).not.toBeNull();
      expect(await peekDecodedImageCache(a)).toBe("miss"); expect(await peekDecodedImageCache(b)).toBe("hit");
      const stats = decodedImageCacheStats();
      expect(stats.entries).toBe(1); expect(stats.evictions).toBe(1); expect(stats.retainedBytes).toBeLessThanOrEqual(budget);
      expect(stats.rawBytes).toBe(16 * 12 * 3);
    }, { maxBytes: budget, onDispose: stats => { disposed = stats; } });
    expect(disposed).toMatchObject({ entries: 0, rawBytes: 0, retainedBytes: 0, pendingEntries: 0 });
    expect(disposed.peakRetainedBytes).toBeLessThanOrEqual(budget);
  });
  it("shares one pending decode for concurrent consumers of the same buffer", async () => {
    const png = await smallPng(); const decode = vi.spyOn(sharp.prototype, "toBuffer");
    await withDecodedImageCache(async () => {
      const results = await Promise.all(Array.from({ length: 8 }, () => getDecodedImage(png)));
      expect(results.every(result => result?.data === results[0]?.data)).toBe(true);
      expect(decode).toHaveBeenCalledTimes(1); expect(decodedImageCacheStats().hits).toBe(7);
    });
  });
  it("does not retain an image larger than the cache budget or negative decode results", async () => {
    const png = await smallPng();
    await withDecodedImageCache(async () => {
      expect(await getDecodedImage(png)).not.toBeNull(); expect(await peekDecodedImageCache(png)).toBe("miss");
      expect(await getDecodedImage(Buffer.from("invalid"))).toBeNull(); expect(decodedImageCacheStats().entries).toBe(0);
    }, { maxBytes: 1 });
  });
  it("cannot refill a disposed cache from an async callback scheduled during the operation", async () => {
    const png = await smallPng(); let complete!: () => void;
    const finished = new Promise<void>(resolve => { complete = resolve; });
    let late!: DecodedImageCacheStats;
    await withDecodedImageCache(async () => {
      setTimeout(async () => { await getDecodedImage(png); late = decodedImageCacheStats(); complete(); }, 0);
    });
    await finished; expect(late).toMatchObject({ entries: 0, pendingEntries: 0, rawBytes: 0, retainedBytes: 0 });
  });
  it("clears scoped raw data on failure without clearing another concurrent scope", async () => {
    const png = await smallPng(); let failed!: DecodedImageCacheStats;
    const results = await Promise.allSettled([
      withDecodedImageCache(async () => { await getDecodedImage(png); throw new Error("synthetic failure"); }, { onDispose: stats => { failed = stats; } }),
      withDecodedImageCache(async () => { await getDecodedImage(png); expect(await peekDecodedImageCache(png)).toBe("hit"); return "other"; })
    ]);
    expect(results[0].status).toBe("rejected"); expect(results[1]).toEqual({ status: "fulfilled", value: "other" });
    expect(failed).toMatchObject({ rawBytes: 0, retainedBytes: 0, entries: 0 }); expect(failed.peakRawBytes).toBeGreaterThan(0);
  });
});

describe("pixel limit before decoded allocation", () => {
  it("defines a finite boundary without unsafe dimension multiplication", () => {
    expect(imagePixelLimitReason(6000, 4000)).toBeUndefined(); expect(MAX_IMAGE_PIXELS).toBe(24_000_000);
    expect(imagePixelLimitReason(6001, 4000)).toContain("pixel limit"); expect(imagePixelLimitReason(2 ** 31, 2 ** 31)).toContain("pixel limit");
  });
  it("preserves an oversized PNG in analysis and optimization without starting an image output pipeline", async () => {
    const png = await oversizedPng();
    const input = await createHwpxFixture({ entries: { "BinData/large.png": png, "Contents/section0.xml": '<root><img href="BinData/large.png"/></root>' } });
    const outputPipeline = vi.spyOn(sharp.prototype, "toBuffer");
    expect((await readImageMetadata("", png)).preservationReason).toContain("pixel limit");
    expect(await getDecodedImage(png)).toBeNull();
    await expect(transformImageBalanced("BinData/large.png", png)).rejects.toThrow(/pixel limit/);
    const analysis = await analyzeHwpxBuffer(input, { analysisMode: "deep" });
    expect(analysis.images[0].preservationReason).toContain("pixel limit"); expect(analysis.sameVisualDuplicateImages).toEqual([]);
    const result = await optimizeHwpxBufferBalanced(input);
    const output = await readHwpxPackage(result.output);
    expect(output.entries.find(entry => entry.path === "BinData/large.png")?.data.equals(png)).toBe(true);
    expect(outputPipeline).not.toHaveBeenCalled();
  });
  it("refuses a valid oversized indexed BMP before its full RGB allocation", () => {
    const width = 5000, height = 5000, stride = Math.ceil(width / 32) * 4;
    const bmp = Buffer.alloc(62 + stride * height);
    bmp.write("BM"); bmp.writeUInt32LE(bmp.length, 2); bmp.writeUInt32LE(62, 10); bmp.writeUInt32LE(40, 14);
    bmp.writeInt32LE(width, 18); bmp.writeInt32LE(height, 22); bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(1, 28);
    const alloc = vi.spyOn(Buffer, "alloc");
    expect(decodeBmp(bmp)).toBeNull(); expect(alloc).not.toHaveBeenCalled();
  });
  it("bounds preview output dimensions before decoding or reading a ZIP", async () => {
    const png = await smallPng(); const output = vi.spyOn(sharp.prototype, "toBuffer");
    expect(await computeVisualMetrics(png, png, 100_000)).toEqual({ psnr: null, ssim: null });
    await expect(extractImageDiffPreviews(Buffer.alloc(0), Buffer.alloc(0), { psnrSampleSize: 100_000 })).rejects.toThrow(/Image preview psnrSampleSize/);
    await expect(extractImageDiffPreviews(Buffer.alloc(0), Buffer.alloc(0), { maxItems: 100_000 })).rejects.toThrow(/Image preview maxItems/);
    expect(output).not.toHaveBeenCalled();
  });
  it("does not decode pixels merely to warm the cache before JPEG encoding", async () => {
    const jpeg = await sharp({ create: { width: 2000, height: 20, channels: 3, background: "#336699" } }).jpeg().toBuffer();
    const output = vi.spyOn(sharp.prototype, "toBuffer");
    await withDecodedImageCache(async () => {
      await transformImageBalanced("BinData/a.jpg", jpeg);
      expect(decodedImageCacheStats().rawBytes).toBe(0);
      expect(await peekDecodedImageCache(jpeg, { rotate: true })).toBe("miss");
    });
    const formats = output.mock.contexts.map(context => (context as unknown as { options: { formatOut: string } }).options.formatOut);
    expect(formats).toEqual(["jpeg"]);
  });
});
