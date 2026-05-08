import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const releaseDir = "release";
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const productName = packageJson.build?.productName ?? packageJson.name;
const version = packageJson.version;
const artifacts = [`${productName}-${version}-x64.exe`];
const generatedAt = new Date().toISOString();

const entries = [];
for (const artifact of artifacts) {
  const path = join(releaseDir, artifact);
  const data = await readFile(path);
  const fileStat = await stat(path);
  entries.push({
    file: basename(path),
    bytes: fileStat.size,
    sha256: createHash("sha256").update(data).digest("hex")
  });
}

const manifest = {
  product: productName,
  version,
  generatedAt,
  artifacts: entries
};

await writeFile(join(releaseDir, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(
  join(releaseDir, "SHA256SUMS.txt"),
  `${entries.map((entry) => `${entry.sha256}  ${entry.file}`).join("\n")}\n`
);

console.log(`Wrote ${join(releaseDir, "release-manifest.json")}`);
console.log(`Wrote ${join(releaseDir, "SHA256SUMS.txt")}`);
