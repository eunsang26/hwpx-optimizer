import { access, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("repository runtime and cleanup configuration", () => {
  it("pins the Node runtime used by current Vitest and Electron tooling", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      engines?: { node?: string };
    };

    expect(packageJson.engines?.node).toBe(">=20.20.0");
    await expect(readFile(".nvmrc", "utf8")).resolves.toBe("20.20.2\n");
    await expect(readFile(".node-version", "utf8")).resolves.toBe("20.20.2\n");
  });

  it("keeps release packaging and local artifact cleanup explicit", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["release:clean"]).toBe("node scripts/clean-release-artifacts.mjs");
    expect(packageJson.scripts?.["clean:local-artifacts"]).toBe("node scripts/clean-local-artifacts.mjs");
    expect(packageJson.scripts?.["desktop:pack"]).not.toMatch(/release:clean/);
    expect(packageJson.scripts?.["desktop:pack:win"]).not.toMatch(/release:clean/);
    expect(packageJson.scripts?.["desktop:local:win"]).not.toMatch(/release:clean/);
    expect(packageJson.scripts?.["release:check"]).toMatch(/^npm run release:clean && /);
    expect(packageJson.scripts?.["release:check:win-portable"]).toMatch(/^npm run release:clean && /);
    expect(packageJson.scripts?.["release:check:win"]).toMatch(/^npm run release:clean && /);
    await expect(access("scripts/clean-release-artifacts.mjs")).resolves.toBeUndefined();
    await expect(access("scripts/clean-local-artifacts.mjs")).resolves.toBeUndefined();
  });

  it("keeps desktop analysis automatic and shows the selected output folder in the run panel", async () => {
    const html = await readFile("apps/desktop/src/index.html", "utf8");
    const renderer = await readFile("apps/desktop/src/renderer.ts", "utf8");

    expect(html).not.toContain('id="analyze-button"');
    expect(html).not.toContain("다시 분석");
    expect(html).toContain('id="output-directory-line"');
    expect(renderer).not.toContain('requireButton("analyze-button")');
    expect(renderer).toContain("outputDirectoryLine.textContent");
  });
});
