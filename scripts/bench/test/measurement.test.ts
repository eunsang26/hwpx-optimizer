import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHwpxFixture } from "../../../packages/core/test/fixtures.js";
import { loadCorpus, writeManifestFile, type BenchCorpus, type CorpusDocument } from "../src/corpus.js";
import { measureCorpus, processDocument } from "../src/measurement.js";
import { MetricToolMissingError } from "../src/ssimulacra2.js";
import { JpegliToolMissingError } from "../src/jpegliCli.js";
import { stderrVerdict } from "../src/report.js";
import { sweepJpegli, sweepMozjpeg } from "../src/rdCurve.js";
import * as packageBytes from "../src/packageBytes.js";

// Controlled curves/encoder isolate corpus accounting from external tools.
// ZIP reading, Sharp decoding/encoding, repacking and manifest verification are real.
vi.mock("../src/rdCurve.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/rdCurve.js")>(),
  sweepMozjpeg: vi.fn(), sweepJpegli: vi.fn()
}));
vi.mock("../src/candidates.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/candidates.js")>();
  return { ...actual, encodeJpegli: (raw: Parameters<typeof actual.encodeMozjpeg>[0]) =>
    actual.encodeMozjpeg(raw, 40) };
});

const directories: string[] = [];
const toolsPresent = { resolveMetric: () => "test-metric", resolveJpegli: () => "test-jpegli" };
const digest = (data: Buffer) => createHash("sha256").update(data).digest("hex");

beforeEach(() => {
  vi.mocked(sweepMozjpeg).mockReset().mockResolvedValue([
    { quality: 88, bytes: 1000, score: 90, encodeMs: 2 }
  ]);
  vi.mocked(sweepJpegli).mockReset().mockResolvedValue([
    { quality: 60, bytes: 500, score: 85, encodeMs: 2 },
    { quality: 90, bytes: 900, score: 95, encodeMs: 3 }
  ]);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function workspace() {
  const dir = await mkdtemp(join(tmpdir(), "hwpx-bench-measurement-"));
  directories.push(dir);
  return dir;
}

async function photoDocument(count = 1) {
  const raw = Buffer.alloc(96 * 96 * 3);
  let seed = 1;
  for (let i = 0; i < raw.length; i++) {
    seed = Math.imul(seed, 1664525) + 1013904223 | 0;
    raw[i] = seed >>> 24;
  }
  const image = await sharp(raw, { raw: { width: 96, height: 96, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
  return createHwpxFixture({ entries: Object.fromEntries(Array.from({ length: count },
    (_, i) => [`BinData/photo${i}.jpg`, image])) });
}

function document(dir: string, name: string, source: "real" | "fixture" = "real"): CorpusDocument {
  return { absPath: join(dir, name), relativePath: name, source };
}
function corpus(docs: CorpusDocument[]): BenchCorpus {
  return { docs, manifestId: "controlled-test", goEligible: true };
}

describe("corpus measurement execution", () => {
  it("records a real ZIP error and blocks GO despite profitable survivors, preserving inputs", async () => {
    const dir = await workspace();
    const good = await photoDocument();
    const broken = Buffer.from("invalid HWPX ZIP");
    await writeFile(join(dir, "good.hwpx"), good);
    await writeFile(join(dir, "broken.hwpx"), broken);
    const fixtureDir = await workspace();
    await writeFile(join(fixtureDir, "diagnostic.hwpx"), good);
    const manifest = join(dir, "manifest.json");
    await writeManifestFile(manifest, dir);
    const loaded = await loadCorpus({ benchDir: dir, fixturesDir: fixtureDir, manifestPath: manifest });
    expect(loaded.goEligible).toBe(true);
    const report = await measureCorpus({ profile: "balanced", corpus: loaded }, toolsPresent);
    expect(report.jpegli.medianPackageSavingsPercent).toBeGreaterThan(15);
    expect(report).toMatchObject({ go: false, goReason: "document-processing-failed",
      statistics: { source: "real", documentCount: 2, failedDocumentCount: 1, medianDocumentCount: 1 } });
    expect(stderrVerdict(report)).toBe("NO-GO");
    expect(report.documents.find((doc) => doc.relativePath === "broken.hwpx")).toMatchObject({
      status: "error", stats: null, medianExclusionReason: "document-processing-failed",
      issues: [{ stage: "package", reason: "processing-error", message: expect.any(String) }]
    });
    expect(report.documents.find((doc) => doc.source === "fixture")?.includedInStatistics).toBe(false);
    const output = join(dir, "rd-report.json");
    await writeFile(output, JSON.stringify(report));
    expect(JSON.parse(await readFile(output, "utf8")).documents).toHaveLength(3);
    expect(digest(await readFile(join(dir, "good.hwpx")))).toBe(digest(good));
    expect(digest(await readFile(join(dir, "broken.hwpx")))).toBe(digest(broken));
  });

  it("retains partial JPEG matches and their individual exclusion reasons", async () => {
    const dir = await workspace();
    await writeFile(join(dir, "partial.hwpx"), await photoDocument(5));
    vi.mocked(sweepJpegli).mockResolvedValueOnce([]);
    const result = await processDocument(document(dir, "partial.hwpx"), "balanced");
    expect(result).toMatchObject({ status: "partial", stats: { jpegTotal: 5, jpegExcluded: 1 },
      issues: [{ stage: "iso-quality", imagePath: "BinData/photo0.jpg", reason: "curve-miss" }] });
    expect(result.stats?.packageSavingsPercent).toBeGreaterThan(15);
    const report = await measureCorpus({ profile: "balanced", corpus: corpus([document(dir, "partial.hwpx")]) },
      { ...toolsPresent, processDocument: async () => result });
    expect(report).toMatchObject({ go: true, jpegli: { jpegExclusionRatio: 0.2 },
      statistics: { partialDocumentCount: 1, medianDocumentCount: 1 } });
  });

  it("distinguishes no JPEGs from all unmatched JPEGs", async () => {
    const dir = await workspace();
    await writeFile(join(dir, "no-jpeg.hwpx"), await createHwpxFixture({ entries: {} }));
    await writeFile(join(dir, "no-match.hwpx"), await photoDocument());
    vi.mocked(sweepJpegli).mockResolvedValue([]);
    const text = await processDocument(document(dir, "no-jpeg.hwpx"), "balanced");
    const noMatch = await processDocument(document(dir, "no-match.hwpx"), "balanced");
    expect(text).toMatchObject({ status: "no-data", reason: "no-jpeg-images",
      stats: { packageSavingsPercent: null, jpegTotal: 0 }, issues: [] });
    expect(noMatch).toMatchObject({ status: "no-data", reason: "no-valid-jpegs",
      stats: { packageSavingsPercent: null, jpegTotal: 1, jpegExcluded: 1 },
      issues: [{ stage: "iso-quality", reason: "curve-miss" }] });
  });

  it("records missing-input, image-decode and repack failures without fake zero statistics", async () => {
    const dir = await workspace();
    const missing = await processDocument(document(dir, "missing.hwpx"), "balanced");
    expect(missing).toMatchObject({ status: "error", stats: null, issues: [{ stage: "read" }] });
    await writeFile(join(dir, "bad-image.hwpx"), await createHwpxFixture({ entries: {
      "BinData/bad.jpg": Buffer.from("not an image")
    } }));
    const badImage = await processDocument(document(dir, "bad-image.hwpx"), "balanced");
    expect(badImage).toMatchObject({ status: "error", stats: null,
      issues: [{ stage: "decode", imagePath: "BinData/bad.jpg", reason: "processing-error" }] });
    await writeFile(join(dir, "photo.hwpx"), await photoDocument());
    vi.spyOn(packageBytes, "repackWithImageBytes").mockRejectedValueOnce(new Error("controlled repack failure"));
    const repack = await processDocument(document(dir, "photo.hwpx"), "balanced");
    expect(repack).toMatchObject({ status: "error", stats: null,
      issues: [{ stage: "repack", message: "controlled repack failure" }] });
  });

  it.each(["metric-tool-missing", "jpegli-unavailable"] as const)(
    "writes explicit skipped rows and INVALID for preflight %s", async (reason) => {
      const docs = [document("/not-read", "first.hwpx"), document("/not-read", "second.hwpx")];
      const process = vi.fn();
      const report = await measureCorpus({ profile: "balanced", corpus: corpus(docs) }, {
        ...toolsPresent, processDocument: process,
        ...(reason === "metric-tool-missing" ? { resolveMetric: () => null } : { resolveJpegli: () => null })
      });
      expect(process).not.toHaveBeenCalled();
      expect(report).toMatchObject({ go: false, goReason: reason, invalidReasons: [reason],
        statistics: { documentCount: 2, skippedDocumentCount: 2, medianDocumentCount: 0 } });
      expect(report.documents.every((doc) => doc.status === "skipped" && doc.reason === reason &&
        doc.medianExclusionReason === reason)).toBe(true);
      expect(stderrVerdict(report)).toBe("INVALID");
    }
  );

  it.each([new MetricToolMissingError(), new JpegliToolMissingError()])(
    "retains earlier results and writes INVALID when %s disappears mid-run", async (error) => {
      const dir = await workspace();
      await writeFile(join(dir, "photo.hwpx"), await photoDocument());
      const docs = [document(dir, "photo.hwpx"), document(dir, "second.hwpx"), document(dir, "third.hwpx")];
      const first = await processDocument(docs[0]!, "balanced");
      const process = vi.fn().mockResolvedValueOnce(first).mockRejectedValueOnce(error);
      const report = await measureCorpus({ profile: "balanced", corpus: corpus(docs) }, {
        ...toolsPresent, processDocument: process
      });
      const reason = error instanceof MetricToolMissingError ? "metric-tool-missing" : "jpegli-unavailable";
      expect(report).toMatchObject({ go: false, goReason: reason, invalidReasons: [reason],
        statistics: { failedDocumentCount: 1, skippedDocumentCount: 1, medianDocumentCount: 1 } });
      expect(report.documents.map((doc) => doc.status)).toEqual(["ok", "error", "skipped"]);
      expect(process).toHaveBeenCalledTimes(2);
      expect(stderrVerdict(report)).toBe("INVALID");
    }
  );

  it("records a tool lost inside a document with its image and stage", async () => {
    const dir = await workspace();
    await writeFile(join(dir, "photo.hwpx"), await photoDocument());
    vi.mocked(sweepMozjpeg).mockRejectedValueOnce(new MetricToolMissingError("controlled missing metric"));
    const result = await processDocument(document(dir, "photo.hwpx"), "balanced");
    expect(result).toMatchObject({ status: "error", reason: "metric-tool-missing", stats: null,
      toolInvalidReason: "metric-tool-missing", issues: [{ stage: "mozjpeg-curve",
        imagePath: "BinData/photo0.jpg", reason: "metric-tool-missing", message: "controlled missing metric" }] });
  });
});
