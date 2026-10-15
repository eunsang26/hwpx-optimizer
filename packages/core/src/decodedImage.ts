import sharp from "sharp";
import { AsyncLocalStorage } from "node:async_hooks";
import { MAX_DECODED_CACHE_BYTES, SHARP_INPUT_OPTIONS } from "./resourceLimits.js";
import { decodeBmp } from "./bmp.js";
import { readImageMetadata } from "./imageMetadata.js";

export type DecodedImage = {
  data: Buffer;
  width: number;
  height: number;
  channels: 3 | 4;
  autoOriented: boolean;
  indexed: boolean;
};

type Slot = "plain" | "rotated";
type CachedDecode = { source: Buffer; slot: Slot; promise: Promise<DecodedImage | null>; retainedBytes: number; rawBytes: number };
export type DecodedImageCacheStats = {
  entries: number; pendingEntries: number; retainedBytes: number; rawBytes: number;
  peakRetainedBytes: number; peakRawBytes: number; hits: number; misses: number; evictions: number;
};

class DecodedImageCache {
  private closed = false;
  get disposed(): boolean { return this.closed; }
  private slots = new Map<Buffer, Partial<Record<Slot, CachedDecode>>>();
  private ready = new Set<CachedDecode>();
  private retainedBytes = 0;
  private rawBytes = 0;
  private peakRetainedBytes = 0;
  private peakRawBytes = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  constructor(private readonly maxBytes = MAX_DECODED_CACHE_BYTES) {}
  get(source: Buffer, slot: Slot): CachedDecode | undefined {
    const entry = this.slots.get(source)?.[slot];
    if (entry) {
      this.hits += 1;
      if (this.ready.delete(entry)) this.ready.add(entry);
    } else this.misses += 1;
    return entry;
  }
  has(source: Buffer, slot: Slot): boolean { return Boolean(this.slots.get(source)?.[slot]); }
  set(entry: CachedDecode): void {
    if (this.closed) return;
    const slots = this.slots.get(entry.source) ?? {};
    slots[entry.slot] = entry; this.slots.set(entry.source, slots);
  }
  complete(entry: CachedDecode, result: DecodedImage | null): void {
    if (this.slots.get(entry.source)?.[entry.slot] !== entry) return;
    const cost = result ? result.data.buffer.byteLength + entry.source.buffer.byteLength : 0;
    if (!result || cost > this.maxBytes) { this.remove(entry); return; }
    while (this.ready.size >= 64 || this.retainedBytes + cost > this.maxBytes) {
      const oldest = this.ready.values().next().value;
      if (!oldest) break;
      this.evictions += 1; this.remove(oldest);
    }
    entry.rawBytes = result.data.byteLength; entry.retainedBytes = cost;
    this.ready.add(entry); this.rawBytes += entry.rawBytes; this.retainedBytes += cost;
    this.peakRawBytes = Math.max(this.peakRawBytes, this.rawBytes);
    this.peakRetainedBytes = Math.max(this.peakRetainedBytes, this.retainedBytes);
  }
  remove(entry: CachedDecode): void {
    const slots = this.slots.get(entry.source);
    if (slots?.[entry.slot] !== entry) return;
    delete slots[entry.slot];
    if (!slots.plain && !slots.rotated) this.slots.delete(entry.source);
    if (this.ready.delete(entry)) { this.rawBytes -= entry.rawBytes; this.retainedBytes -= entry.retainedBytes; }
  }
  dispose(): void { this.closed = true; this.clear(); }
  clear(): void { this.slots.clear(); this.ready.clear(); this.retainedBytes = 0; this.rawBytes = 0; }
  stats(): DecodedImageCacheStats {
    let total = 0;
    for (const slots of this.slots.values()) total += Number(Boolean(slots.plain)) + Number(Boolean(slots.rotated));
    return { entries: this.ready.size, pendingEntries: total - this.ready.size, retainedBytes: this.retainedBytes, rawBytes: this.rawBytes,
      peakRetainedBytes: this.peakRetainedBytes, peakRawBytes: this.peakRawBytes, hits: this.hits, misses: this.misses, evictions: this.evictions };
  }
}
const context = new AsyncLocalStorage<DecodedImageCache>();
const standaloneCache = new DecodedImageCache();
const currentCache = (): DecodedImageCache => context.getStore() ?? standaloneCache;

/** Document entry points release retained raw pixels on success and failure. */
export async function withDecodedImageCache<T>(operation: () => Promise<T>, options: {
  maxBytes?: number; onDispose?: (stats: DecodedImageCacheStats) => void;
} = {}): Promise<T> {
  if (context.getStore() && !context.getStore()!.disposed) return operation();
  const maxBytes = options.maxBytes ?? MAX_DECODED_CACHE_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > MAX_DECODED_CACHE_BYTES) throw new Error("Invalid decoded image cache byte budget.");
  const cache = new DecodedImageCache(maxBytes);
  return context.run(cache, async () => {
    try { return await operation(); }
    finally { cache.dispose(); options.onDispose?.(cache.stats()); }
  });
}
export function decodedImageCacheStats(): DecodedImageCacheStats { return currentCache().stats(); }
/** Explicit release for standalone image-helper consumers. */
export function clearDecodedImageCache(): void { currentCache().clear(); }

export async function getDecodedImage(data: Buffer, options: { rotate?: boolean } = {}): Promise<DecodedImage | null> {
  const cache = currentCache(), slot = options.rotate ? "rotated" : "plain";
  const cached = cache.get(data, slot);
  if (cached) return cached.promise;
  const entry: CachedDecode = { source: data, slot, promise: Promise.resolve(null), retainedBytes: 0, rawBytes: 0 };
  entry.promise = decodeImageUncached(data, Boolean(options.rotate)).then(result => { cache.complete(entry, result); return result; },
    error => { cache.remove(entry); throw error; });
  cache.set(entry); return entry.promise;
}

/** Diagnostic lookup; does not retain or decode the supplied source. */
export async function peekDecodedImageCache(data: Buffer, options: { rotate?: boolean } = {}): Promise<"miss" | "hit"> {
  return currentCache().has(data, options.rotate ? "rotated" : "plain") ? "hit" : "miss";
}

async function decodeImageUncached(data: Buffer, rotate: boolean): Promise<DecodedImage | null> {
  if ((await readImageMetadata("", data)).preservationReason) return null;
  const bmp = decodeBmp(data);
  if (bmp) {
    return {
      data: bmp.data,
      width: bmp.width,
      height: bmp.height,
      channels: 3,
      autoOriented: false,
      indexed: bmp.indexed
    };
  }

  try {
    const pipeline = rotate ? sharp(data, SHARP_INPUT_OPTIONS).rotate() : sharp(data, SHARP_INPUT_OPTIONS);
    const decoded = await pipeline.toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
    if (!decoded.info.width || !decoded.info.height) return null;
    if (decoded.info.channels === 3 || decoded.info.channels === 4) {
      return {
        data: decoded.data,
        width: decoded.info.width,
        height: decoded.info.height,
        channels: decoded.info.channels,
        autoOriented: rotate,
        indexed: false
      };
    }
    // Normalize unexpected channel counts while retaining alpha.
    const rgb = await sharp(decoded.data, {
      ...SHARP_INPUT_OPTIONS,
      raw: {
        width: decoded.info.width,
        height: decoded.info.height,
        channels: decoded.info.channels
      }
    })
      .toColourspace("srgb")
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (rgb.info.channels !== 3 && rgb.info.channels !== 4) return null;
    return {
      data: rgb.data,
      width: rgb.info.width,
      height: rgb.info.height,
      channels: rgb.info.channels,
      autoOriented: rotate,
      indexed: false
    };
  } catch {
    return null;
  }
}
