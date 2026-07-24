#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  aggressiveImageProfile,
  balancedImageProfile,
  readHwpxPackage
} from "@hwpx-optimizer/core";
import { encodeJpegli, encodeMozjpeg, encodePng, resolveJpegliBin } from "./candidates.js";
import { loadCorpus, resolveBenchDir, writeManifestFile } from "./corpus.js";
import { evaluateAxisB } from "./axisB.js";
import { repackWithImageBytes } from "./packageBytes.js";
import {
  aggregateDocumentStats,
  buildBenchReport,
  buildSoftFlags,
  stderrVerdict,
  type DocumentJpegStats
} from "./report.js";
import { isoQualityJpegliBytes, sweepJpegli, sweepMozjpeg } from "./rdCurve.js";
import { MetricToolMissingError, resolveSsimulacra2Bin } from "./ssimulacra2.js";
import { budgetsForPackage, decodeResizeToRaw } from "./resizeRaw.js";
import { Q_GRID, CORPUS_DIR_ENV, type BenchProfileName } from "./types.js";

const benchRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixturesDir = join(benchRoot, "fixtures");
const manifestPath = join(benchRoot, "corpus.manifest.json");
const outDir = join(benchRoot, "out");
const reportPath = join(outDir, "rd-report.json");

function usage(): string {
  return `HWPX Phase A measurement bench

Usage:
  npm run bench -- rd --profile balanced|aggressive
  npm run bench:manifest
  npm run bench:spike

Environment:
  HWPX_BENCH_DIR          Local real corpus directory (required for GO eligibility)
  HWPX_BENCH_JPEGLI       Path to cjpegli (optional)
  HWPX_BENCH_SSIMULACRA2  Path to ssimulacra2 (optional)
`;
}

function parseProfile(args: string[]): BenchProfileName {
  const index = args.indexOf("--profile");
  const value = index >= 0 ? args[index + 1] : undefined;
  if (value === "balanced" || value === "aggressive") return value;
  throw new Error("rd requires --profile balanced|aggressive");
}

function isJpegPath(path: string): boolean {
  return /\.jpe?g$/i.test(path);
}

async function processDocument(
  absPath: string,
  profileName: BenchProfileName
): Promise<DocumentJpegStats & { pngControlBytes: number }> {
  const profile = profileName === "aggressive" ? aggressiveImageProfile : balancedImageProfile;
  const anchorQ = profile.jpegQuality;
  const original = await readFile(absPath);
  const pkg = await readHwpxPackage(original);
  const budgets = budgetsForPackage(pkg, profileName);

  const mozReplacements = new Map<string, Buffer>();
  const jpegliReplacements = new Map<string, Buffer>();

  let jpegTotal = 0;
  let jpegExcluded = 0;
  let growCount = 0;
  let okImageCount = 0;
  const encodeCpuRatios: number[] = [];
  let axisBPasses = 0;
  let axisBTotal = 0;
  let pngControlBytes = 0;

  const wallStart = performance.now();
  let mozWallMs = 0;
  let jpegliWallMs = 0;

  for (const entry of pkg.entries) {
    if (entry.kind === "image" && !isJpegPath(entry.path) && /\.png$/i.test(entry.path)) {
      const budget = budgets.get(entry.path);
      const raw = await decodeResizeToRaw(entry.data, budget, profile);
      const encoded = await encodePng(raw, profile);
      pngControlBytes += encoded.bytes.byteLength;
      continue;
    }

    if (entry.kind !== "image" || !isJpegPath(entry.path)) continue;
    jpegTotal += 1;

    const budget = budgets.get(entry.path);
    const raw = await decodeResizeToRaw(entry.data, budget, profile);

    const mozStart = performance.now();
    const mozPoints = await sweepMozjpeg(raw, Q_GRID);
    mozWallMs += performance.now() - mozStart;

    const jpegliStart = performance.now();
    const jpegliPoints = await sweepJpegli(raw, Q_GRID);
    jpegliWallMs += performance.now() - jpegliStart;

    const iso = isoQualityJpegliBytes(mozPoints, jpegliPoints, anchorQ);
    if (iso.status !== "ok") {
      jpegExcluded += 1;
      continue;
    }

    okImageCount += 1;

    const mozEnc = await encodeMozjpeg(raw, anchorQ);
    const jlEnc = await encodeJpegli(raw, Math.round(iso.quality));

    if (jlEnc.bytes.byteLength > entry.data.byteLength) {
      growCount += 1;
    }

    const mozAnchor = mozPoints.find((point) => point.quality === anchorQ);
    if (mozAnchor && mozAnchor.encodeMs > 0) {
      encodeCpuRatios.push(iso.encodeMs / mozAnchor.encodeMs);
    }

    mozReplacements.set(entry.path, mozEnc.bytes);
    jpegliReplacements.set(entry.path, jlEnc.bytes);

    const axisB = await evaluateAxisB(entry.data, jlEnc.bytes, profileName);
    axisBTotal += 1;
    if (axisB.pass) axisBPasses += 1;
  }

  const wallClockDeltaPercent =
    mozWallMs === 0 ? 0 : ((jpegliWallMs - mozWallMs) / mozWallMs) * 100;

  let packageSavingsPercent: number | null = null;
  if (okImageCount > 0) {
    const mozPkg = await repackWithImageBytes(original, mozReplacements, {
      collapseByteIdentical: true
    });
    const jlPkg = await repackWithImageBytes(original, jpegliReplacements, {
      collapseByteIdentical: true
    });
    if (mozPkg.byteLength > 0) {
      packageSavingsPercent = ((mozPkg.byteLength - jlPkg.byteLength) / mozPkg.byteLength) * 100;
    }
  }

  void wallStart;

  return {
    packageSavingsPercent,
    jpegTotal,
    jpegExcluded,
    growCount,
    encodeCpuRatios,
    wallClockDeltaPercent,
    axisBPasses,
    axisBTotal,
    pngControlBytes
  };
}

async function runManifest(): Promise<void> {
  const benchDir = resolveBenchDir();
  if (!benchDir) {
    throw new Error(`${CORPUS_DIR_ENV} must be set for manifest update`);
  }
  const manifest = await writeManifestFile(manifestPath, benchDir);
  console.log(`Wrote ${manifestPath} (${manifest.files.length} files)`);
}

async function runRd(args: string[]): Promise<void> {
  const profile = parseProfile(args);
  const corpus = await loadCorpus({
    benchDir: resolveBenchDir(),
    fixturesDir,
    manifestPath
  });

  await mkdir(outDir, { recursive: true });

  const realDocCount = corpus.docs.filter((doc) => doc.source === "real").length;

  if (!resolveSsimulacra2Bin()) {
    const toolReason = "metric-tool-missing";
    const report = buildBenchReport({
      profile,
      corpus: {
        manifestId: corpus.manifestId,
        goEligible: corpus.goEligible,
        invalidReason: corpus.invalidReason,
        documentCount: realDocCount
      },
      jpegStats: aggregateDocumentStats([]),
      pngRows: { controlBytesTotal: 0, webpEnabled: false, webpBytesTotal: null },
      softFlags: [],
      goEligible: false,
      invalidReason: corpus.invalidReason ?? toolReason
    });
    report.go = false;
    report.goReason = corpus.invalidReason ?? toolReason;
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.error(stderrVerdict(report));
    process.exit(0);
  }

  if (!resolveJpegliBin()) {
    const toolReason = "jpegli-unavailable";
    const report = buildBenchReport({
      profile,
      corpus: {
        manifestId: corpus.manifestId,
        goEligible: corpus.goEligible,
        invalidReason: corpus.invalidReason,
        documentCount: realDocCount
      },
      jpegStats: aggregateDocumentStats([]),
      pngRows: { controlBytesTotal: 0, webpEnabled: false, webpBytesTotal: null },
      softFlags: [],
      goEligible: false,
      invalidReason: corpus.invalidReason ?? toolReason
    });
    report.go = false;
    report.goReason = corpus.invalidReason ?? toolReason;
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.error(stderrVerdict(report));
    process.exit(0);
  }

  const docStats: DocumentJpegStats[] = [];
  let pngControlBytes = 0;
  let okImageCount = 0;

  for (const doc of corpus.docs) {
    try {
      const stats = await processDocument(doc.absPath, profile);
      pngControlBytes += stats.pngControlBytes;
      okImageCount += stats.jpegTotal - stats.jpegExcluded;
      if (doc.source === "real" || !corpus.goEligible) {
        docStats.push(stats);
      }
    } catch (error) {
      if (error instanceof MetricToolMissingError) {
        throw error;
      }
      docStats.push({
        packageSavingsPercent: null,
        jpegTotal: 0,
        jpegExcluded: 0,
        growCount: 0,
        encodeCpuRatios: [],
        wallClockDeltaPercent: 0,
        axisBPasses: 0,
        axisBTotal: 0
      });
    }
  }

  const jpegStats = aggregateDocumentStats(docStats);
  const softFlags = buildSoftFlags({
    encodeCpuRatioMedian: jpegStats.encodeCpuRatioMedian,
    axisBPassRate: jpegStats.axisBPassRate,
    growCount: jpegStats.growCount,
    okImageCount
  });

  const report = buildBenchReport({
    profile,
    corpus: {
      manifestId: corpus.manifestId,
      goEligible: corpus.goEligible,
      invalidReason: corpus.invalidReason,
      documentCount: realDocCount
    },
    jpegStats,
    pngRows: {
      controlBytesTotal: pngControlBytes,
      webpEnabled: false,
      webpBytesTotal: null
    },
    softFlags,
    goEligible: corpus.goEligible,
    invalidReason: corpus.invalidReason
  });

  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.error(stderrVerdict(report));
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;

  if (!command) {
    console.error(usage().trim());
    process.exit(1);
  }

  if (command === "manifest") {
    await runManifest();
    return;
  }

  if (command === "rd") {
    await runRd(rest);
    return;
  }

  if (command === "spike") {
    console.error("spike subcommand is not implemented yet.");
    process.exit(1);
  }

  console.error(usage().trim());
  process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
