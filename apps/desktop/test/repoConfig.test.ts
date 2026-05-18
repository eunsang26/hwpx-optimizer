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
      build?: { files?: string[] };
    };

    expect(packageJson.scripts?.["release:clean"]).toBe("node scripts/clean-release-artifacts.mjs");
    expect(packageJson.scripts?.["clean:local-artifacts"]).toBe("node scripts/clean-local-artifacts.mjs");
    expect(packageJson.scripts?.["desktop:pack"]).not.toMatch(/release:clean/);
    expect(packageJson.scripts?.["desktop:pack:win"]).not.toMatch(/release:clean/);
    expect(packageJson.scripts?.["desktop:local:win"]).not.toMatch(/release:clean/);
    expect(packageJson.scripts?.["release:check"]).toMatch(/^npm run release:clean && /);
    expect(packageJson.scripts?.["release:check:win-portable"]).toMatch(/^npm run release:clean && /);
    expect(packageJson.scripts?.["release:check:win"]).toMatch(/^npm run release:clean && /);
    expect(packageJson.scripts?.["release:preflight"]).toBe(
      "npm run release:hygiene && npm test && npm run typecheck && npm run build && npm audit --audit-level=moderate && npm run desktop:smoke:built"
    );
    expect(packageJson.scripts?.["desktop:smoke:built"]).toBe("node scripts/run-electron-app.mjs --smoke-test");
    expect(packageJson.build?.files).toContain("apps/desktop/dist/**/*.png");
    expect(packageJson.build?.files).toContain("apps/desktop/dist/**/*.svg");
    expect(packageJson.build?.asar).toEqual({ smartUnpack: false });
    expect(packageJson.build?.asarUnpack).toEqual(["node_modules/@img/sharp-win32-x64/**/*"]);
    expect(packageJson.build?.afterPack).toBe("scripts/prune-electron-locales.cjs");
    expect(packageJson.build?.electronLanguages).toEqual(["ko"]);
    expect(packageJson.build?.files).toContain("!node_modules/**/README*");
    expect(packageJson.build?.files).toContain("!node_modules/**/CHANGELOG*");
    expect(packageJson.build?.files).toContain("!node_modules/**/CHANGES*");
    expect(packageJson.build?.files).toContain("!node_modules/**/CONTRIBUTING*");
    expect(packageJson.build?.files).toContain("!node_modules/**/GOVERNANCE*");
    expect(packageJson.build?.files).toContain("!node_modules/**/test.*");
    expect(packageJson.build?.files).toContain("!node_modules/sharp/src/**");
    await expect(access("scripts/clean-release-artifacts.mjs")).resolves.toBeUndefined();
    await expect(access("scripts/clean-local-artifacts.mjs")).resolves.toBeUndefined();
    await expect(access("scripts/prune-electron-locales.cjs")).resolves.toBeUndefined();
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

  it("opens the desktop window at a size that fits the primary workflow", async () => {
    const main = await readFile("apps/desktop/src/main.ts", "utf8");
    const styles = await readFile("apps/desktop/src/styles.css", "utf8");

    expect(main).toContain('app.setAppUserModelId("local.hwpxoptimizer.app")');
    expect(main).toContain('icon: join(import.meta.dirname, "app-icon.png")');
    expect(main).toContain("width: 1120");
    expect(main).toContain("height: 820");
    expect(main).toContain("minWidth: 960");
    expect(main).toContain("minHeight: 720");
    expect(main).toContain('backgroundColor: "#f6f8fb"');
    expect(styles).toMatch(/\.shell\s*{[^}]*padding:\s*0 10px 80px/s);
    expect(styles).toMatch(/body\[data-view="empty"\] \.drop-zone\s*{[^}]*padding:\s*10px 14px/s);
    expect(styles).toMatch(/body\[data-view="empty"\] \.summary-panel\s*{[^}]*padding-bottom:\s*8px/s);
    expect(styles).toMatch(/body\[data-view="empty"\] \.bottom-row\s*{[^}]*gap:\s*6px/s);
    expect(styles).toMatch(/body\[data-view="empty"\] \.workspace-grid\s*{[^}]*max-width:\s*1120px/s);
    expect(styles).toMatch(/\.brand-mark img\s*{[^}]*width:\s*30px/s);
    expect(styles).toMatch(/\.option-grid\s*{[^}]*grid-template-columns:\s*repeat\(2, minmax\(150px, 1fr\)\)/s);
    expect(styles).toMatch(/\.option-grid select,\n\.option-grid input\[type="number"\]\s*{[^}]*width:\s*100%/s);
    expect(styles).toMatch(/\.cleanup-settings\s*{[^}]*grid-template-columns:\s*1fr/s);
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
    expect(previewConfig).toContain('src="/apps/desktop/src/app-icon.svg"');
    expect(iconSvg).toContain('aria-label="HWPX Optimizer"');
    expect(iconSvg).toContain("#16a34a");
  });

  it("keeps automatic optimization plan cards horizontally readable", async () => {
    const styles = await readFile("apps/desktop/src/styles.css", "utf8");

    expect(styles).not.toContain("min-width: 1080px;");
    expect(styles).toMatch(/html,\s*body\s*{[^}]*overflow-x:\s*hidden/s);
    expect(styles).not.toContain(".plan-actions > li,\n.plan-actions .plan-card");
    expect(styles).toMatch(/\.plan-card > label\s*{[^}]*display:\s*flex/s);
    expect(styles).toContain("flex: 1 1 auto;");
  });

  it("keeps analysis state stable while submission options are changed during analysis", async () => {
    const renderer = await readFile("apps/desktop/src/renderer.ts", "utf8");

    expect(renderer).toContain("function renderPendingAnalysisSummary()");
    expect(renderer).toContain("state.analysisRunning && state.filePath");
    expect(renderer).toContain("function setSubmissionInputsDisabled(disabled: boolean)");
    expect(renderer).toContain("if (state.report) refreshSubmissionPlan();");
    expect(renderer).not.toContain("privacyToggle");
  });

  it("keeps desktop workflow controls stable during analysis and result review", async () => {
    const html = await readFile("apps/desktop/src/index.html", "utf8");
    const renderer = await readFile("apps/desktop/src/renderer.ts", "utf8");
    const css = await readFile("apps/desktop/src/styles.css", "utf8");

    expect(html).not.toContain('id="choose-many-button"');
    expect(html).not.toContain("이번 실행 결과");
    expect(html).not.toContain('id="verification-details"');
    expect(html).not.toContain('id="verification-summary"');
    expect(html).toContain('class="analysis-verification"');
    expect(html).toContain('id="verification-body"');
    expect(html).toContain('id="result-guidance"');
    expect(html).toContain('id="plan-count-pill"');
    expect(html).toContain('id="option-plan-summary"');
    expect(html).toContain('id="run-dock"');
    expect(html).toContain('id="settings-close-button"');
    expect(html).toContain('<span aria-hidden="true">×</span>');
    expect(html).toContain('id="cleanup-document-toggle"');
    expect(html).toContain('id="cleanup-image-toggle"');
    expect(renderer).not.toContain("chooseManyButton");
    expect(renderer).not.toContain("verificationDetails");
    expect(renderer).not.toContain("verificationSummary");
    expect(renderer).toContain("selectHwpxMany");
    expect(renderer).toContain("handleAdditionalPaths(selected)");
    expect(renderer).toContain('document.addEventListener("dragover"');
    expect(renderer).toContain('document.addEventListener("drop"');
    expect(renderer).toContain("function clearSelectedFiles");
    expect(renderer).toContain('isSingle ? "파일 제거" : "목록 비우기"');
    expect(renderer).toContain("verificationBody.textContent");
    expect(renderer).toContain("renderAnalysisVerification(report);");
    expect(renderer).toContain("renderVerificationFailure(error);");
    expect(renderer).toContain("planCountPill.textContent");
    expect(renderer).toContain("optionPlanSummary.textContent");
    expect(renderer).toContain('const CLEANUP_ACTIONS = ["clean-shape-comment", "strip-metadata"]');
    expect(renderer).toContain("visiblePlanRows(plan)");
    expect(renderer).toContain("renderCleanupSettings(plan)");
    expect(renderer).toContain("runDock.hidden");
    expect(renderer).toContain('from "./shared/resultGuidance.js"');
    expect(renderer).toContain("resultGuidanceText(report, plan)");
    expect(css).toMatch(/\.progress-panel\s*{[^}]*position:\s*fixed/s);
    expect(css).toMatch(/\.run-dock\s*{[^}]*display:\s*none !important/s);
    expect(css).toMatch(/\.settings-check\s*{[^}]*display:\s*flex/s);
    expect(css).toMatch(/body\[data-drag-over="true"\] \.file-panel\s*{[^}]*border-color:\s*var\(--blue\)/s);
    expect(css).toMatch(/\.category-chart \.bar\s*{[^}]*grid-template-columns/s);
    expect(css).not.toMatch(/\.category-chart \.bar\s*{[^}]*height:\s*8px/s);
    expect(renderer).toContain("plan-priority");
    expect(renderer).toContain("중복 제외 기준");
    expect(css).not.toContain(".plan-card .plan-saving { display: none; }");

    const summaryPanelStart = html.indexOf('<section class="panel summary-panel">');
    const resultPanel = html.indexOf('id="result-panel"');
    const bottomRow = html.indexOf("<!-- ③ BOTTOM ROW");
    const bottomAccordions = html.indexOf('<section class="bottom-accordions">');
    expect(summaryPanelStart).toBeGreaterThanOrEqual(0);
    expect(resultPanel).toBeGreaterThan(summaryPanelStart);
    expect(resultPanel).toBeLessThan(bottomRow);
    expect(resultPanel).toBeLessThan(bottomAccordions);
  });

  it("keeps private sample filenames out of desktop source placeholders", async () => {
    const html = await readFile("apps/desktop/src/index.html", "utf8");
    const browserMock = await readFile("apps/desktop/src/browserMock.ts", "utf8");

    expect(html).not.toMatch(/sample\d*\.(hwp|hwpx|json|txt)/i);
    expect(browserMock).not.toMatch(/sample\d*\.(hwp|hwpx|json|txt)/i);
    expect(browserMock).not.toContain("Verifying optimized package");
    expect(browserMock).not.toContain('"Done"');
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
