import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { CORPUS_DIR_ENV } from "./types.js";

export type CorpusFile = { relativePath: string; size: number; sha256: string };
export type CorpusManifest = { version: 1; files: CorpusFile[] };

export async function listHwpxFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".hwpx"))
    .map((entry) => join(dir, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

export async function hashFile(absPath: string, baseDir?: string): Promise<CorpusFile> {
  const data = await readFile(absPath);
  const sha256 = createHash("sha256").update(data).digest("hex");
  const relativePath = baseDir ? relative(baseDir, absPath) : basename(absPath);
  return { relativePath, size: data.byteLength, sha256 };
}

export async function buildManifest(dir: string): Promise<CorpusManifest> {
  const paths = await listHwpxFiles(dir);
  const files: CorpusFile[] = [];
  for (const absPath of paths) {
    files.push(await hashFile(absPath, dir));
  }
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return { version: 1, files };
}

function canonicalManifestJson(manifest: CorpusManifest): string {
  const sorted = [...manifest.files].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return JSON.stringify({ version: manifest.version, files: sorted }, null, 2) + "\n";
}

export function manifestId(manifest: CorpusManifest): string {
  return createHash("sha256").update(canonicalManifestJson(manifest)).digest("hex");
}

export async function verifyManifest(
  dir: string,
  manifest: CorpusManifest
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const current = await buildManifest(dir);
  const expected = [...manifest.files].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const actual = [...current.files].sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  if (expected.length !== actual.length) {
    return { ok: false, reason: "manifest-mismatch" };
  }

  for (let i = 0; i < expected.length; i++) {
    const exp = expected[i]!;
    const act = actual[i]!;
    if (
      exp.relativePath !== act.relativePath ||
      exp.size !== act.size ||
      exp.sha256 !== act.sha256
    ) {
      return { ok: false, reason: "manifest-mismatch" };
    }
  }

  return { ok: true };
}

export async function loadCorpus(options: {
  benchDir: string | undefined;
  fixturesDir: string;
  manifestPath: string;
}): Promise<{
  docs: Array<{ absPath: string; relativePath: string; source: "real" | "fixture" }>;
  goEligible: boolean;
  invalidReason?: string;
  manifestId: string;
}> {
  const manifestRaw = await readFile(options.manifestPath, "utf8");
  const manifest = JSON.parse(manifestRaw) as CorpusManifest;
  const id = manifestId(manifest);

  const fixturePaths = await listHwpxFiles(options.fixturesDir);
  const fixtureDocs = fixturePaths.map((absPath) => ({
    absPath,
    relativePath: basename(absPath),
    source: "fixture" as const
  }));

  const benchDir = options.benchDir?.trim();
  if (!benchDir) {
    return {
      docs: fixtureDocs,
      goEligible: false,
      invalidReason: "synthetic-only",
      manifestId: id
    };
  }

  const verification = await verifyManifest(benchDir, manifest);
  if (!verification.ok) {
    return {
      docs: fixtureDocs,
      goEligible: false,
      invalidReason: verification.reason,
      manifestId: id
    };
  }

  const realPaths = await listHwpxFiles(benchDir);
  const realDocs = realPaths.map((absPath) => ({
    absPath,
    relativePath: relative(benchDir, absPath),
    source: "real" as const
  }));

  return {
    docs: [...realDocs, ...fixtureDocs],
    goEligible: true,
    manifestId: id
  };
}

export async function writeManifestFile(manifestPath: string, dir: string): Promise<CorpusManifest> {
  const manifest = await buildManifest(dir);
  await writeFile(manifestPath, canonicalManifestJson(manifest), "utf8");
  return manifest;
}

export function resolveBenchDir(): string | undefined {
  const value = process.env[CORPUS_DIR_ENV]?.trim();
  return value || undefined;
}
