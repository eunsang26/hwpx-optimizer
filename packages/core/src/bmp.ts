export type DecodedBmp = {
  width: number;
  height: number;
  data: Buffer;
};

export function decodeBmp(data: Buffer): DecodedBmp | null {
  if (data.length < 54 || data.toString("ascii", 0, 2) !== "BM") return null;

  const pixelOffset = data.readUInt32LE(10);
  const dibHeaderSize = data.readUInt32LE(14);
  if (dibHeaderSize < 40) return null;

  const width = data.readInt32LE(18);
  const rawHeight = data.readInt32LE(22);
  const planes = data.readUInt16LE(26);
  const bitsPerPixel = data.readUInt16LE(28);
  const compression = data.readUInt32LE(30);
  if (width <= 0 || rawHeight === 0 || planes !== 1 || compression !== 0) return null;
  if (bitsPerPixel !== 24 && bitsPerPixel !== 32) return null;

  const height = Math.abs(rawHeight);
  const topDown = rawHeight < 0;
  const sourceChannels = bitsPerPixel / 8;
  const rowSize = Math.ceil((width * sourceChannels) / 4) * 4;
  const expectedEnd = pixelOffset + rowSize * height;
  if (expectedEnd > data.length) return null;

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
