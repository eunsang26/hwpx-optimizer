import { readFile } from "node:fs/promises";
import { aggressiveImageProfile, balancedImageProfile, readHwpxPackage } from "@hwpx-optimizer/core";
import { encodeJpegli, encodeMozjpeg, encodePng, resolveJpegliBin } from "./candidates.js";
import { evaluateAxisB } from "./axisB.js";
import type { BenchCorpus, CorpusDocument } from "./corpus.js";
import { JpegliToolMissingError } from "./jpegliCli.js";
import { repackWithImageBytes } from "./packageBytes.js";
import { buildBenchReport, type DocumentMeasurement, type ToolInvalidReason } from "./report.js";
import { isoQualityJpegliBytes, sweepJpegli, sweepMozjpeg } from "./rdCurve.js";
import { MetricToolMissingError, resolveSsimulacra2Bin } from "./ssimulacra2.js";
import { budgetsForPackage, decodeResizeToRaw } from "./resizeRaw.js";
import { Q_GRID, type BenchProfileName } from "./types.js";

function toolInvalidReason(error: unknown): ToolInvalidReason | undefined {
  if (error instanceof MetricToolMissingError) return "metric-tool-missing";
  if (error instanceof JpegliToolMissingError) return "jpegli-unavailable";
  return undefined;
}

function failedDocument(
  doc: CorpusDocument, error: unknown, stage: string,
  issues: DocumentMeasurement["issues"] = [], imagePath?: string
): DocumentMeasurement {
  const unavailable = toolInvalidReason(error);
  return {
    relativePath: doc.relativePath, source: doc.source, status: "error",
    reason: unavailable ?? "document-processing-failed",
    ...(unavailable ? { toolInvalidReason: unavailable } : {}),
    stats: null,
    issues: [...issues, { stage, ...(imagePath ? { imagePath } : {}),
      reason: unavailable ?? "processing-error",
      message: error instanceof Error ? error.message : String(error) }]
  };
}

export async function processDocument(
  doc: CorpusDocument, profileName: BenchProfileName
): Promise<DocumentMeasurement> {
  const identity = { relativePath: doc.relativePath, source: doc.source };
  const issues: DocumentMeasurement["issues"] = [];
  let stage = "read";
  let imagePath: string | undefined;
  try {
    const profile = profileName === "aggressive" ? aggressiveImageProfile : balancedImageProfile;
    const anchorQ = profile.jpegQuality;
    const original = await readFile(doc.absPath);
    stage = "package";
    const pkg = await readHwpxPackage(original);
    const budgets = budgetsForPackage(pkg, profileName);
    const mozReplacements = new Map<string, Buffer>();
    const jpegliReplacements = new Map<string, Buffer>();
    let jpegTotal = 0;
    let jpegExcluded = 0;
    let growCount = 0;
    const encodeCpuRatios: number[] = [];
    let axisBPasses = 0;
    let axisBTotal = 0;
    let pngControlBytes = 0;
    let mozWallMs = 0;
    let jpegliWallMs = 0;

    for (const entry of pkg.entries) {
      if (entry.kind !== "image") continue;
      imagePath = entry.path;
      const budget = budgets.get(entry.path);
      if (/\.png$/i.test(entry.path)) {
        stage = "png-control";
        const raw = await decodeResizeToRaw(entry.data, budget, profile);
        pngControlBytes += (await encodePng(raw, profile)).bytes.byteLength;
        continue;
      }
      if (!/\.jpe?g$/i.test(entry.path)) continue;
      jpegTotal += 1;
      stage = "decode";
      const raw = await decodeResizeToRaw(entry.data, budget, profile);
      stage = "mozjpeg-curve";
      const mozStart = performance.now();
      const mozPoints = await sweepMozjpeg(raw, Q_GRID);
      mozWallMs += performance.now() - mozStart;
      stage = "jpegli-curve";
      const jpegliStart = performance.now();
      const jpegliPoints = await sweepJpegli(raw, Q_GRID);
      jpegliWallMs += performance.now() - jpegliStart;

      const iso = isoQualityJpegliBytes(mozPoints, jpegliPoints, anchorQ);
      if (iso.status !== "ok") {
        jpegExcluded += 1;
        issues.push({ stage: "iso-quality", imagePath, reason: iso.reason });
        continue;
      }
      stage = "candidate-encode";
      const mozEnc = await encodeMozjpeg(raw, anchorQ);
      const jlEnc = await encodeJpegli(raw, Math.round(iso.quality));
      if (jlEnc.bytes.byteLength > entry.data.byteLength) growCount += 1;
      const mozAnchor = mozPoints.find((point) => point.quality === anchorQ);
      if (mozAnchor && mozAnchor.encodeMs > 0) encodeCpuRatios.push(iso.encodeMs / mozAnchor.encodeMs);
      mozReplacements.set(entry.path, mozEnc.bytes);
      jpegliReplacements.set(entry.path, jlEnc.bytes);
      stage = "axis-B";
      const axisB = await evaluateAxisB(entry.data, jlEnc.bytes, profileName);
      axisBTotal += 1;
      if (axisB.pass) axisBPasses += 1;
    }

    let packageSavingsPercent: number | null = null;
    imagePath = undefined;
    if (mozReplacements.size > 0) {
      stage = "repack";
      const mozPkg = await repackWithImageBytes(original, mozReplacements, { collapseByteIdentical: true });
      const jlPkg = await repackWithImageBytes(original, jpegliReplacements, { collapseByteIdentical: true });
      packageSavingsPercent = ((mozPkg.byteLength - jlPkg.byteLength) / mozPkg.byteLength) * 100;
    }
    const reason = jpegTotal === 0 ? "no-jpeg-images" :
      packageSavingsPercent === null ? "no-valid-jpegs" : undefined;
    return {
      ...identity,
      status: reason ? "no-data" : jpegExcluded > 0 ? "partial" : "ok",
      ...(reason ? { reason } : {}), issues,
      stats: { packageSavingsPercent, jpegTotal, jpegExcluded, growCount, encodeCpuRatios,
        wallClockDeltaPercent: mozWallMs === 0 ? 0 : ((jpegliWallMs - mozWallMs) / mozWallMs) * 100,
        axisBPasses, axisBTotal, pngControlBytes }
    };
  } catch (error) {
    return failedDocument(doc, error, stage, issues, imagePath);
  }
}

export async function measureCorpus(
  input: { profile: BenchProfileName; corpus: BenchCorpus },
  dependencies: {
    resolveMetric?: typeof resolveSsimulacra2Bin;
    resolveJpegli?: typeof resolveJpegliBin;
    processDocument?: typeof processDocument;
  } = {}
) {
  let unavailable: ToolInvalidReason | undefined =
    !(dependencies.resolveMetric ?? resolveSsimulacra2Bin)() ? "metric-tool-missing" :
    !(dependencies.resolveJpegli ?? resolveJpegliBin)() ? "jpegli-unavailable" : undefined;
  const documents: DocumentMeasurement[] = [];
  for (const doc of input.corpus.docs) {
    if (unavailable) {
      documents.push({ relativePath: doc.relativePath, source: doc.source, status: "skipped",
        reason: unavailable, stats: null, issues: [] });
      continue;
    }
    let result: DocumentMeasurement;
    try {
      result = await (dependencies.processDocument ?? processDocument)(doc, input.profile);
    } catch (error) {
      result = failedDocument(doc, error, "document");
    }
    documents.push(result);
    unavailable = result.toolInvalidReason;
  }
  return buildBenchReport({ ...input, documents, toolInvalidReason: unavailable });
}
