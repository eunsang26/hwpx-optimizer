import { describe, expect, it } from "vitest";
import { createHwpxFixture } from "./fixtures.js";
import { evaluateRegressionCorpus } from "../src/regressionCorpus.js";

describe("evaluateRegressionCorpus", () => {
  it("checks optimization expectations and performance budgets for fixture-like documents", async () => {
    const input = await createHwpxFixture({
      entries: {
        "Contents/section0.xml": `<root><hp:shapeComment>그림입니다.
원본 그림의 이름: IMG_1234.JPG
원본 그림의 크기: 가로 5712pixel, 세로 4284pixel</hp:shapeComment></root>`
      }
    });

    const summary = await evaluateRegressionCorpus([
      {
        name: "shape-comment-cleanup",
        input,
        mode: "balanced",
        actions: ["clean-shape-comment"],
        allowLarger: true,
        requiredActions: ["clean-shape-comment"],
        maxTotalMs: 5000,
        maxStageMs: { read: 1000, analyze: 2000, write: 2000 }
      }
    ]);

    expect(summary.passed).toBe(true);
    expect(summary.total).toBe(1);
    expect(summary.results[0]).toMatchObject({
      name: "shape-comment-cleanup",
      passed: true,
      failures: []
    });
    expect(summary.results[0].report?.actions.applied).toContainEqual(
      expect.objectContaining({ type: "clean-shape-comment" })
    );
  });

  it("treats protected-document rejection as a first-class corpus expectation", async () => {
    const input = await createHwpxFixture({
      entries: {
        "_xmlsignatures/sig1.xml": "<Signature />"
      }
    });

    const summary = await evaluateRegressionCorpus([
      {
        name: "signed-document-rejected",
        input,
        mode: "reject",
        expectedErrorIncludes: "보안 처리된 문서는 최적화 대상이 아닙니다"
      }
    ]);

    expect(summary.passed).toBe(true);
    expect(summary.results[0]).toMatchObject({
      passed: true,
      rejected: true,
      failures: []
    });
  });

  it("reports failed expectations without throwing so release gates can print all failures", async () => {
    const input = await createHwpxFixture({ entries: { "Contents/section0.xml": "<root />" } });

    const summary = await evaluateRegressionCorpus([
      {
        name: "missing-action",
        input,
        mode: "safe",
        requiredActions: ["clean-shape-comment"]
      }
    ]);

    expect(summary.passed).toBe(false);
    expect(summary.results[0].failures).toContain("Required action was not applied: clean-shape-comment");
  });
});
