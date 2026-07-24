import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { assertUcrtOnlyPeImports, listPeImports } from "./peImports.mjs";

describe("peImports", () => {
  it("lists imports from the bundled win32 sharp native files", async () => {
    const libRoot = join(process.cwd(), "node_modules", "@img", "sharp-win32-x64", "lib");
    const imports = listPeImports(await readFile(join(libRoot, "libvips-42.dll")));
    expect(imports.some((name) => name.includes("api-ms-win-crt"))).toBe(true);
    expect(imports.some((name) => name === "vcruntime140.dll")).toBe(false);
  });

  it("rejects legacy MSVC runtime imports", () => {
    expect(() =>
      assertUcrtOnlyPeImports(
        Buffer.from("not a pe"),
        "bad.dll"
      )
    ).toThrow(/Invalid PE file/i);
  });
});
