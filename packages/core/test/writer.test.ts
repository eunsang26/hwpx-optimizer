import { describe, expect, it } from "vitest";
import { writeHwpxPackage } from "../src/writer.js";
import type { HwpxPackage } from "../src/types.js";

describe("writeHwpxPackage", () => {
  it("accepts an explicit ZIP compression level for speed-sensitive callers", async () => {
    const xml = Array.from({ length: 5000 }, (_, index) => `<p id="${index}">document image optimization test data</p>`).join("");
    const pkg: HwpxPackage = {
      entries: [
        {
          path: "Contents/section0.xml",
          data: Buffer.from(xml),
          size: Buffer.byteLength(xml),
          kind: "xml"
        }
      ]
    };

    const fast = await writeHwpxPackage(pkg, { compressionLevel: 1 });
    const compact = await writeHwpxPackage(pkg, { compressionLevel: 9 });

    expect(fast.byteLength).toBeGreaterThan(0);
    expect(compact.byteLength).toBeGreaterThan(0);
    expect(fast.equals(compact)).toBe(false);
  });
});
