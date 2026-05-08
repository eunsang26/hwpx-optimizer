import { describe, expect, it } from "vitest";
import { escapeHtml, fileNameFromPath, looksLikeOptimizedFileName } from "../src/shared/format.js";

describe("shared format helpers", () => {
  it("escapes HTML-significant characters", () => {
    expect(escapeHtml('<script>"&\'</script>')).toBe("&lt;script&gt;&quot;&amp;&#039;&lt;/script&gt;");
    expect(escapeHtml("plain text")).toBe("plain text");
    expect(escapeHtml("")).toBe("");
  });

  it("detects optimized file names regardless of -N suffix", () => {
    expect(looksLikeOptimizedFileName("doc.optimized.hwpx")).toBe(true);
    expect(looksLikeOptimizedFileName("doc.optimized-2.hwpx")).toBe(true);
    expect(looksLikeOptimizedFileName("doc.optimized-12.HWPX")).toBe(true);
    expect(looksLikeOptimizedFileName("doc.hwpx")).toBe(false);
    expect(looksLikeOptimizedFileName("doc.optimized.txt")).toBe(false);
  });

  it("returns the trailing path segment using either separator", () => {
    expect(fileNameFromPath("/usr/local/file.hwpx")).toBe("file.hwpx");
    expect(fileNameFromPath("C:\\Users\\me\\file.hwpx")).toBe("file.hwpx");
    expect(fileNameFromPath("file.hwpx")).toBe("file.hwpx");
  });
});
