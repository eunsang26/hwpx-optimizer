import { describe, expect, it } from "vitest";
import { analysisBasisLabel } from "../src/shared/analysisCoverage.js";

describe("analysis coverage labels", () => {
  it("discloses unperformed diagnostics and estimated image sizes in quick reports", () => {
    const label = analysisBasisLabel({ analysis: { mode: "quick", imageSizes: "estimated", visualDuplicatesChecked: false } });
    expect(label).toContain("추정값"); expect(label).toContain("검사하지 않았습니다"); expect(label).toContain("저장 후");
  });
  it("describes measured candidates without promising the final ZIP size", () => {
    const label = analysisBasisLabel({ analysis: { mode: "deep", imageSizes: "encoded", visualDuplicatesChecked: true } });
    expect(label).toContain("재인코딩"); expect(label).toContain("최종 ZIP 용량은 저장 후");
  });
  it("does not invent the coverage of old or optimization reports", () => {
    expect(analysisBasisLabel({})).toContain("정보가 없습니다");
  });
});
