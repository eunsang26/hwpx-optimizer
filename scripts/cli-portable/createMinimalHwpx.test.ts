import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeMinimalHwpxFile } from "./createMinimalHwpx.mjs";

describe("createMinimalHwpx", () => {
  it("writes a zip-shaped minimal hwpx", async () => {
    const dir = await mkdtemp(join(tmpdir(), "min-hwpx-"));
    const out = join(dir, "minimal.hwpx");
    await writeMinimalHwpxFile(out);
    const bytes = await readFile(out);
    expect(bytes.subarray(0, 2).toString("utf8")).toBe("PK");
    expect(bytes.length).toBeGreaterThan(100);
  });
});
