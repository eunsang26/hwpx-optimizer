#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCorpus, resolveBenchDir, writeManifestFile } from "./corpus.js";
import { measureCorpus } from "./measurement.js";
import { stderrVerdict } from "./report.js";
import { emitHangulSpikeArtifacts } from "./spikeHangul.js";
import { CORPUS_DIR_ENV, type BenchProfileName } from "./types.js";

const benchRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixturesDir = join(benchRoot, "fixtures");
const manifestPath = join(benchRoot, "corpus.manifest.json");
const outDir = join(benchRoot, "out");
const spikeOutDir = join(outDir, "spike");
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

  const report = await measureCorpus({ profile, corpus });

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
    const result = await emitHangulSpikeArtifacts(spikeOutDir);
    console.log(`Wrote ${result.files.length} spike artifacts to ${result.outDir}`);
    if (result.avifSkipped) {
      console.warn(`AVIF spike skipped: ${result.avifSkipReason ?? "encode unavailable"}`);
    }
    return;
  }

  console.error(usage().trim());
  process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
