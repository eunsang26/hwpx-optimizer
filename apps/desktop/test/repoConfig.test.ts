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
    expect(packageJson.scripts?.["release:preflight"]).toBe(
      "npm run release:hygiene && npm test && npm run typecheck && npm run build && npm audit --audit-level=moderate && npm run desktop:smoke"
    );
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

  it("keeps automatic optimization plan cards horizontally readable", async () => {
    const styles = await readFile("apps/desktop/src/styles.css", "utf8");

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
    expect(renderer).not.toContain("chooseManyButton");
    expect(renderer).not.toContain("verificationDetails");
    expect(renderer).not.toContain("verificationSummary");
    expect(renderer).toContain("selectHwpxMany");
    expect(renderer).toContain("verificationBody.textContent");
    expect(renderer).toContain("renderAnalysisVerification(report);");
    expect(renderer).toContain("renderVerificationFailure(error);");
    expect(renderer).toContain("resultGuidanceText(report, plan)");
    expect(css).toMatch(/\.progress-panel\s*{[^}]*position:\s*fixed/s);
    expect(css).toMatch(/\.category-chart \.bar\s*{[^}]*grid-template-columns/s);
    expect(css).not.toMatch(/\.category-chart \.bar\s*{[^}]*height:\s*8px/s);

    const summaryPanelStart = html.indexOf('<section class="panel summary-panel">');
    const resultPanel = html.indexOf('id="result-panel"');
    const bottomRow = html.indexOf("<!-- ③ BOTTOM ROW");
    const bottomAccordions = html.indexOf('<section class="bottom-accordions">');
    expect(summaryPanelStart).toBeGreaterThanOrEqual(0);
    expect(resultPanel).toBeGreaterThan(summaryPanelStart);
    expect(resultPanel).toBeLessThan(bottomRow);
    expect(resultPanel).toBeLessThan(bottomAccordions);
  });
});
