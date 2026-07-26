import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildManifest,
  hashFile,
  loadCorpus,
  manifestId,
  verifyManifest,
  writeManifestFile
} from "../src/corpus.js";

describe("corpus manifest", () => {
  it("verifyManifest detects hash mismatch", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-bench-corpus-"));
    try {
      const filePath = join(dir, "a.hwpx");
      await writeFile(filePath, Buffer.from("fake-hwpx-1"));
      const manifest = await buildManifest(dir);
      expect(manifest.files).toHaveLength(1);

      await writeFile(filePath, Buffer.from("fake-hwpx-2"));
      const result = await verifyManifest(dir, manifest);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("manifest-mismatch");
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("hashFile returns stable sha256", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-bench-hash-"));
    try {
      const filePath = join(dir, "doc.hwpx");
      const data = Buffer.from("stable-content");
      await writeFile(filePath, data);
      const first = await hashFile(filePath, dir);
      const second = await hashFile(filePath, dir);
      expect(first.sha256).toBe(second.sha256);
      expect(first.size).toBe(data.byteLength);
      expect(first.relativePath).toBe("doc.hwpx");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("loadCorpus without bench dir is synthetic-only invalid", async () => {
    const fixturesDir = join(import.meta.dirname, "../fixtures");
    const manifestPath = join(import.meta.dirname, "../corpus.manifest.json");
    const loaded = await loadCorpus({ benchDir: undefined, fixturesDir, manifestPath });
    expect(loaded.goEligible).toBe(false);
    expect(loaded.invalidReason).toBe("synthetic-only");
    expect(loaded.docs.every((doc) => doc.source === "fixture")).toBe(true);
    expect(loaded.manifestId).toMatch(/^[a-f0-9]{64}$/);
  });

  it("listHwpxFiles includes symlinked .hwpx entries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-bench-symlink-"));
    try {
      const target = join(dir, "target.hwpx");
      await writeFile(target, Buffer.from("symlink-target"));
      await symlink(target, join(dir, "linked.hwpx"));
      const manifest = await buildManifest(dir);
      expect(manifest.files.map((f) => f.relativePath).sort()).toEqual(["linked.hwpx", "target.hwpx"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("writeManifestFile produces manifest with deterministic id", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hwpx-bench-write-"));
    const manifestPath = join(dir, "manifest.json");
    try {
      await writeFile(join(dir, "one.hwpx"), Buffer.from("one"));
      await writeFile(join(dir, "two.hwpx"), Buffer.from("two"));
      const manifest = await writeManifestFile(manifestPath, dir);
      expect(manifest.files).toHaveLength(2);
      expect(manifestId(manifest)).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
