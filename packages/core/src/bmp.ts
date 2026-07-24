export type DecodedBmp = {
  width: number;
  height: number;
  data: Buffer;
  /**
   * True when the source used an indexed palette (1/4/8-bit). Callers may emit
   * a palette PNG even when the global profile has pngPalette disabled.
   */
  indexed: boolean;
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

const BI_RGB = 0;
const BI_BITFIELDS = 3;
const INDEXED_BITS_PER_PIXEL = new Set([1, 4, 8]);
const TRUECOLOR_BITS_PER_PIXEL = new Set([16, 24, 32]);

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
    supported: isSupportedBmpVariant(header)
  };
}

export function decodeBmp(data: Buffer): DecodedBmp | null {
  const header = parseBmpHeader(data);
  if (!header) return null;

  if (header.compression === BI_RGB) {
    if (INDEXED_BITS_PER_PIXEL.has(header.bitsPerPixel)) {
      return decodeIndexedBmp(data, header);
    }
    if (header.bitsPerPixel === 24 || header.bitsPerPixel === 32) {
      return decodeTrueColorBmp(data, header);
    }
    // 16-bit BI_RGB uses fixed 5-5-5 masks.
    if (header.bitsPerPixel === 16) {
      return decodeBitfieldsBmp(data, header, {
        redMask: 0x7c00,
        greenMask: 0x03e0,
        blueMask: 0x001f
      });
    }
    return null;
  }

  if (header.compression === BI_BITFIELDS) {
    const masks = readBitfieldMasks(data, header);
    if (!masks) return null;
    return decodeBitfieldsBmp(data, header, masks);
  }

  // RLE (1/2) and other compressions are not handled.
  return null;
}

function isSupportedBmpVariant(header: BmpHeader): boolean {
  if (header.compression === BI_RGB) {
    return (
      INDEXED_BITS_PER_PIXEL.has(header.bitsPerPixel) ||
      TRUECOLOR_BITS_PER_PIXEL.has(header.bitsPerPixel)
    );
  }
  if (header.compression === BI_BITFIELDS) {
    return header.bitsPerPixel === 16 || header.bitsPerPixel === 32;
  }
  return false;
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
      output[target] = data[source + 2]!;
      output[target + 1] = data[source + 1]!;
      output[target + 2] = data[source]!;
    }
  }

  return { width, height, data: output, indexed: false };
}

function decodeIndexedBmp(data: Buffer, header: BmpHeader): DecodedBmp | null {
  const { width, height, topDown, bitsPerPixel, pixelOffset, dibHeaderSize, colorsUsed } = header;
  const paletteOffset = 14 + dibHeaderSize;
  const defaultPaletteEntries = bitsPerPixel === 1 ? 2 : bitsPerPixel === 4 ? 16 : 256;
  const paletteEntries = colorsUsed > 0 ? colorsUsed : defaultPaletteEntries;
  if (paletteOffset + paletteEntries * 4 > data.length) return null;

  const rowSize = Math.ceil((width * bitsPerPixel) / 8 / 4) * 4;
  if (pixelOffset + rowSize * height > data.length) return null;

  const output = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    const sourceY = topDown ? y : height - 1 - y;
    const sourceRow = pixelOffset + sourceY * rowSize;
    const targetRow = y * width * 3;
    for (let x = 0; x < width; x += 1) {
      const paletteIndex = readIndexedPixel(data, sourceRow, x, bitsPerPixel);
      if (paletteIndex === null || paletteIndex >= paletteEntries) return null;
      // Palette entries are stored as B, G, R, reserved.
      const palette = paletteOffset + paletteIndex * 4;
      const target = targetRow + x * 3;
      output[target] = data[palette + 2]!;
      output[target + 1] = data[palette + 1]!;
      output[target + 2] = data[palette]!;
    }
  }

  return { width, height, data: output, indexed: true };
}

function readIndexedPixel(data: Buffer, sourceRow: number, x: number, bitsPerPixel: number): number | null {
  if (bitsPerPixel === 8) {
    return data[sourceRow + x] ?? null;
  }
  if (bitsPerPixel === 4) {
    const byte = data[sourceRow + Math.floor(x / 2)];
    if (byte === undefined) return null;
    return x % 2 === 0 ? (byte >> 4) & 0x0f : byte & 0x0f;
  }
  if (bitsPerPixel === 1) {
    const byte = data[sourceRow + Math.floor(x / 8)];
    if (byte === undefined) return null;
    const shift = 7 - (x % 8);
    return (byte >> shift) & 0x01;
  }
  return null;
}

type BitfieldMasks = {
  redMask: number;
  greenMask: number;
  blueMask: number;
};

function readBitfieldMasks(data: Buffer, header: BmpHeader): BitfieldMasks | null {
  // BITMAPINFOHEADER (40) stores masks immediately after the header.
  // BITMAPV4/V5 headers embed masks inside the DIB; read from fixed offsets.
  if (header.dibHeaderSize === 40) {
    const maskOffset = 14 + 40;
    if (maskOffset + 12 > data.length) return null;
    return {
      redMask: data.readUInt32LE(maskOffset),
      greenMask: data.readUInt32LE(maskOffset + 4),
      blueMask: data.readUInt32LE(maskOffset + 8)
    };
  }
  if (header.dibHeaderSize >= 108) {
    // bV4RedMask / Green / Blue at offsets 40/44/48 within the DIB.
    const dibStart = 14;
    return {
      redMask: data.readUInt32LE(dibStart + 40),
      greenMask: data.readUInt32LE(dibStart + 44),
      blueMask: data.readUInt32LE(dibStart + 48)
    };
  }
  return null;
}

function decodeBitfieldsBmp(data: Buffer, header: BmpHeader, masks: BitfieldMasks): DecodedBmp | null {
  const { width, height, topDown, bitsPerPixel, pixelOffset } = header;
  if (bitsPerPixel !== 16 && bitsPerPixel !== 32) return null;
  if (masks.redMask === 0 || masks.greenMask === 0 || masks.blueMask === 0) return null;

  const sourceChannels = bitsPerPixel / 8;
  const rowSize = Math.ceil((width * sourceChannels) / 4) * 4;
  if (pixelOffset + rowSize * height > data.length) return null;

  const redShift = maskShift(masks.redMask);
  const greenShift = maskShift(masks.greenMask);
  const blueShift = maskShift(masks.blueMask);
  const redMax = masks.redMask >> redShift;
  const greenMax = masks.greenMask >> greenShift;
  const blueMax = masks.blueMask >> blueShift;
  if (redMax === 0 || greenMax === 0 || blueMax === 0) return null;

  const output = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    const sourceY = topDown ? y : height - 1 - y;
    const sourceRow = pixelOffset + sourceY * rowSize;
    const targetRow = y * width * 3;
    for (let x = 0; x < width; x += 1) {
      const source = sourceRow + x * sourceChannels;
      const pixel =
        bitsPerPixel === 16 ? data.readUInt16LE(source) : data.readUInt32LE(source);
      const target = targetRow + x * 3;
      output[target] = scaleChannel((pixel & masks.redMask) >> redShift, redMax);
      output[target + 1] = scaleChannel((pixel & masks.greenMask) >> greenShift, greenMax);
      output[target + 2] = scaleChannel((pixel & masks.blueMask) >> blueShift, blueMax);
    }
  }

  return { width, height, data: output, indexed: false };
}

function maskShift(mask: number): number {
  if (mask === 0) return 0;
  let shift = 0;
  let value = mask;
  while ((value & 1) === 0) {
    value >>>= 1;
    shift += 1;
  }
  return shift;
}

function scaleChannel(value: number, max: number): number {
  if (max >= 255) return Math.min(255, value);
  return Math.round((value * 255) / max);
}
