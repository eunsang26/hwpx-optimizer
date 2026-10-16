import { describe, expect, it } from "vitest";
// @ts-expect-error JavaScript release helper has no declaration file.
import { blockingRuntimePackages, isCompleteAuditReport } from "./auditPolicy.mjs";

function report(vulnerabilities: Record<string, { severity: string }> = {}) {
  return { vulnerabilities, metadata: { vulnerabilities: {
    info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0
  } } };
}

describe("release audit policy", () => {
  it("blocks shipped Electron even when production audit is clean", () => {
    expect(blockingRuntimePackages(report(), report({ electron: { severity: "high" } })))
      .toEqual(["electron"]);
  });
  it("blocks production moderate and high findings but reports build tooling separately", () => {
    expect(blockingRuntimePackages(report({ sharp: { severity: "high" },
      parser: { severity: "moderate" }, minor: { severity: "low" } }),
    report({ "electron-builder": { severity: "high" } }))).toEqual(["parser", "sharp"]);
  });
  it.each([{}, null, { error: {} }, { metadata: { vulnerabilities: {} } },
    { ...report(), metadata: { vulnerabilities: { ...report().metadata.vulnerabilities, high: -1 } } }])
  ("rejects an incomplete response instead of claiming zero vulnerabilities", (value) => {
    expect(isCompleteAuditReport(value)).toBe(false);
    expect(() => blockingRuntimePackages(report(), value)).toThrow("Incomplete");
  });
  it("accepts a complete clean report", () => {
    expect(isCompleteAuditReport(report())).toBe(true);
    expect(blockingRuntimePackages(report(), report())).toEqual([]);
  });
  it("never ignores blocking production counts when package details are absent", () => {
    const production = report();
    production.metadata.vulnerabilities.high = 1;
    expect(blockingRuntimePackages(production, report())).toEqual(["unidentified production dependency"]);
  });
});
