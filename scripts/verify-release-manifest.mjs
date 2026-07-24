import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { ZIP_NAME as CLI_PORTABLE_ZIP_NAME } from "./cli-portable/constants.mjs";

const releaseDir = "release";
const manifestPath = join(releaseDir, "release-manifest.json");
const sumsPath = join(releaseDir, "SHA256SUMS.txt");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const sums = parseSha256Sums(await readFile(sumsPath, "utf8"));
const releaseNoticePath = join(releaseDir, `RELEASE_NOTICE_${manifest.version}.txt`);
const releaseNotice = await readFile(releaseNoticePath, "utf8");

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
  if (!releaseNotice.includes(artifact.file) || !releaseNotice.includes(sha256)) {
    throw new Error(`Release notice is missing ${artifact.file} or its SHA256.`);
  }
}

const portableExe = manifest.artifacts.find((artifact) => artifact.file.endsWith(".exe"));
const cliPortableZip = manifest.artifacts.find((artifact) => artifact.file === CLI_PORTABLE_ZIP_NAME);
const isSigned = portableExe ? await hasAuthenticodeCertificateTable(join(releaseDir, portableExe.file)) : false;

if (portableExe) {
  const expectedSigningText = isSigned ? "자체서명 코드서명 인증서" : "미서명 배포본";
  if (!releaseNotice.includes(expectedSigningText)) {
    throw new Error("Release notice is missing Desktop portable signing-status text.");
  }
}

if (cliPortableZip) {
  if (
    !releaseNotice.includes(CLI_PORTABLE_ZIP_NAME) ||
    !releaseNotice.includes("node.exe") ||
    !releaseNotice.includes(".bat")
  ) {
    throw new Error("Release notice is missing CLI portable signing-status text.");
  }
}

if (!releaseNotice.includes("최종 확인 및 사용 책임은 사용자에게 있습니다")) {
  throw new Error("Release notice is missing user-responsibility text.");
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

async function hasAuthenticodeCertificateTable(path) {
  const data = await readFile(path);
  if (data.length < 0x100 || data.toString("ascii", 0, 2) !== "MZ") return false;
  const peOffset = data.readUInt32LE(0x3c);
  if (data.toString("ascii", peOffset, peOffset + 4) !== "PE\u0000\u0000") return false;
  const optionalHeaderOffset = peOffset + 24;
  const magic = data.readUInt16LE(optionalHeaderOffset);
  const dataDirectoryOffset =
    magic === 0x10b ? optionalHeaderOffset + 96 : magic === 0x20b ? optionalHeaderOffset + 112 : null;
  if (dataDirectoryOffset === null) return false;
  const securityDirectoryOffset = dataDirectoryOffset + 4 * 8;
  return data.readUInt32LE(securityDirectoryOffset + 4) > 0;
}
