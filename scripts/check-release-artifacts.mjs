import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import asar from "@electron/asar";
import JSZip from "jszip";

const releaseDir = "release";
const artifactLists = [];
const zipArtifactLists = [];

for (const asarPath of await findReleaseFiles(releaseDir, (name) => name === "app.asar")) {
  artifactLists.push({
    label: asarPath,
    entries: asar.listPackage(asarPath).map((entry) => entry.replace(/^\/+/, ""))
  });
}

for (const zipPath of await findReleaseFiles(releaseDir, (name) => name.toLowerCase().endsWith(".zip"))) {
  const zip = await JSZip.loadAsync(await readFile(zipPath));
  const zipArtifact = {
    label: zipPath,
    entries: Object.keys(zip.files)
  };
  artifactLists.push(zipArtifact);
  zipArtifactLists.push(zipArtifact);
}

if (artifactLists.length === 0) {
  console.log("Release artifact check skipped: no inspectable Windows artifacts found.");
  process.exit(0);
}

const forbiddenPatterns = [
  /(^|\/)\.git(\/|$)/,
  /(^|\/)\.vscode(\/|$)/,
  /(^|\/)\.tmp(\/|$)/,
  /(^|\/)\.npm-cache(\/|$)/,
  /(^|\/)smoke-workspace(\/|$)/,
  /(^|\/)settings\.json$/i,
  /(^|\/)(recent-files|history|processing-history)\.json$/i,
  /(^|\/).*\.log$/i,
  /(^|\/)sample.*\.(hwp|hwpx|json|txt)$/i,
  /(^|\/).*\.report\.json$/i,
  /(^|\/).*\.optimized\.hwpx$/i,
  /\.map$/i,
  /\.d\.ts$/i,
  /\.tsbuildinfo$/i,
  /\.test\.[cm]?[jt]s$/i,
  /(^|\/)(test|__tests__)(\/|$)/i,
  /(^|\/)docs(\/|$)/i
];

const violations = artifactLists.flatMap(({ label, entries }) =>
  entries
    .filter((entry) => forbiddenPatterns.some((pattern) => pattern.test(entry)))
    .map((entry) => `${label}: ${entry}`)
);

if (violations.length > 0) {
  console.error("Release artifact check failed. Packaged artifacts include development or user-history files:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

const zipArtifactsMissingTerms = zipArtifactLists
  .filter(({ entries }) => !entries.some((entry) => /(^|\/)TERMS\.txt$/i.test(entry)))
  .map(({ label }) => label);

if (zipArtifactsMissingTerms.length > 0) {
  console.error("Release artifact check failed. Windows ZIP artifacts must include TERMS.txt:");
  for (const label of zipArtifactsMissingTerms) {
    console.error(`- ${label}`);
  }
  process.exit(1);
}

console.log("Release artifact check passed.");

async function findReleaseFiles(directory, matches) {
  if (!existsSync(directory)) return [];
  const results = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await findReleaseFiles(path, matches)));
      continue;
    }
    if (entry.isFile() && matches(basename(path))) results.push(path);
  }
  return results;
}
