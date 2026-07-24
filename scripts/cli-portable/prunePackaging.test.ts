import { describe, expect, it } from "vitest";
import { shouldPrunePackagingFile } from "./prunePackaging.mjs";

describe("prunePackaging", () => {
  it("flags maps, declarations, docs, and lockfiles", () => {
    expect(shouldPrunePackagingFile("foo.js.map")).toBe(true);
    expect(shouldPrunePackagingFile("index.d.ts")).toBe(true);
    expect(shouldPrunePackagingFile("README.md")).toBe(true);
    expect(shouldPrunePackagingFile("CHANGELOG.txt")).toBe(true);
    expect(shouldPrunePackagingFile("package-lock.json")).toBe(true);
    expect(shouldPrunePackagingFile(".package-lock.json")).toBe(true);
    expect(shouldPrunePackagingFile("index.js")).toBe(false);
    expect(shouldPrunePackagingFile("package.json")).toBe(false);
  });
});
