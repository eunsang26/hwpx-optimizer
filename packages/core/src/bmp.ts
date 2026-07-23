export type DecodedBmp = {
  width: number;
  height: number;
  data: Buffer;
};

export type BmpInfo = {
  width: number;
  height: number;
  bitsPerPixel: number;
  compression: number;
  /** True when decodeBmp can turn this variant into a 24-bit RGB buffer. */
  supported: boolean;
};

type BmpHeader = {
  width: number;
  height: number;
  topDown: boolean;
  bitsPerPixel: number;
  compression: number;
  pixelOffset: number;
  dibHeaderSize: number;
  colorsUsed: number;
};

const SUPPORTED_BITS_PER_PIXEL = new Set([8, 24, 32]);

/**
 * Reads BMP header fields without decoding pixels. Cheap enough for candidate
 * pre-filtering and for reporting which BMP variant could not be optimized.
 */
export function readBmpInfo(data: Buffer): BmpInfo | null {
  const header = parseBmpHeader(data);
  if (!header) return null;
  return {
    width: header.width,
    height: header.height,
    bitsPerPixel: header.bitsPerPixel,
    compression: header.compression,
    supported: header.compression === 0 && SUPPORTED_BITS_PER_PIXEL.has(header.bitsPerPixel)
  };
}

export function decodeBmp(data: Buffer): DecodedBmp | null {
  const header = parseBmpHeader(data);
  if (!header) return null;
  // compression 0 = BI_RGB. RLE (1/2) and BI_BITFIELDS (3) are not handled.
  if (header.compression !== 0) return null;

  if (header.bitsPerPixel === 8) return decodePalettedBmp(data, header);
  if (header.bitsPerPixel === 24 || header.bitsPerPixel === 32) return decodeTrueColorBmp(data, header);
  return null;
}

function parseBmpHeader(data: Buffer): BmpHeader | null {
  if (data.length < 54 || data.toString("ascii", 0, 2) !== "BM") return null;

  const pixelOffset = data.readUInt32LE(10);
  const dibHeaderSize = data.readUInt32LE(14);
  if (dibHeaderSize < 40) return null;

  const width = data.readInt32LE(18);
  const rawHeight = data.readInt32LE(22);
  const planes = data.readUInt16LE(26);
  const bitsPerPixel = data.readUInt16LE(28);
  const compression = data.readUInt32LE(30);
  const colorsUsed = data.readUInt32LE(46);
  if (width <= 0 || rawHeight === 0 || planes !== 1) return null;

  return {
    width,
    height: Math.abs(rawHeight),
    topDown: rawHeight < 0,
    bitsPerPixel,
    compression,
    pixelOffset,
    dibHeaderSize,
    colorsUsed
  };
}

function decodeTrueColorBmp(data: Buffer, header: BmpHeader): DecodedBmp | null {
  const { width, height, topDown, bitsPerPixel, pixelOffset } = header;
  const sourceChannels = bitsPerPixel / 8;
  const rowSize = Math.ceil((width * sourceChannels) / 4) * 4;
  if (pixelOffset + rowSize * height > data.length) return null;

  // 32-bit BMPs carry a BGRA byte order; we intentionally drop the alpha byte
  // and emit a 24-bit RGB raw buffer so downstream PNG encoding goes through
  // a single shared path. HWP/HWPX BMPs in our corpus do not rely on alpha.
  const output = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    const sourceY = topDown ? y : height - 1 - y;
    const sourceRow = pixelOffset + sourceY * rowSize;
    const targetRow = y * width * 3;
    for (let x = 0; x < width; x += 1) {
      const source = sourceRow + x * sourceChannels;
      const target = targetRow + x * 3;
      output[target] = data[source + 2];
      output[target + 1] = data[source + 1];
      output[target + 2] = data[source];
    }
  }

  return { width, height, data: output };
}

function decodePalettedBmp(data: Buffer, header: BmpHeader): DecodedBmp | null {
  const { width, height, topDown, pixelOffset, dibHeaderSize, colorsUsed } = header;
  const paletteOffset = 14 + dibHeaderSize;
  const paletteEntries = colorsUsed > 0 ? colorsUsed : 256;
  if (paletteOffset + paletteEntries * 4 > data.length) return null;

  const rowSize = Math.ceil(width / 4) * 4;
  if (pixelOffset + rowSize * height > data.length) return null;

  const output = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    const sourceY = topDown ? y : height - 1 - y;
    const sourceRow = pixelOffset + sourceY * rowSize;
    const targetRow = y * width * 3;
    for (let x = 0; x < width; x += 1) {
      const paletteIndex = data[sourceRow + x];
      if (paletteIndex >= paletteEntries) return null;
      // Palette entries are stored as B, G, R, reserved.
      const palette = paletteOffset + paletteIndex * 4;
      const target = targetRow + x * 3;
      output[target] = data[palette + 2];
      output[target + 1] = data[palette + 1];
      output[target + 2] = data[palette];
    }
  }

  return { width, height, data: output };
}
