import { describe, expect, it } from "vitest";
import { decodeBmp, readBmpInfo } from "../src/bmp.js";

// Builds a minimal bottom-up BMP with the given bits-per-pixel / compression.
// For indexed formats, `palette` is a list of [r,g,b] and `rows` are palette
// indices (top row first); the builder writes them bottom-up as BMP requires.
function buildBmp(input: {
  width: number;
  height: number;
  bitsPerPixel: number;
  compression?: number;
  palette?: Array<[number, number, number]>;
  rows?: number[][];
  masks?: { red: number; green: number; blue: number };
  pixelWords?: number[][];
}): Buffer {
  const {
    width,
    height,
    bitsPerPixel,
    compression = 0,
    palette = [],
    rows = [],
    masks,
    pixelWords = []
  } = input;
  const paletteBytes = Buffer.alloc(palette.length * 4);
  palette.forEach(([r, g, b], index) => {
    paletteBytes[index * 4] = b;
    paletteBytes[index * 4 + 1] = g;
    paletteBytes[index * 4 + 2] = r;
  });
  const maskBytes =
    compression === 3 && masks
      ? (() => {
          const buf = Buffer.alloc(12);
          buf.writeUInt32LE(masks.red, 0);
          buf.writeUInt32LE(masks.green, 4);
          buf.writeUInt32LE(masks.blue, 8);
          return buf;
        })()
      : Buffer.alloc(0);

  const rowSize = Math.ceil((width * bitsPerPixel) / 8 / 4) * 4;
  const pixelData = Buffer.alloc(rowSize * height);
  if (bitsPerPixel === 16 || (bitsPerPixel === 32 && compression === 3)) {
    const bytesPerPixel = bitsPerPixel / 8;
    for (let y = 0; y < height; y += 1) {
      const sourceRow = pixelWords[height - 1 - y] ?? [];
      for (let x = 0; x < width; x += 1) {
        const offset = y * rowSize + x * bytesPerPixel;
        const value = sourceRow[x] ?? 0;
        if (bitsPerPixel === 16) pixelData.writeUInt16LE(value, offset);
        else pixelData.writeUInt32LE(value, offset);
      }
    }
  } else if (bitsPerPixel === 1 || bitsPerPixel === 4 || bitsPerPixel === 8) {
    for (let y = 0; y < height; y += 1) {
      const sourceRow = rows[height - 1 - y] ?? [];
      for (let x = 0; x < width; x += 1) {
        const index = sourceRow[x] ?? 0;
        if (bitsPerPixel === 8) {
          pixelData[y * rowSize + x] = index;
        } else if (bitsPerPixel === 4) {
          const byteIndex = y * rowSize + Math.floor(x / 2);
          if (x % 2 === 0) pixelData[byteIndex] = (index & 0x0f) << 4;
          else pixelData[byteIndex] = (pixelData[byteIndex]! & 0xf0) | (index & 0x0f);
        } else {
          const byteIndex = y * rowSize + Math.floor(x / 8);
          const shift = 7 - (x % 8);
          pixelData[byteIndex] = (pixelData[byteIndex]! & ~(1 << shift)) | ((index & 1) << shift);
        }
      }
    }
  }

  const pixelOffset = 14 + 40 + maskBytes.length + paletteBytes.length;
  const header = Buffer.alloc(14 + 40);
  header.write("BM", 0, "ascii");
  header.writeUInt32LE(pixelOffset + pixelData.length, 2);
  header.writeUInt32LE(pixelOffset, 10);
  header.writeUInt32LE(40, 14);
  header.writeInt32LE(width, 18);
  header.writeInt32LE(height, 22);
  header.writeUInt16LE(1, 26);
  header.writeUInt16LE(bitsPerPixel, 28);
  header.writeUInt32LE(compression, 30);
  header.writeUInt32LE(palette.length, 46);
  return Buffer.concat([header, maskBytes, paletteBytes, pixelData]);
}

describe("decodeBmp", () => {
  it("decodes an 8-bit paletted BMP to top-down RGB", () => {
    const red: [number, number, number] = [255, 0, 0];
    const blue: [number, number, number] = [0, 0, 255];
    const bmp = buildBmp({
      width: 2,
      height: 2,
      bitsPerPixel: 8,
      palette: [red, blue],
      rows: [
        [0, 1], // top: red, blue
        [1, 0] // bottom: blue, red
      ]
    });

    const decoded = decodeBmp(bmp);
    expect(decoded).not.toBeNull();
    expect(decoded?.width).toBe(2);
    expect(decoded?.height).toBe(2);
    expect(decoded?.indexed).toBe(true);
    expect([...(decoded?.data ?? [])]).toEqual([255, 0, 0, 0, 0, 255, 0, 0, 255, 255, 0, 0]);
  });

  it("decodes a 4-bit paletted BMP", () => {
    const red: [number, number, number] = [255, 0, 0];
    const green: [number, number, number] = [0, 255, 0];
    const bmp = buildBmp({
      width: 2,
      height: 1,
      bitsPerPixel: 4,
      palette: [red, green],
      rows: [[0, 1]]
    });
    const decoded = decodeBmp(bmp);
    expect(decoded?.indexed).toBe(true);
    expect([...(decoded?.data ?? [])]).toEqual([255, 0, 0, 0, 255, 0]);
  });

  it("decodes a 1-bit paletted BMP", () => {
    const black: [number, number, number] = [0, 0, 0];
    const white: [number, number, number] = [255, 255, 255];
    const bmp = buildBmp({
      width: 2,
      height: 1,
      bitsPerPixel: 1,
      palette: [black, white],
      rows: [[0, 1]]
    });
    const decoded = decodeBmp(bmp);
    expect(decoded?.indexed).toBe(true);
    expect([...(decoded?.data ?? [])]).toEqual([0, 0, 0, 255, 255, 255]);
  });

  it("decodes BI_BITFIELDS 16-bit RGB565", () => {
    // red=0xF800, green=0x07E0, blue=0x001F — pure red ≈ 0xF800
    const bmp = buildBmp({
      width: 1,
      height: 1,
      bitsPerPixel: 16,
      compression: 3,
      masks: { red: 0xf800, green: 0x07e0, blue: 0x001f },
      pixelWords: [[0xf800]]
    });
    const decoded = decodeBmp(bmp);
    expect(decoded?.indexed).toBe(false);
    expect(decoded?.data[0]).toBe(255);
    expect(decoded?.data[1]).toBe(0);
    expect(decoded?.data[2]).toBe(0);
  });

  it("returns null for unsupported RLE compression", () => {
    const bmp = buildBmp({ width: 2, height: 2, bitsPerPixel: 8, compression: 1, palette: [[0, 0, 0]] });
    expect(decodeBmp(bmp)).toBeNull();
  });
});

describe("readBmpInfo", () => {
  it("reports dimensions and marks 8-bit BI_RGB as supported", () => {
    const bmp = buildBmp({ width: 4, height: 3, bitsPerPixel: 8, palette: [[0, 0, 0]], rows: [] });
    const info = readBmpInfo(bmp);
    expect(info).toMatchObject({ width: 4, height: 3, bitsPerPixel: 8, compression: 0, supported: true });
  });

  it("marks BI_BITFIELDS 16-bit as supported", () => {
    const bmp = buildBmp({
      width: 4,
      height: 3,
      bitsPerPixel: 16,
      compression: 3,
      masks: { red: 0xf800, green: 0x07e0, blue: 0x001f },
      pixelWords: []
    });
    expect(readBmpInfo(bmp)).toMatchObject({ width: 4, height: 3, supported: true });
  });

  it("marks RLE as unsupported while still reporting dimensions", () => {
    const bmp = buildBmp({ width: 4, height: 3, bitsPerPixel: 8, compression: 1, palette: [[0, 0, 0]] });
    expect(readBmpInfo(bmp)).toMatchObject({ width: 4, height: 3, supported: false });
  });

  it("returns null for non-BMP data", () => {
    expect(readBmpInfo(Buffer.from("not a bmp"))).toBeNull();
  });
});
