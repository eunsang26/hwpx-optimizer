import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildStagingPackageJson,
  readRootRuntimeVersions
} from "./assembleApp.mjs";

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

describe("assembleApp helpers", () => {
  it("builds a private ESM package with pinned runtime dependencies", () => {
    expect(
      buildStagingPackageJson({
        sharp: "0.33.5",
        jszip: "3.10.1",
        fastXmlParser: "5.7.3"
      })
    ).toEqual({
      name: "hwpx-opt-portable-app",
      private: true,
      type: "module",
      dependencies: {
        sharp: "0.33.5",
        jszip: "3.10.1",
        "fast-xml-parser": "5.7.3"
      }
    });
  });

  it("reads exact installed versions from package-lock.json", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "assemble-app-lock-"));
    try {
      await writeJson(join(repoRoot, "package.json"), {
        dependencies: {
          sharp: "^9.9.9",
          jszip: "^9.9.9",
          "fast-xml-parser": "^9.9.9"
        }
      });
      await writeJson(join(repoRoot, "package-lock.json"), {
        lockfileVersion: 3,
        packages: {
          "node_modules/sharp": { version: "0.33.5" },
          "node_modules/jszip": { version: "3.10.1" },
          "node_modules/fast-xml-parser": { version: "5.7.3" }
        }
      });

      await expect(readRootRuntimeVersions(repoRoot)).resolves.toEqual({
        sharp: "0.33.5",
        jszip: "3.10.1",
        fastXmlParser: "5.7.3"
      });
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("falls back to exact versions in package.json when no lock exists", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "assemble-app-package-"));
    try {
      await writeJson(join(repoRoot, "package.json"), {
        dependencies: {
          sharp: "0.33.5",
          jszip: "3.10.1",
          "fast-xml-parser": "5.7.3"
        }
      });

      await expect(readRootRuntimeVersions(repoRoot)).resolves.toEqual({
        sharp: "0.33.5",
        jszip: "3.10.1",
        fastXmlParser: "5.7.3"
      });
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});
