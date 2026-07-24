import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

async function listFiles(rootDir, currentDir, outFile, files) {
  const entries = await readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await listFiles(rootDir, path, outFile, files);
    } else if (entry.isFile() && resolve(path) !== outFile) {
      files.push({
        path,
        relativePath: relative(rootDir, path).split(sep).join("/")
      });
    }
  }
}

export async function writeSha256Sums(rootDir, outFile) {
  const files = [];
  await listFiles(resolve(rootDir), resolve(rootDir), resolve(outFile), files);
  files.sort((left, right) =>
    left.relativePath < right.relativePath
      ? -1
      : left.relativePath > right.relativePath
        ? 1
        : 0
  );

  const lines = [];
  for (const file of files) {
    const sha256 = createHash("sha256")
      .update(await readFile(file.path))
      .digest("hex");
    lines.push(`${sha256}  ${file.relativePath}`);
  }

  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, lines.length > 0 ? `${lines.join("\n")}\n` : "", "utf8");
}
