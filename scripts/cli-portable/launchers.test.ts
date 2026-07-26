import { describe, expect, it } from "vitest";
import { renderDropHereBat, renderDropHereMjs, renderHwpxOptCmd, renderUsageTxt } from "./launchers.mjs";

describe("cli-portable launchers", () => {
  it("drop-here.bat is a thin ASCII wrapper that forwards to the Node runner", () => {
    const bat = renderDropHereBat();
    expect(bat).toContain('set "ROOT=%~dp0"');
    expect(bat).toMatch(/set\s+"?NODE_OPTIONS=/i);
    expect(bat).toContain("app\\drop-here.mjs");
    expect(bat).toContain("node\\node.exe");
    expect(bat).toContain('"%NODE%" "%RUN%" %*');
    expect(bat).toContain("pause");
    expect(bat).toContain("HWPX_OPT_NO_PAUSE");
    // Must not parse dropped paths inside cmd parentheses blocks
    expect(bat).not.toContain(":optimize_file");
    expect(bat).not.toContain('if exist "%~1\\"');
    expect(bat).not.toContain("echo === optimize file:");
    for (const match of bat.matchAll(/node\\node\.exe/g)) {
      const prefix = bat.slice(Math.max(0, match.index! - 6), match.index);
      expect(prefix).toContain("%ROOT%");
    }
  });

  it("drop-here.mjs optimizes with balanced mode and temp reports", () => {
    const runner = renderDropHereMjs();
    expect(runner).toContain("--mode");
    expect(runner).toContain("balanced");
    expect(runner).toContain("optimize");
    expect(runner).toContain("batch");
    expect(runner).toContain("--report");
    expect(runner).toContain("tmpdir");
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
    expect(txt).toContain("괄호");
  });
});
