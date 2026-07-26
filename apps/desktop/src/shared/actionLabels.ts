import type { AppliedAction, OptimizationOpportunityGroup } from "@hwpx-optimizer/core";

export const OPPORTUNITY_ACTION_LABELS: Record<OptimizationOpportunityGroup["action"], string> = {
  "minify-xml": "문서 XML 정리",
  "remove-unused": "사용하지 않는 파일 제거",
  "strip-metadata": "EXIF 제외 이미지 메타데이터 제거",
  "optimize-png": "PNG 무손실 최적화",
  "convert-bmp-to-png": "BMP를 PNG로 변환",
  "resize-jpeg": "큰 JPEG 리사이즈",
  "resize-png": "큰 PNG 리사이즈",
  "convert-tiff-to-png": "TIFF를 PNG로 변환",
  "clean-shape-comment": "이미지 설명 메타데이터 정리",
  "consolidate-duplicate-images": "중복 이미지 참조 정리"
};

export const APPLIED_ACTION_LABELS: Record<AppliedAction["type"], string> = {
  ...OPPORTUNITY_ACTION_LABELS,
  "remove-unused": "미사용 리소스 제거",
  "minify-xml": "문서 XML 정리",
  "repack-zip": "HWPX 재압축"
};
