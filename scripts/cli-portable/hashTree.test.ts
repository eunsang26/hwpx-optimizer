import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeSha256Sums } from "./hashTree.mjs";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("writeSha256Sums", () => {
  it("writes sorted SHA-256 lines with relative POSIX paths", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "hash-tree-"));
    const treeRoot = join(tempRoot, "tree");
    const outFile = join(tempRoot, "SHA256SUMS.txt");

    try {
      await mkdir(join(treeRoot, "z-dir"), { recursive: true });
      await writeFile(join(treeRoot, "z-dir", "second.txt"), "second", "utf8");
      await writeFile(join(treeRoot, "first.txt"), "first", "utf8");

      await writeSha256Sums(treeRoot, outFile);

      await expect(readFile(outFile, "utf8")).resolves.toBe(
        `${sha256("first")}  first.txt\n${sha256("second")}  z-dir/second.txt\n`
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
