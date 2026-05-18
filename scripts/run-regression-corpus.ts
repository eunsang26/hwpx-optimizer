#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import JSZip from "jszip";
import { evaluateRegressionCorpus } from "@hwpx-optimizer/core";
import type { RegressionCorpusCase } from "@hwpx-optimizer/core";

const DEFAULT_MAX_TOTAL_MS = 15_000;
const requireLocalSamples = process.argv.includes("--require-local-samples");

const cases: RegressionCorpusCase[] = [
  {
    name: "synthetic-shape-comment-cleanup",
    input: await createHwpxFixture({
      "Contents/section0.xml": `<root><hp:shapeComment>그림입니다.
원본 그림의 이름: IMG_1234.JPG
원본 그림의 크기: 가로 5712pixel, 세로 4284pixel</hp:shapeComment></root>`
    }),
    mode: "balanced",
    actions: ["clean-shape-comment"],
    allowLarger: true,
    requiredActions: ["clean-shape-comment"],
    maxTotalMs: DEFAULT_MAX_TOTAL_MS,
    maxStageMs: { read: 3000, analyze: 5000, write: 5000 }
  },
  {
    name: "synthetic-protected-reject",
    input: await createHwpxFixture({
      "_xmlsignatures/sig1.xml": "<Signature />"
    }),
    mode: "reject",
    expectedErrorIncludes: "보안 처리된 문서는 최적화 대상이 아닙니다"
  }
];

const localSamplePaths = await resolveLocalSamplePaths();
if (requireLocalSamples && localSamplePaths.length === 0) {
  throw new Error(
    "Release corpus requires at least one local real HWPX sample. Set HWPX_OPT_CORPUS_SAMPLES or place sample*.hwpx files in the repository root."
  );
}

for (const samplePath of localSamplePaths) {
  cases.push({
    name: `local-${basename(samplePath)}`,
    input: await readFile(samplePath),
    mode: sampleModeFromEnvironment(),
    targetBytes: optionalPositiveNumber(process.env.HWPX_OPT_CORPUS_TARGET_BYTES),
    maxTotalMs: optionalPositiveNumber(process.env.HWPX_OPT_CORPUS_MAX_TOTAL_MS) ?? 120_000,
    maxOutputBytes: optionalPositiveNumber(process.env.HWPX_OPT_CORPUS_MAX_OUTPUT_BYTES)
  });
}

const summary = await evaluateRegressionCorpus(cases);
for (const result of summary.results) {
  const status = result.passed ? "PASS" : "FAIL";
  const totalMs = result.report?.performance?.totalMs ?? result.durationMs;
  const savedBytes = result.report?.savedBytes ?? 0;
  const outputBytes = result.outputBytes ?? result.report?.optimizedSize ?? result.report?.originalSize;
  console.log(`${status} ${result.name} mode=${result.mode} time=${totalMs.toFixed(1)}ms saved=${savedBytes} output=${outputBytes ?? "-"}`);
  for (const failure of result.failures) {
    console.log(`  - ${failure}`);
  }
}

console.log(`Regression corpus: ${summary.total - summary.failed}/${summary.total} passed`);
if (!summary.passed) process.exitCode = 1;

async function createHwpxFixture(entries: Record<string, string | Buffer>): Promise<Buffer> {
  const zip = new JSZip();
  const allEntries = {
    "Contents/content.hpf": '<opf:package xmlns:opf="http://www.idpf.org/2007/opf" />',
    "Contents/section0.xml": "<root />",
    ...entries
  };
  for (const [path, content] of Object.entries(allEntries)) {
    zip.file(path, content);
  }
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}

function samplePathsFromEnvironment(): string[] {
  return (process.env.HWPX_OPT_CORPUS_SAMPLES ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function resolveLocalSamplePaths(): Promise<string[]> {
  const explicit = samplePathsFromEnvironment();
  if (explicit.length > 0) return explicit;
  if (!requireLocalSamples) return [];
  const entries = await readdir(process.cwd(), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /^sample\d*\.hwpx$/i.test(name))
    .sort()
    .map((name) => join(process.cwd(), name));
}

function sampleModeFromEnvironment(): "analyze" | "safe" | "balanced" | "aggressive" {
  const mode = process.env.HWPX_OPT_CORPUS_MODE ?? "balanced";
  if (mode === "analyze" || mode === "safe" || mode === "balanced" || mode === "aggressive") return mode;
  throw new Error("HWPX_OPT_CORPUS_MODE must be analyze, safe, balanced, or aggressive.");
}

function optionalPositiveNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive numeric corpus budget, got: ${value}`);
  }
  return Math.floor(parsed);
}
