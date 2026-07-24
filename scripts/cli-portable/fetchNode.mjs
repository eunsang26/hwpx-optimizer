import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import JSZip from "jszip";
import { NODE_VERSION } from "./constants.mjs";

export function nodeDistUrls(version = NODE_VERSION) {
  const fileName = `node-v${version}-win-x64.zip`;
  const baseUrl = `https://nodejs.org/dist/v${version}`;
  return {
    zipUrl: `${baseUrl}/${fileName}`,
    shasumsUrl: `${baseUrl}/SHASUMS256.txt`
  };
}

export function parseSha256Sums(text, zipFileName) {
  for (const line of text.split(/\r?\n/u)) {
    const match = line.match(/^([a-fA-F0-9]{64})\s+\*?(.+?)\s*$/u);
    if (match?.[2] === zipFileName) {
      return match[1].toLowerCase();
    }
  }
  throw new Error(`No SHA-256 checksum found for ${zipFileName}`);
}

async function fetchChecked(fetchImpl, url) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  }
  return response;
}

function verifySha256(zipBytes, expectedSha256, zipFileName) {
  const actualSha256 = createHash("sha256").update(zipBytes).digest("hex");
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `SHA-256 mismatch for ${zipFileName}: expected ${expectedSha256}, got ${actualSha256}`
    );
  }
}

async function extractNodeExe(zipBytes, version, outExePath) {
  const zip = await JSZip.loadAsync(zipBytes);
  const entryPath = `node-v${version}-win-x64/node.exe`;
  const entry = zip.file(entryPath);
  if (!entry) {
    throw new Error(`Node archive is missing ${entryPath}`);
  }
  const nodeExe = await entry.async("nodebuffer");
  await mkdir(dirname(outExePath), { recursive: true });
  await writeFile(outExePath, nodeExe);
}

export async function ensureNodeExe(options) {
  const {
    version = NODE_VERSION,
    cacheDir,
    outExePath,
    nodeZipPath,
    fetchImpl = globalThis.fetch
  } = options;

  let zipBytes;
  let shasumsText;
  let zipFileName;

  if (nodeZipPath) {
    zipFileName = basename(nodeZipPath);
    zipBytes = await readFile(nodeZipPath);
    const shasumsPath = join(dirname(nodeZipPath), "SHASUMS256.txt");
    try {
      shasumsText = await readFile(shasumsPath, "utf8");
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        throw new Error(
          `SHASUMS256.txt is required beside the local Node zip: ${shasumsPath}`
        );
      }
      throw error;
    }
  } else {
    if (typeof fetchImpl !== "function") {
      throw new Error("A fetch implementation is required to download Node");
    }
    zipFileName = `node-v${version}-win-x64.zip`;
    const { zipUrl, shasumsUrl } = nodeDistUrls(version);
    const [zipResponse, shasumsResponse] = await Promise.all([
      fetchChecked(fetchImpl, zipUrl),
      fetchChecked(fetchImpl, shasumsUrl)
    ]);
    zipBytes = Buffer.from(await zipResponse.arrayBuffer());
    shasumsText = await shasumsResponse.text();
  }

  const expectedSha256 = parseSha256Sums(shasumsText, zipFileName);
  verifySha256(zipBytes, expectedSha256, zipFileName);

  if (!nodeZipPath) {
    await mkdir(cacheDir, { recursive: true });
    await Promise.all([
      writeFile(join(cacheDir, zipFileName), zipBytes),
      writeFile(join(cacheDir, "SHASUMS256.txt"), shasumsText)
    ]);
  }

  await extractNodeExe(zipBytes, version, outExePath);
}
