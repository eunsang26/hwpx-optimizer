import { access, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("repository runtime and cleanup configuration", () => {
  it("pins the Node runtime used by current Vitest and Electron tooling", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      engines?: { node?: string };
    };

    expect(packageJson.engines?.node).toBe(">=20.20.0");
    await expect(readFile(".nvmrc", "utf8")).resolves.toSatisfy((value) => value.trim() === "20.20.2");
    await expect(readFile(".node-version", "utf8")).resolves.toSatisfy((value) => value.trim() === "20.20.2");
  });

  it("keeps release packaging and local artifact cleanup explicit", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      author?: string;
      license?: string;
      scripts?: Record<string, string>;
      build?: {
        afterPack?: string;
        files?: string[];
        extraFiles?: Array<{ from?: string; to?: string }>;
      };
    };

    expect(packageJson.author).toBe("한강유역수도지원센터 조은상 과장");
    expect(packageJson.license).toBe("UNLICENSED");
    expect(packageJson.scripts?.["release:clean"]).toBe("node scripts/clean-release-artifacts.mjs");
    expect(packageJson.scripts?.["clean:local-artifacts"]).toBe("node scripts/clean-local-artifacts.mjs");
    expect(packageJson.scripts?.["desktop:pack"]).not.toMatch(/release:clean/);
    expect(packageJson.scripts?.["desktop:pack:win"]).not.toMatch(/release:clean/);
    expect(packageJson.scripts?.["desktop:local:win"]).not.toMatch(/release:clean/);
    expect(packageJson.scripts?.["release:check"]).toMatch(/^npm run release:clean && /);
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
    expect(packageJson.scripts?.["release:tauri:build"]).toBe("npm run tauri:build");
    expect(packageJson.scripts?.["release:check"]).toContain("npm run quality:corpus:release");
    expect(packageJson.scripts?.["desktop:local:win:self-signed"]).toContain("sign-self-signed-release-artifacts.mjs");
    expect(packageJson.scripts?.["release:check:win-portable"]).toContain("npm run desktop:local:win:self-signed");
    expect(packageJson.scripts?.["release:check:win-portable"]).toContain("npm run release:verify-win-signature");
    expect(packageJson.scripts?.["release:check:win-portable"]).toContain("npm run release:verify-win-portable-smoke");
    expect(packageJson.scripts?.["release:check:win-portable:unsigned"]).toContain("npm run desktop:local:win");
    expect(packageJson.scripts?.["release:check:cli-portable"]).toContain("npm run build:win-portable");
    expect(packageJson.scripts?.["release:check:cli-portable"]).toContain("npm run release:verify-cli-portable");
    expect(packageJson.scripts?.["release:check:cli-portable"]).toContain("npm run release:manifest");
    expect(packageJson.scripts?.["release:check:cli-portable"]).toContain("npm run release:verify-manifest");
    expect(packageJson.scripts?.["release:check:cli-portable"]).toContain("ensure-win-sharp-test-fixtures.mjs");
    expect(packageJson.scripts?.["release:check:cli-portable"]).toContain("npm run release:audit");
    expect(packageJson.scripts?.["release:check:win-portable"]).toContain("npm run release:audit");
    expect(packageJson.scripts?.["release:check:cli-portable:ci"]).toBe(packageJson.scripts?.["release:check:cli-portable"]);
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
    expect(packageJson.build?.asar).toEqual({ smartUnpack: false });
    expect(packageJson.build?.asarUnpack).toEqual(["node_modules/@img/sharp-win32-x64/**/*"]);
    expect(packageJson.build?.extraFiles).toContainEqual({ from: "TERMS.txt", to: "TERMS.txt" });
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
    await expect(access("scripts/run-electron-smoke.mjs")).resolves.toBeUndefined();
    await expect(access("TERMS.txt")).resolves.toBeUndefined();

    const releaseArtifactCheck = await readFile("scripts/check-release-artifacts.mjs", "utf8");
    expect(releaseArtifactCheck).toContain("TERMS.txt");
    expect(releaseArtifactCheck).toContain("Windows ZIP artifacts must include TERMS.txt");
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

  it("keeps Windows package locale pruning scoped to Korean", async () => {
    const script = await readFile("scripts/prune-electron-locales.cjs", "utf8");

    expect(script).toContain('context.electronPlatformName !== "win32"');
    expect(script).toContain('"ko.pak"');
    expect(script).not.toContain('"en-US.pak"');
    expect(script).toContain("Pruned");
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
    expect(wrapper).toContain("-RequireChecksumEntry");
    expect(wrapper).toContain("-MinArtifactBytes");
    expect(wrapper).toContain("SHA256SUMS.txt");
    expect(wrapper).toContain("copyFileSync");
    expect(wrapper).toContain("windowsTempDirectory");
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
    expect(main).toContain("width: 1040");
    expect(main).toContain("height: 820");
    expect(main).toContain("minWidth: 960");
    expect(main).toContain("minHeight: 720");
    expect(main).toContain("maxWidth: 1360");
    expect(main).toContain('backgroundColor: "#f6f8fb"');
    expect(styles).toMatch(/\.shell\s*{[^}]*padding:\s*0 6px 80px/s);
    expect(styles).toMatch(/body\[data-view="empty"\] \.drop-zone\s*{[^}]*padding:\s*10px 14px/s);
    expect(styles).toMatch(/body\[data-view="empty"\] \.summary-panel\s*{[^}]*padding-bottom:\s*8px/s);
    expect(styles).toMatch(/body\[data-view="empty"\] \.bottom-row\s*{[^}]*gap:\s*6px/s);
    expect(styles).toMatch(/body\[data-view="empty"\] \.workspace-grid\s*{[^}]*max-width:\s*1320px/s);
    expect(styles).toMatch(/\.brand-mark img\s*{[^}]*width:\s*30px/s);
    expect(styles).toMatch(/\.option-grid\s*{[^}]*grid-template-columns:\s*repeat\(2, minmax\(150px, 1fr\)\)/s);
    expect(styles).toMatch(/\.option-grid select,\r?\n\.option-grid input\[type="number"\]\s*{[^}]*width:\s*100%/s);
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
    expect(generateIcons).toContain('join("apps", "tauri-desktop", "src-tauri", "icons")');
    expect(generateIcons).toContain("tauriIconIcoPath");
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
    expect(html).toContain('id="drop-overlay"');
    expect(html).toContain("HWPX 파일을 여기에 놓으세요");
    expect(html).toContain('id="status-banner"');
    expect(html).toContain('id="batch-result-details"');
    expect(html).toContain('id="plan-count-pill"');
    expect(html).toContain('id="option-plan-summary"');
    expect(html).toContain('id="run-dock"');
    expect(html).toContain('id="settings-close-button"');
    expect(html).toContain('id="help-button"');
    expect(html).toContain('id="help-panel"');
    expect(html).toContain('id="help-backdrop"');
    expect(html).toContain('id="help-close-button"');
    expect(html).toContain("사용 매뉴얼");
    expect(html).toContain("1. 파일 선택");
    expect(html).toContain("9. 보안 문서 제한");
    expect(html).toContain("10. 제작자 및 사용 조건");
    expect(html).toContain("제작/관리: 한강유역수도지원센터 조은상 과장");
    expect(html).toContain("사전 승인 없는 수정, 재배포, 영리 이용, 제작자 표시 제거는 금지됩니다.");
    expect(html).toContain("현재 Windows 배포 파일은 자체서명 배포본입니다.");
    expect(html).toContain("SHA256 값을 배포 공지, SHA256SUMS.txt, release-manifest.json과 대조해 확인하세요.");
    expect(html).toContain("결과물은 제출·배포·보관 전에 사용자가 직접 확인해야 하며, 원본 보존과 최종 사용 책임은 사용자에게 있습니다.");
    expect(html.match(/id="verification-body"/g)?.length).toBe(1);
    expect(html).toContain('<span aria-hidden="true">×</span>');
    expect(html).toContain('id="cleanup-document-toggle"');
    expect(html).toContain('id="cleanup-image-toggle"');
    expect(html).toContain('<option value="mb40" selected>40MB 미만</option>');
    expect(html).toContain('<option value="mb100">100MB 미만</option>');
    expect(html.match(/id="single-saving-ring"/g)?.length).toBe(1);
    expect(renderer).not.toContain("chooseManyButton");
    expect(renderer).not.toContain("verificationDetails");
    expect(renderer).not.toContain("verificationSummary");
    expect(renderer).toContain("selectHwpxMany");
    expect(renderer).toContain('requireElement("drop-overlay")');
    expect(renderer).toContain('document.addEventListener("dragenter"');
    expect(renderer).toContain("handleAdditionalPaths(selected)");
    expect(renderer).toContain('document.addEventListener("dragover"');
    expect(renderer).toContain('document.addEventListener("drop"');
    expect(renderer).toContain('window.addEventListener("hwpx-tauri-dropped-files"');
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
    expect(renderer).toContain("function setHelpOpen(open: boolean)");
    expect(renderer).toContain("helpButton.addEventListener");
    expect(renderer).toContain("promoteRemainingBatchItemToSingle");
    expect(renderer).toContain("settingSaveReport.checked = settings.saveReport");
    expect(renderer).toContain("batchResultDetails.textContent");
    expect(renderer).toContain("statusBannerText.textContent");
    expect(html).toContain('id="policy-toolbar"');
    expect(html).toContain('id="toggle-options-button"');
    expect(html).toContain('id="detail-options-sheet"');
    expect(html).toContain('id="hero-chips"');
    expect(html).toContain('id="review-strip"');
    expect(html).toContain('id="quality-mode-auto"');
    expect(html).toContain("유사 이미지 병합");
    expect(html).toContain("검토만 · 기본 끔");
    expect(html).toContain("예정 품질");
    expect(html).toContain("원본 → 예상");
    expect(html).toContain(">판정<");
    expect(html).toContain('id="quality-head-label"');
    expect(renderer).toContain('qualityMode: "auto"');
    expect(renderer).toContain("showPlannedReadOnly");
    expect(renderer).toContain("hero-verdict--mix");
    expect(renderer).toContain("renderBatchReviewStrip");
    expect(renderer).toContain("선택 파일 일괄 최적화");
    expect(renderer).toContain("합계 배분 목표마다 파일별 품질");
    expect(renderer).toContain("gaugeMidLabel.style.left");
    expect(renderer).toContain("하한 품질까지 여지");
    expect(renderer).toContain('preservationPreference === "size"');
    expect(renderer).toContain("analyzed.filter((item) => item.selected !== false)");
    expect(renderer).toContain("item.report && item.selected !== false");
    expect(renderer).toContain("createBatchPlanSummary");
    expect(css).toContain(".gauge-labels .gauge-mid");
    expect(css).toContain("body[data-view=\"batch\"] .policy-toolbar-batch");
    expect(css).toContain("button.ghost.is-active");
    expect(html).toContain('id="gauge-start-label"');
    expect(renderer).toContain("renderHeroChips");
    expect(renderer).toContain("renderReviewStrip");
    expect(renderer).toContain("handleBatchQualityInput");
    expect(css).toContain('body[data-view="batch"] .target-limit::after');
    expect(css).toMatch(/\.policy-toolbar\s*{/s);
    expect(renderer).toContain('from "./shared/resultGuidance.js"');
    expect(renderer).toContain("resultGuidanceText(report, plan)");
    expect(await readFile("apps/desktop/src/main.ts", "utf8")).toContain("layout.manualStepCount !== 10");
    expect(css).toMatch(/\.progress-panel\s*{[^}]*position:\s*fixed/s);
    expect(css).toMatch(/\.batch-status-cell\s*{[^}]*display:\s*flex/s);
    expect(css).toMatch(/\.analysis-details\s*{[^}]*width:\s*min\(100%, 1320px\)/s);
    expect(css).toMatch(/\.help-panel\s*{[^}]*position:\s*fixed/s);
    expect(css).toMatch(/\.help-panel\s*{[^}]*width:\s*min\(520px, calc\(100vw - 28px\)\)/s);
    expect(css).toMatch(/\.manual-steps\s*{[^}]*display:\s*grid/s);
    expect(css).toMatch(/\.run-dock\s*{[^}]*display:\s*none !important/s);
    expect(css).toMatch(/\.settings-check\s*{[^}]*display:\s*flex/s);
    expect(css).toMatch(/\.legal-notice\s*{[^}]*display:\s*grid/s);
    expect(css).toMatch(/body\[data-drag-over="true"\] \.file-panel\s*{[^}]*border-color:\s*var\(--blue\)/s);
    expect(css).toMatch(/\.drop-overlay\s*{[^}]*position:\s*fixed/s);
    expect(css).toMatch(/\.drop-overlay\s*{[^}]*pointer-events:\s*none/s);
    expect(css).toMatch(/\.status-banner\s*{[^}]*display:\s*flex/s);
    expect(css).toMatch(/\.batch-result-details\s*{[^}]*background:\s*var\(--surface-2\)/s);
    expect(css).toMatch(/\.category-chart \.bar\s*{[^}]*grid-template-columns/s);
    expect(css).not.toMatch(/\.category-chart \.bar\s*{[^}]*height:\s*8px/s);
    expect(renderer).toContain("plan-priority");
    expect(renderer).toContain("중복 제외 기준");
    expect(css).not.toContain(".plan-card .plan-saving { display: none; }");

    const summaryPanelStart = html.indexOf('<section class="panel summary-panel">');
    const resultPanel = html.indexOf('id="result-panel"');
    const bottomRow = html.indexOf("<!-- ③ BOTTOM");
    const bottomAccordions = html.indexOf('<section class="bottom-accordions">');
    const actionPanel = html.indexOf('<div id="action-panel"');
    expect(summaryPanelStart).toBeGreaterThanOrEqual(0);
    expect(resultPanel).toBeGreaterThan(summaryPanelStart);
    expect(resultPanel).toBeLessThan(bottomRow);
    expect(resultPanel).toBeLessThan(bottomAccordions);
    expect(bottomAccordions).toBeLessThan(actionPanel);
    expect(html).toMatch(
      /<section id="single-workspace"[\s\S]*<section class="bottom-accordions">[\s\S]*<\/section>\s*<\/section>\s*<div id="action-panel"/
    );
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
