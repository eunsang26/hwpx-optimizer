import { access, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("repository runtime and cleanup configuration", () => {
  it("keeps every shipped version source aligned with the root package", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      version?: string;
    };
    const workspacePaths = [
      "packages/core/package.json",
      "packages/cli/package.json",
      "packages/io/package.json",
      "apps/desktop/package.json"
    ];

    expect(rootPackage.version).toMatch(/^\d+\.\d+\.\d+$/);
    for (const path of workspacePaths) {
      const workspacePackage = JSON.parse(await readFile(path, "utf8")) as {
        version?: string;
        dependencies?: Record<string, string>;
      };
      expect(workspacePackage.version, path).toBe(rootPackage.version);
      if (workspacePackage.dependencies?.["@hwpx-optimizer/core"]) {
        expect(workspacePackage.dependencies["@hwpx-optimizer/core"], path).toBe(rootPackage.version);
      }
      if (workspacePackage.dependencies?.["@hwpx-optimizer/io"]) {
        expect(workspacePackage.dependencies["@hwpx-optimizer/io"], path).toBe(rootPackage.version);
      }
    }

    const coreIndex = await readFile("packages/core/src/index.ts", "utf8");
    expect(coreIndex).toContain(`export const version = "${rootPackage.version}"`);
  });

  it("pins the Node runtime used by current Vitest and Electron tooling", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      engines?: { node?: string };
    };

    expect(packageJson.engines?.node).toBe(">=22.12.0");
    await expect(readFile(".nvmrc", "utf8")).resolves.toSatisfy((value) => value.trim() === "24.21.0");
    await expect(readFile(".node-version", "utf8")).resolves.toSatisfy((value) => value.trim() === "24.21.0");
  });

  it("keeps release packaging and local artifact cleanup explicit", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      author?: string;
      license?: string;
      scripts?: Record<string, string>;
      build?: {
        afterPack?: string;
        files?: Array<string | { from?: string; to?: string; filter?: string[] }>;
        extraFiles?: Array<{ from?: string; to?: string }>;
      };
    };

    expect(packageJson.author).toBe("한강유역수도지원센터 조은상 과장");
    expect(packageJson.license).toBe("UNLICENSED");
    expect(packageJson.scripts?.["release:clean"]).toBe("node scripts/clean-release-artifacts.mjs");
    expect(packageJson.scripts?.["clean:local-artifacts"]).toBe("node scripts/clean-local-artifacts.mjs");
    expect(packageJson.scripts?.["desktop:pack"]).toBeUndefined();
    expect(packageJson.scripts?.["desktop:pack:win"]).not.toMatch(/release:clean/);
    expect(packageJson.scripts?.["desktop:local:win"]).not.toMatch(/release:clean/);
    expect(packageJson.scripts?.["release:check"]).toBeUndefined();
    expect(packageJson.scripts?.["release:check:win-portable"]).toMatch(/^npm run release:clean && /);
    expect(packageJson.scripts?.["release:check:win"]).toMatch(/^npm run release:clean && /);
    expect(packageJson.scripts?.["release:check:cli-portable"]).toMatch(/^npm run release:clean && /);
    expect(packageJson.scripts?.["release:check:cli-portable:ci"]).toMatch(/^npm run release:clean && /);
    expect(packageJson.scripts?.["release:audit"]).toBe("node scripts/release-audit.mjs");
    expect(packageJson.scripts?.["release:preflight"]).toBe(
      "npm run release:hygiene && npm test && npm run typecheck && npm run build && npm run quality:corpus:release && npm run release:audit && npm run desktop:smoke:built"
    );
    expect(packageJson.scripts?.["quality:corpus"]).toBe("tsx --conditions=development scripts/run-regression-corpus.ts");
    expect(packageJson.scripts?.["quality:corpus:release"]).toBe(
      "tsx --conditions=development scripts/run-regression-corpus.ts --require-local-samples"
    );
    expect(packageJson.scripts?.["release:verify-win-portable-smoke"]).toBe("node scripts/run-windows-portable-smoke.mjs");
    expect(packageJson.scripts?.["release:verify-cli-portable"]).toBe("node scripts/verify-cli-portable.mjs");
    expect(packageJson.scripts?.["release:verify-cli-portable-smoke"]).toBe("node scripts/run-cli-portable-smoke.mjs");
    expect(packageJson.scripts?.["release:verify-win-signature"]).toBe("node scripts/verify-win-signature.mjs");
    expect(packageJson.scripts?.["release:electron:check:win-portable"]).toBe("npm run release:check:win-portable");
    expect(JSON.stringify(packageJson.workspaces)).not.toContain("tauri");
    expect(JSON.stringify(packageJson.scripts)).not.toContain("tauri");
    expect(await readFile("package-lock.json", "utf8")).not.toContain("@tauri-apps");
    expect(await readFile(".github/workflows/windows-release.yml", "utf8")).not.toContain("tauri");
    expect(packageJson.scripts?.build).toBe(
      "npm run clean:build && tsc -b packages/core packages/io packages/cli apps/desktop && npm run desktop:assets"
    );
    expect(packageJson.scripts?.typecheck).toBe(
      "tsc -b packages/core packages/io packages/cli apps/desktop --pretty false"
    );
    expect(packageJson.scripts?.["desktop:local:win:self-signed"]).toContain("sign-self-signed-release-artifacts.mjs");
    expect(packageJson.scripts?.["release:check:win-portable"]).toContain("npm run desktop:local:win:self-signed");
    expect(packageJson.scripts?.["release:check:win-portable"]).toContain("npm run release:verify-win-signature");
    expect(packageJson.scripts?.["release:check:win-portable"]).toContain("npm run release:verify-win-portable-smoke");
    expect(packageJson.scripts?.["release:check:win-portable:unsigned"]).toContain("npm run desktop:local:win");
    expect(packageJson.scripts?.["release:check:cli-portable"]).toContain("npm run build:win-portable");
    expect(packageJson.scripts?.["release:check:cli-portable"]).toContain("--skip-build");
    expect(packageJson.scripts?.["release:check:cli-portable"]).toContain("npm run release:verify-cli-portable");
    expect(packageJson.scripts?.["release:check:cli-portable"]).toContain("npm run release:manifest");
    expect(packageJson.scripts?.["release:check:cli-portable"]).toContain("npm run release:verify-manifest");
    expect(packageJson.scripts?.["release:check:cli-portable"]).toContain("ensure-win-sharp-test-fixtures.mjs");
    expect(packageJson.scripts?.["release:check:cli-portable"]).toContain("npm run release:audit");
    expect(packageJson.scripts?.["release:check:win-portable"]).toContain("npm run release:audit");
    expect(packageJson.scripts?.["release:check:cli-portable:ci"]).toBe(packageJson.scripts?.["release:check:cli-portable"]);
    expect(await readFile("scripts/build-win-portable.mjs", "utf8")).toContain(
      'shell: process.platform === "win32"'
    );
    await expect(access("scripts/release-audit.mjs")).resolves.toBeUndefined();
    await expect(access("scripts/run-regression-corpus.ts")).resolves.toBeUndefined();
    await expect(access("scripts/run-windows-portable-smoke.mjs")).resolves.toBeUndefined();
    await expect(access("scripts/run-cli-portable-smoke.mjs")).resolves.toBeUndefined();
    await expect(access("scripts/verify-cli-portable.mjs")).resolves.toBeUndefined();
    await expect(access(".github/workflows/cli-portable-release.yml")).resolves.toBeUndefined();
    expect(packageJson.scripts?.["desktop:smoke:built"]).toBe("node scripts/run-electron-smoke.mjs");
    expect(packageJson.build?.afterPack).toBe("scripts/prune-electron-locales.cjs");
    expect(packageJson.build?.files).toContain("apps/desktop/dist/**/*.png");
    expect(packageJson.build?.files).toContain("apps/desktop/dist/**/*.svg");
    expect(packageJson.build?.files).not.toContain("apps/desktop/dist/**/*.js");
    expect(packageJson.build?.files).toContain("apps/desktop/dist/main.js");
    expect(packageJson.build?.files).toContain("apps/desktop/dist/preload.js");
    expect(packageJson.build?.files).toContain("apps/desktop/dist/renderer.js");
    expect(packageJson.build?.files).toContain("apps/desktop/dist/main/**/*.js");
    expect(packageJson.build?.files).toContain("apps/desktop/dist/shared/**/*.js");
    expect(packageJson.build?.asar).toEqual({ smartUnpack: false });
    expect(packageJson.build?.asarUnpack).toEqual(["node_modules/@img/sharp-win32-x64/**/*"]);
    expect(packageJson.build?.extraFiles).toContainEqual({ from: "TERMS.txt", to: "TERMS.txt" });
    expect(packageJson.build?.afterPack).toBe("scripts/prune-electron-locales.cjs");
    expect(packageJson.build?.electronLanguages).toEqual(["ko", "en-US"]);
    expect(packageJson.build?.files).toContain("!node_modules/**/README*");
    expect(packageJson.build?.files).toContain("!node_modules/**/CHANGELOG*");
    expect(packageJson.build?.files).toContain("!node_modules/**/CHANGES*");
    expect(packageJson.build?.files).toContain("!node_modules/**/CONTRIBUTING*");
    expect(packageJson.build?.files).toContain("!node_modules/**/GOVERNANCE*");
    expect(packageJson.build?.files).toContain("!node_modules/**/test.*");
    expect(packageJson.build?.files).toContain("!node_modules/sharp/src/**");
    expect(packageJson.build?.files).toContain("!node_modules/@img/sharp-linux*/**/*");
    expect(packageJson.build?.files).toContain("!node_modules/@img/sharp-libvips-linux*/**/*");
    expect(packageJson.build?.files).not.toContain("packages/core/dist/**/*.js");
    expect(packageJson.build?.files).not.toContain(
      "apps/desktop/dist/node_modules/@hwpx-optimizer/core/package.json"
    );
    expect(packageJson.build?.files).toContainEqual({
      from: "packages/core",
      to: "node_modules/@hwpx-optimizer/core",
      filter: ["package.json", "dist/**/*.js"]
    });
    const desktopAssetCopier = await readFile("apps/desktop/scripts/copy-assets.mjs", "utf8");
    expect(desktopAssetCopier).not.toContain("bundledCoreRoot");
    await expect(access("scripts/clean-release-artifacts.mjs")).resolves.toBeUndefined();
    await expect(access("scripts/clean-local-artifacts.mjs")).resolves.toBeUndefined();
    await expect(access("scripts/prune-electron-locales.cjs")).resolves.toBeUndefined();
    await expect(access("scripts/run-electron-smoke.mjs")).resolves.toBeUndefined();
    const electronSmokeRunner = await readFile("scripts/run-electron-smoke.mjs", "utf8");
    expect(electronSmokeRunner).toContain('resolve(".tmp", "electron-smoke")');
    expect(electronSmokeRunner).toContain("{ recursive: true, force: true }");
    await expect(access("TERMS.txt")).resolves.toBeUndefined();

    const releaseArtifactCheck = await readFile("scripts/check-release-artifacts.mjs", "utf8");
    expect(releaseArtifactCheck).toContain("TERMS.txt");
    expect(releaseArtifactCheck).toContain("Windows ZIP artifacts must include TERMS.txt");
    expect(releaseArtifactCheck).toContain("non-Windows native runtime");
    expect(releaseArtifactCheck).toContain("duplicate core runtime");
    expect(releaseArtifactCheck).toContain('replaceAll("\\\\", "/")');
    const releaseManifestWriter = await readFile("scripts/write-release-manifest.mjs", "utf8");
    const releaseManifestVerifier = await readFile("scripts/verify-release-manifest.mjs", "utf8");
    expect(releaseManifestWriter).toContain("RELEASE_NOTICE_${version}.txt");
    expect(releaseManifestWriter).toContain("cli-portable/constants.mjs");
    expect(releaseManifestWriter).toContain("CLI portable ZIP");
    expect(releaseManifestWriter).toContain("자체서명 코드서명 인증서");
    expect(releaseManifestWriter).toContain("최종 확인 및 사용 책임은 사용자에게 있습니다");
    expect(releaseManifestVerifier).toContain("RELEASE_NOTICE_${manifest.version}.txt");
    expect(releaseManifestVerifier).toContain("cli-portable/constants.mjs");
    expect(releaseManifestVerifier).toContain("CLI portable signing-status text");
    expect(releaseManifestVerifier).toContain("Release notice is missing");
  });

  it("keeps Windows portable smoke strict enough for release artifact verification", async () => {
    const script = await readFile("scripts/windows-portable-smoke.ps1", "utf8");
    const wrapper = await readFile("scripts/run-windows-portable-smoke.mjs", "utf8");

    expect(script).toContain("[switch]$RequireChecksumEntry");
    expect(script).toContain("[string]$ExpectedSha256");
    expect(script).toContain("[long]$MinArtifactBytes");
    expect(script).toContain("throw \"No checksum entry found");
    expect(script).toContain("ExpectedSha256 mismatch");
    expect(script).toContain("smaller than required minimum");
    expect(script).toContain("-WorkingDirectory $artifactDirectory");
    expect(script).toContain("-RedirectStandardOutput $stdoutPath");
    expect(script).toContain("-RedirectStandardError $stderrPath");
    expect(script).toContain("Desktop smoke stderr:");
    expect(script).toContain("(Resolve-Path -LiteralPath $Sample).ProviderPath");
    expect(wrapper).toContain("-RequireChecksumEntry");
    expect(wrapper).toContain("-MinArtifactBytes");
    expect(wrapper).toContain("SHA256SUMS.txt");
    expect(wrapper).toContain("copyFileSync");
    expect(wrapper).toContain("windowsTempDirectory");
  });

  it("generates desktop and in-app icons from the same source asset", async () => {
    const html = await readFile("apps/desktop/src/index.html", "utf8");
    const copyAssets = await readFile("apps/desktop/scripts/copy-assets.mjs", "utf8");
    const generateIcons = await readFile("scripts/generate-desktop-icons.mjs", "utf8");
    const previewConfig = await readFile("apps/desktop/vite.preview.config.ts", "utf8");
    const iconSvg = await readFile("apps/desktop/src/app-icon.svg", "utf8");

    expect(html).toContain('<img src="./app-icon.svg" alt="" />');
    expect(copyAssets).toContain('"app-icon.svg"');
    expect(copyAssets).toContain('join(root, "dist", "app-icon.png")');
    expect(generateIcons).toContain('join("apps", "desktop", "src", "app-icon.svg")');
    expect(generateIcons).not.toContain("tauri");
    expect(previewConfig).toContain('src="/apps/desktop/src/app-icon.svg"');
    expect(iconSvg).toContain('aria-label="HWPX Optimizer"');
    expect(iconSvg).toContain("#16a34a");
  });

  it("keeps private sample filenames out of desktop source placeholders", async () => {
    const html = await readFile("apps/desktop/src/index.html", "utf8");
    const browserMock = await readFile("apps/desktop/src/browserMock.ts", "utf8");

    expect(html).not.toMatch(/sample\d*\.(hwp|hwpx|json|txt)/i);
    expect(browserMock).not.toMatch(/sample\d*\.(hwp|hwpx|json|txt)/i);
    expect(browserMock).not.toContain("Verifying optimized package");
    expect(browserMock).not.toContain('"Done"');
    expect(browserMock).toContain('defaultMode: "balanced"');
    expect(browserMock).toContain('submissionLimit: { id: "mb40" }');
    expect(browserMock).toContain('batchTargetMode: "per-file"');
  });

  it("keeps implementation notes aligned with shipped SSIM and diagnostics behavior", async () => {
    const limitations = await readFile("docs/KNOWN_LIMITATIONS.md", "utf8");
    const architecture = await readFile("docs/ARCHITECTURE.md", "utf8");

    expect(limitations).not.toContain("SSIM-based image quality scoring is not yet implemented");
    expect(limitations).not.toContain("Near-duplicate visual matching remains out of scope");
    expect(architecture).not.toContain("advanced mode verification still checks structural invariants rather than exact quality");
    expect(limitations).toContain("PSNR and SSIM");
    expect(limitations).toContain("Near-duplicate images are reported as review-only candidates");
    expect(architecture).toContain("PSNR and SSIM");
  });
});
