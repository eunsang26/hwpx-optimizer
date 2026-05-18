import { XMLBuilder, XMLParser } from "fast-xml-parser";
import sharp from "sharp";
import type { AppliedAction, HwpxPackage, OptimizationPlan } from "./types.js";

export async function applySafeOptimizationPlan(input: {
  pkg: HwpxPackage;
  plan: OptimizationPlan;
}): Promise<{ pkg: HwpxPackage; applied: AppliedAction[]; skipped: AppliedAction[]; warnings: string[] }> {
  const applied: AppliedAction[] = [];
  const skipped: AppliedAction[] = [];
  const warnings: string[] = [];
  const removeTargets = new Set(
    input.plan.actions.filter((action) => action.type === "remove-unused").map((action) => action.target)
  );
  const stripMetadataTargets = new Set(
    input.plan.actions.filter((action) => action.type === "strip-metadata").map((action) => action.target)
  );
  const optimizePngTargets = new Set(
    input.plan.actions.filter((action) => action.type === "optimize-png").map((action) => action.target)
  );
  const minifyXmlTargets = new Set(
    input.plan.actions.filter((action) => action.type === "minify-xml").map((action) => action.target)
  );

  const entries = [];
  for (const entry of input.pkg.entries) {
    if (removeTargets.has(entry.path)) {
      applied.push({ type: "remove-unused", target: entry.path, beforeSize: entry.size, afterSize: 0 });
      continue;
    }

    if (stripMetadataTargets.has(entry.path)) {
      try {
        const optimized = stripImageMetadataLossless(entry.path, entry.data);
        if (optimized.byteLength < entry.data.byteLength) {
          entries.push({ ...entry, data: optimized, size: optimized.byteLength });
          applied.push({
            type: "strip-metadata",
            target: entry.path,
            beforeSize: entry.size,
            afterSize: optimized.byteLength
          });
          continue;
        }
        skipped.push({ type: "strip-metadata", target: entry.path, beforeSize: entry.size });
      } catch (error) {
        skipped.push({ type: "strip-metadata", target: entry.path, beforeSize: entry.size });
        warnings.push(`strip-metadata skipped for ${entry.path}: ${describeError(error)}`);
      }
    }

    if (optimizePngTargets.has(entry.path)) {
      try {
        const optimized = await optimizePngLosslessly(entry.data);
        if (optimized.byteLength < entry.data.byteLength) {
          entries.push({ ...entry, data: optimized, size: optimized.byteLength });
          applied.push({
            type: "optimize-png",
            target: entry.path,
            beforeSize: entry.size,
            afterSize: optimized.byteLength
          });
          continue;
        }
        skipped.push({ type: "optimize-png", target: entry.path, beforeSize: entry.size });
      } catch (error) {
        skipped.push({ type: "optimize-png", target: entry.path, beforeSize: entry.size });
        warnings.push(`optimize-png skipped for ${entry.path}: ${describeError(error)}`);
      }
    }

    if (minifyXmlTargets.has(entry.path)) {
      try {
        const minified = minifyXml(entry.data.toString("utf8"));
        const data = Buffer.from(minified);
        if (data.byteLength < entry.data.byteLength) {
          entries.push({ ...entry, data, size: data.byteLength });
          applied.push({ type: "minify-xml", target: entry.path, beforeSize: entry.size, afterSize: data.byteLength });
          continue;
        }
        skipped.push({ type: "minify-xml", target: entry.path, beforeSize: entry.size, afterSize: data.byteLength });
      } catch (error) {
        skipped.push({ type: "minify-xml", target: entry.path, beforeSize: entry.size });
        warnings.push(`minify-xml skipped for ${entry.path}: ${describeError(error)}`);
      }
    }

    entries.push(entry);
  }

  return { pkg: { entries }, applied, skipped, warnings };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function minifyXml(xml: string): string {
  const parser = new XMLParser({ ignoreAttributes: false, preserveOrder: true });
  const builder = new XMLBuilder({ ignoreAttributes: false, preserveOrder: true, suppressEmptyNode: false });
  return builder.build(parser.parse(xml));
}

function stripImageMetadataLossless(path: string, data: Buffer): Buffer {
  if (/\.(jpe?g)$/i.test(path)) {
    return stripJpegMetadataSegments(data);
  }
  return data;
}

async function optimizePngLosslessly(data: Buffer): Promise<Buffer> {
  return sharp(data).png({ compressionLevel: 9, adaptiveFiltering: true, palette: false }).toBuffer();
}

export function stripJpegMetadataSegments(data: Buffer): Buffer {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) {
    return data;
  }

  const chunks: Buffer[] = [data.subarray(0, 2)];
  let offset = 2;

  while (offset < data.length) {
    if (data[offset] !== 0xff) {
      chunks.push(data.subarray(offset));
      break;
    }

    let markerOffset = offset;
    while (markerOffset < data.length && data[markerOffset] === 0xff) {
      markerOffset += 1;
    }
    if (markerOffset >= data.length) break;

    const marker = data[markerOffset];
    const segmentStart = offset;

    if (marker === 0xda || marker === 0xd9) {
      chunks.push(data.subarray(segmentStart));
      break;
    }

    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      chunks.push(data.subarray(segmentStart, markerOffset + 1));
      offset = markerOffset + 1;
      continue;
    }

    if (markerOffset + 2 >= data.length) {
      chunks.push(data.subarray(segmentStart));
      break;
    }

    const length = data.readUInt16BE(markerOffset + 1);
    const segmentEnd = markerOffset + 1 + length;
    if (length < 2 || segmentEnd > data.length) {
      chunks.push(data.subarray(segmentStart));
      break;
    }

    if (!isRemovableJpegMetadataSegment(marker, data, markerOffset + 3, segmentEnd)) {
      chunks.push(data.subarray(segmentStart, segmentEnd));
    }

    offset = segmentEnd;
  }

  return Buffer.concat(chunks);
}

function isRemovableJpegMetadataSegment(marker: number, data: Buffer, payloadStart: number, segmentEnd: number): boolean {
  if (marker === 0xed || marker === 0xfe) return true;
  if (marker !== 0xe1) return false;
  // APP1 carries both EXIF and XMP; preserving EXIF keeps orientation stable.
  if (payloadStart + 6 <= segmentEnd && data.subarray(payloadStart, payloadStart + 6).toString("ascii") === "Exif\0\0") {
    return false;
  }
  return true;
}
