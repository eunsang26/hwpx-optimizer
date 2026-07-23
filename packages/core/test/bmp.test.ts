import { describe, expect, it } from "vitest";
import { decodeBmp, readBmpInfo } from "../src/bmp.js";

// Builds a minimal bottom-up BMP with the given bits-per-pixel / compression.
// For 8-bit, `palette` is a list of [r,g,b] and `rows` are palette indices
// (top row first); the builder writes them bottom-up as BMP requires.
function buildBmp(input: {
  width: number;
  height: number;
  bitsPerPixel: number;
  compression?: number;
  palette?: Array<[number, number, number]>;
  rows?: number[][];
}): Buffer {
  const { width, height, bitsPerPixel, compression = 0, palette = [], rows = [] } = input;
  const paletteBytes = Buffer.alloc(palette.length * 4);
  palette.forEach(([r, g, b], index) => {
    paletteBytes[index * 4] = b;
    paletteBytes[index * 4 + 1] = g;
    paletteBytes[index * 4 + 2] = r;
  });
  const rowSize = Math.ceil((width * bitsPerPixel) / 8 / 4) * 4;
  const pixelData = Buffer.alloc(rowSize * height);
  // rows[0] is the top row; BMP stores bottom row first.
  for (let y = 0; y < height; y += 1) {
    const sourceRow = rows[height - 1 - y] ?? [];
    for (let x = 0; x < width; x += 1) pixelData[y * rowSize + x] = sourceRow[x] ?? 0;
  }
  const pixelOffset = 14 + 40 + paletteBytes.length;
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
  return Buffer.concat([header, paletteBytes, pixelData]);
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
    expect([...(decoded?.data ?? [])]).toEqual([255, 0, 0, 0, 0, 255, 0, 0, 255, 255, 0, 0]);
  });

  it("returns null for unsupported compression (BI_BITFIELDS)", () => {
    const bmp = buildBmp({ width: 2, height: 2, bitsPerPixel: 32, compression: 3 });
    expect(decodeBmp(bmp)).toBeNull();
  });
});

describe("readBmpInfo", () => {
  it("reports dimensions and marks 8-bit BI_RGB as supported", () => {
    const bmp = buildBmp({ width: 4, height: 3, bitsPerPixel: 8, palette: [[0, 0, 0]], rows: [] });
    const info = readBmpInfo(bmp);
    expect(info).toMatchObject({ width: 4, height: 3, bitsPerPixel: 8, compression: 0, supported: true });
  });

  it("marks BI_BITFIELDS as unsupported while still reporting dimensions", () => {
    const bmp = buildBmp({ width: 4, height: 3, bitsPerPixel: 32, compression: 3 });
    expect(readBmpInfo(bmp)).toMatchObject({ width: 4, height: 3, supported: false });
  });

  it("returns null for non-BMP data", () => {
    expect(readBmpInfo(Buffer.from("not a bmp"))).toBeNull();
  });
});
