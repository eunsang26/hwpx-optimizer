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
    expect(bat).toContain("--report");
    expect(bat).toContain("%TEMP%");
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

  it("hwpx-opt.cmd forwards args via ROOT node", () => {
    const cmd = renderHwpxOptCmd();
    expect(cmd).toContain('set "ROOT=%~dp0"');
    expect(cmd).toContain("%*");
    expect(cmd).toContain("app\\cli\\dist\\index.js");
  });

  it("사용법.txt documents drop-here.bat, modes, and output locations", () => {
    const txt = renderUsageTxt();
    expect(txt).toContain("drop-here.bat");
    expect(txt).toContain("hwpx-opt.cmd");
    expect(txt).toContain("balanced");
    expect(txt).toContain("optimized");
    expect(txt).toContain(".optimized.hwpx");
  });
});
