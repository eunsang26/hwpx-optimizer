import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import asar from "@electron/asar";

const releaseDir = "release";
const artifactLists = [];

const asarPath = join(releaseDir, "win-unpacked", "resources", "app.asar");
if (existsSync(asarPath)) {
  artifactLists.push({
    label: asarPath,
    entries: asar.listPackage(asarPath).map((entry) => entry.replace(/^\/+/, ""))
  });
}

const zipPath = join(releaseDir, "HWPX Optimizer-0.1.0-x64.zip");
if (existsSync(zipPath)) {
  artifactLists.push({
    label: zipPath,
    entries: execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" })
      .split(/\r?\n/)
      .filter(Boolean)
  });
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

console.log("Release artifact check passed.");
