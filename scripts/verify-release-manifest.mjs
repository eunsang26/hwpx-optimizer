import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const releaseDir = "release";
const manifestPath = join(releaseDir, "release-manifest.json");
const sumsPath = join(releaseDir, "SHA256SUMS.txt");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const sums = parseSha256Sums(await readFile(sumsPath, "utf8"));

if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
  throw new Error("Release manifest has no artifacts.");
}

for (const artifact of manifest.artifacts) {
  if (!artifact.file || typeof artifact.sha256 !== "string" || typeof artifact.bytes !== "number") {
    throw new Error(`Release manifest has an invalid artifact entry: ${JSON.stringify(artifact)}`);
  }

  const path = join(releaseDir, artifact.file);
  const data = await readFile(path);
  const fileStat = await stat(path);
  const sha256 = createHash("sha256").update(data).digest("hex");

  if (fileStat.size !== artifact.bytes) {
    throw new Error(`Artifact size mismatch for ${artifact.file}: expected ${artifact.bytes}, got ${fileStat.size}`);
  }
  if (sha256 !== artifact.sha256) {
    throw new Error(`Manifest sha256 mismatch for ${artifact.file}: expected ${artifact.sha256}, got ${sha256}`);
  }
  if (sums.get(artifact.file) !== sha256) {
    throw new Error(`SHA256SUMS mismatch for ${artifact.file}: expected ${sha256}, got ${sums.get(artifact.file)}`);
  }
}

console.log(`Verified ${manifest.artifacts.length} release artifact(s).`);

function parseSha256Sums(input) {
  const result = new Map();
  for (const line of input.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = /^([a-f0-9]{64})  (.+)$/i.exec(line);
    if (!match) {
      throw new Error(`Invalid SHA256SUMS line: ${line}`);
    }
    result.set(match[2], match[1].toLowerCase());
  }
  return result;
}
