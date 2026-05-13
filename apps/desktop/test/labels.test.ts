import { describe, expect, it } from "vitest";
import {
  actionLabel,
  batchStatusLabel,
  errorLabel,
  formatPsnr,
  modeLabel,
  modeWarningMessage,
  progressLabel,
  psnrTier,
  psnrTierLabel,
  riskBadgeLabel,
  visualImpactBadgeLabel,
  warningLabel
} from "../src/shared/labels.js";

describe("shared labels", () => {
  it("translates progress strings, including dynamic mode-specific phrasing", () => {
    expect(progressLabel("Reading HWPX package")).toBe("HWPX 문서 구조를 읽는 중입니다");
    expect(progressLabel("Optimization complete")).toBe("최적화가 완료되었습니다");
    expect(progressLabel("Optimizing document in safe mode")).toBe("안전 모드로 문서를 최적화하는 중입니다");
    expect(progressLabel("Optimizing document in balanced mode")).toBe("균형 모드로 문서를 최적화하는 중입니다");
    expect(progressLabel("Optimizing document in aggressive mode")).toBe("최대 압축 모드로 문서를 최적화하는 중입니다");
    expect(progressLabel("Some untranslated stage")).toBe("Some untranslated stage");
  });

  it("translates known runtime errors to user-facing Korean messages", () => {
    expect(errorLabel("Analysis cancelled.")).toBe("분석이 취소되었습니다.");
    expect(errorLabel("Optimization cancelled.")).toBe("최적화가 취소되었습니다.");
    expect(errorLabel("Unsupported HWP binary file: save or export the document as .hwpx before optimizing")).toBe(
      "HWP 파일은 직접 최적화할 수 없습니다. 한글에서 HWPX로 저장/내보낸 뒤 다시 선택하세요."
    );
    expect(
      errorLabel("/tmp/large.hwpx exceeds the supported local processing limit (600 bytes; limit 10 bytes).")
    ).toBe("파일이 로컬 처리 한도를 초과했습니다. 더 작은 파일로 나누거나 HWPX 내부 이미지를 먼저 정리하세요. (600 bytes / 한도 10 bytes)");
    expect(errorLabel("Files are too large for image preview (210 bytes; limit 100 bytes).")).toBe(
      "이미지 비교 미리보기 한도를 초과했습니다. 최적화 결과 파일은 생성되었으니 파일/폴더 열기로 확인하세요. (210 bytes / 한도 100 bytes)"
    );
    expect(errorLabel("EACCES: permission denied, open '/locked/file.hwpx'")).toBe(
      "파일 또는 폴더 권한이 없어 처리할 수 없습니다. 다른 저장 위치를 선택하거나 문서를 닫은 뒤 다시 시도하세요."
    );
    expect(errorLabel("Unknown failure")).toBe("Unknown failure");
  });

  it("matches warning patterns case-insensitively and falls back to the raw text", () => {
    expect(warningLabel("OLE objects can be user-visible")).toBe(
      "OLE 객체는 문서에서 보일 수 있어 자동으로 제거하지 않습니다."
    );
    expect(warningLabel("Aggressive mode did not produce a smaller file; original package bytes returned.")).toBe(
      "최대 압축 모드에서 더 작은 결과가 나오지 않아 원본 바이트를 유지했습니다."
    );
    expect(warningLabel("Embedded fonts can affect document appearance if removed.")).toBe(
      "임베디드 폰트는 문서 외형에 영향을 줄 수 있어 자동으로 제거하지 않습니다."
    );
    expect(
      warningLabel("BMP candidate detected; convert-bmp-to-png may reduce size: BinData/image1.bmp")
    ).toBe(
      "BMP 이미지 발견: BinData/image1.bmp — 균형/최대 압축 모드에서 PNG로 변환하면 크기를 줄일 수 있습니다."
    );
    expect(warningLabel("Untranslated warning")).toBe("Untranslated warning");
  });

  it("provides Korean labels for every supported action and mode", () => {
    expect(actionLabel("strip-metadata")).toBe("이미지 메타데이터 제거");
    expect(actionLabel("convert-bmp-to-png")).toBe("BMP를 PNG로 변환");
    expect(actionLabel("clean-shape-comment")).toBe("이미지 설명 메타데이터 정리");
    expect(actionLabel("custom-action")).toBe("custom-action");
    expect(modeLabel("safe")).toBe("안전");
    expect(modeLabel("balanced")).toBe("균형");
    expect(modeLabel("aggressive")).toBe("최대 압축");
  });

  it("returns Korean batch status labels for every state", () => {
    expect(batchStatusLabel("pending")).toBe("대기");
    expect(batchStatusLabel("running")).toBe("처리 중");
    expect(batchStatusLabel("done")).toBe("완료");
    expect(batchStatusLabel("failed")).toBe("실패");
    expect(batchStatusLabel("cancelled")).toBe("취소");
  });

  it("returns badge labels mapped to risk and visual impact levels", () => {
    expect(riskBadgeLabel("safe")).toBe("안전");
    expect(riskBadgeLabel("medium")).toBe("주의");
    expect(riskBadgeLabel("high")).toBe("위험");
    expect(visualImpactBadgeLabel("none")).toBe("외형 영향 없음");
    expect(visualImpactBadgeLabel("low")).toBe("외형 영향 작음");
    expect(visualImpactBadgeLabel("medium")).toBe("외형 영향 보통");
    expect(visualImpactBadgeLabel("high")).toBe("외형 영향 큼");
  });

  it("classifies PSNR scores into tiers with Korean labels", () => {
    expect(psnrTier(80)).toBe("identical");
    expect(psnrTier(50)).toBe("excellent");
    expect(psnrTier(40)).toBe("good");
    expect(psnrTier(30)).toBe("fair");
    expect(psnrTier(20)).toBe("poor");
    expect(psnrTier(null)).toBe("unknown");
    expect(psnrTier(undefined)).toBe("unknown");
    expect(psnrTier(Number.NaN)).toBe("unknown");

    expect(psnrTierLabel("identical")).toBe("동일");
    expect(psnrTierLabel("excellent")).toBe("매우 좋음");
    expect(psnrTierLabel("good")).toBe("좋음");
    expect(psnrTierLabel("fair")).toBe("보통");
    expect(psnrTierLabel("poor")).toBe("차이 인지");
    expect(psnrTierLabel("unknown")).toBe("측정 불가");
  });

  it("formats PSNR values with Korean fallbacks", () => {
    expect(formatPsnr(45.123)).toBe("45.12 dB");
    expect(formatPsnr(72)).toBe("동일");
    expect(formatPsnr(null)).toBe("측정 불가");
    expect(formatPsnr(undefined)).toBe("측정 불가");
    expect(formatPsnr(Number.POSITIVE_INFINITY)).toBe("동일");
  });

  it("composes a mode warning that reflects user toggles", () => {
    expect(modeWarningMessage({ mode: "aggressive", showAggressiveWarning: true })).toBe(
      "최대 압축은 이미지 품질 차이가 보일 수 있습니다."
    );
    expect(modeWarningMessage({ mode: "aggressive", showAggressiveWarning: false })).toBe(
      "안전 모드는 문서 외형 변화 가능성이 낮은 작업만 수행합니다."
    );
    expect(modeWarningMessage({ mode: "balanced", showAggressiveWarning: true })).toBe(
      "균형 모드는 표시 크기를 기준으로 큰 이미지와 BMP를 줄입니다."
    );
    expect(modeWarningMessage({ mode: "safe", showAggressiveWarning: true })).toBe(
      "안전 모드는 문서 외형 변화 가능성이 낮은 작업만 수행합니다."
    );
  });
});
