import { describe, expect, it } from "vitest";
import { renderDropHereBat, renderHwpxOptCmd, renderUsageTxt } from "./launchers.mjs";

describe("cli-portable launchers", () => {
  it("drop-here.bat anchors to %~dp0, clears NODE_OPTIONS, uses balanced + temp report", () => {
    const bat = renderDropHereBat();
    expect(bat).toContain('set "ROOT=%~dp0"');
    expect(bat).toMatch(/set\s+"?NODE_OPTIONS=/i);
    expect(bat).toContain("--mode balanced");
    expect(bat).toContain("optimize");
    expect(bat).toContain("batch");
    expect(bat).not.toContain("EnableDelayedExpansion");
    expect(bat).toContain(":optimize_file");
    expect(bat).toContain('call :optimize_file "%~1"');
    expect(bat).toContain('--report "%RPT%"');
    expect(bat).toContain("%TEMP%");
    // RPT must be set in subroutine, not inside parenthesized else block
    const optimizeSub = bat.slice(bat.indexOf(":optimize_file"));
    expect(optimizeSub).toContain('set "RPT=%TEMP%');
    expect(optimizeSub).toMatch(/set "RPT=%TEMP%\\hwpx-opt-%RANDOM%-%N%.report.json"/);
    const elseBlock = bat.slice(bat.indexOf(") else ("), bat.indexOf(":done"));
    expect(elseBlock).not.toContain('set "RPT=');
    expect(bat).toContain("pause");
    expect(bat).toContain("HWPX_OPT_NO_PAUSE");
    expect(bat).toContain('if exist "%~1\\"');
    expect(bat).toContain("node\\node.exe");
    expect(bat).toContain("app\\cli\\dist\\index.js");
    // Must not shell out via relative node without ROOT
    for (const match of bat.matchAll(/node\\node\.exe/g)) {
      const prefix = bat.slice(Math.max(0, match.index! - 6), match.index);
      expect(prefix).toContain("%ROOT%");
    }
  });

  it("hwpx-opt.cmd forwards args via ROOT node and pauses for console UX", () => {
    const cmd = renderHwpxOptCmd();
    expect(cmd).toContain('set "ROOT=%~dp0"');
    expect(cmd).toContain("%*");
    expect(cmd).toContain("app\\cli\\dist\\index.js");
    expect(cmd).toContain("pause");
    expect(cmd).toContain('if "%~1"==""');
  });

  it("drop-here.bat stays ASCII-safe so cmd.exe does not flash-close on Korean Windows", () => {
    const bat = renderDropHereBat();
    for (let i = 0; i < bat.length; i += 1) {
      expect(bat.charCodeAt(i)).toBeLessThan(128);
    }
  });

  it("사용법.txt documents drop-here.bat, modes, and output locations", () => {
    const txt = renderUsageTxt();
    expect(txt).toContain("drop-here.bat");
    expect(txt).toContain("hwpx-opt.cmd");
    expect(txt).toContain("balanced");
    expect(txt).toContain("optimized");
    expect(txt).toContain(".optimized.hwpx");
    expect(txt).toContain("끌어다");
  });
});

