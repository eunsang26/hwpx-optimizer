import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..", "..");

describe("CLI portable Windows smoke scripts", () => {
  it("exposes the release smoke command", async () => {
    const packageJson = JSON.parse(await readFile(resolve(repoRoot, "package.json"), "utf8"));

    expect(packageJson.scripts["release:verify-cli-portable-smoke"]).toBe(
      "node scripts/run-cli-portable-smoke.mjs"
    );
  });

  it("runs packaged node, launcher, and optional sample checks", async () => {
    const script = await readFile(resolve(repoRoot, "scripts", "cli-portable-smoke.ps1"), "utf8");

    expect(script).toContain('[string]$ZipPath');
    expect(script).toContain('[string]$Sample = ""');
    expect(script).toContain('[string]$Mode = "balanced"');
    expect(script).toContain('$env:HWPX_OPT_NO_PAUSE = "1"');
    expect(script).toContain('"app\\cli\\dist\\index.js"');
    expect(script).toContain('"node\\node.exe"');
    expect(script).toContain('"hwpx-opt.cmd"');
    expect(script).toContain('"drop-here.bat"');
    expect(script).toContain("drop-here.bat optimize file");
    expect(script).toContain("drop-here.bat batch folder");
    expect(script).toContain('"list-actions"');
    expect(script).toContain('"optimize"');
    expect(script).toContain('"verify"');
    expect(script).toContain('"batch"');
  });

  it("uses the CLI zip and clear PowerShell requirement", async () => {
    const runner = await readFile(resolve(repoRoot, "scripts", "run-cli-portable-smoke.mjs"), "utf8");

    expect(runner).toContain('resolve("release", "hwpx-opt-win-x64.zip")');
    expect(runner).toContain('resolve("scripts", "cli-portable-smoke.ps1")');
    expect(runner).toContain(
      "Windows PowerShell required; CLI portable Windows support not verified."
    );
  });

  it("builds and smokes the portable ZIP in one Windows CI job", async () => {
    const workflow = await readFile(
      resolve(repoRoot, ".github", "workflows", "cli-portable-release.yml"),
      "utf8"
    );

    expect(workflow).toContain("cli-portable-windows");
    expect(workflow).toContain("runs-on: windows-latest");
    expect(workflow).not.toContain("ubuntu-latest");
    expect(workflow).not.toContain("cli-portable-linux");
    expect(workflow).toContain("release:check:cli-portable:ci");
    expect(workflow).toContain("writeMinimalHwpx.mjs");
    expect(workflow).toContain("release:verify-cli-portable-smoke");
  });
});
