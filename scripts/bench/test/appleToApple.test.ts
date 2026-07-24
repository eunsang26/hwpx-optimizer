import { describe, expect, it } from "vitest";
import { readHwpxPackage, balancedImageProfile } from "@hwpx-optimizer/core";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { budgetsForPackage, decodeResizeToRaw } from "../src/resizeRaw.js";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/photo.hwpx");

describe("apple-to-apple resize", () => {
  it("produces identical raw pixels for repeated decodeResizeToRaw calls", async () => {
    const pkg = await readHwpxPackage(await readFile(fixture));
    const budgets = budgetsForPackage(pkg, "balanced");
    const image = pkg.entries.find((e) => e.kind === "image")!;
    const budget = budgets.get(image.path);
    const a = await decodeResizeToRaw(image.data, budget, balancedImageProfile);
    const b = await decodeResizeToRaw(image.data, budget, balancedImageProfile);
    expect(a.width).toBe(b.width);
    expect(a.height).toBe(b.height);
    expect(createHash("sha256").update(a.data).digest("hex")).toBe(
      createHash("sha256").update(b.data).digest("hex")
    );
  });
});
