import type { OptimizationOpportunityGroup } from "@hwpx-optimizer/core";

export type SubmissionActionBucket = "image" | "metadata" | "author";
type ActionDefinition = { label: string; planLabel: string; appliedLabel?: string; bucket: SubmissionActionBucket; priority: number };

/** One UI catalog; distinct labels retain their existing context-specific wording. */
export const ACTION_CATALOG: Record<OptimizationOpportunityGroup["action"], ActionDefinition> = {
  "minify-xml": {"label": "문서 XML 정리", "planLabel": "문서 XML 정리", "bucket": "metadata", "priority": 30},
  "remove-unused": {"label": "사용하지 않는 파일 제거", "planLabel": "사용하지 않는 파일 제거", "bucket": "metadata", "priority": 20, "appliedLabel": "미사용 리소스 제거"},
  "strip-metadata": {"label": "EXIF 제외 이미지 메타데이터 제거", "planLabel": "EXIF 제외 이미지 정보 제거", "bucket": "metadata", "priority": 40},
  "optimize-png": {"label": "PNG 무손실 최적화", "planLabel": "PNG 무손실 최적화", "bucket": "metadata", "priority": 50},
  "convert-bmp-to-png": {"label": "BMP를 PNG로 변환", "planLabel": "BMP를 PNG로 변환", "bucket": "image", "priority": 70},
  "resize-jpeg": {"label": "큰 JPEG 리사이즈", "planLabel": "큰 JPEG 리사이즈", "bucket": "image", "priority": 90},
  "resize-png": {"label": "큰 PNG 리사이즈", "planLabel": "큰 PNG 리사이즈", "bucket": "image", "priority": 100},
  "convert-tiff-to-png": {"label": "TIFF를 PNG로 변환", "planLabel": "TIFF를 PNG로 변환", "bucket": "image", "priority": 80},
  "clean-shape-comment": {"label": "생성된 그림 이름·크기 정리", "planLabel": "생성된 그림 이름·크기 정리", "bucket": "author", "priority": 60},
  "consolidate-duplicate-images": {"label": "중복 이미지 참조 정리", "planLabel": "중복 이미지 참조 정리", "bucket": "image", "priority": 10}
};

export const CLEANUP_ACTIONS = ["clean-shape-comment", "strip-metadata"] as const;
