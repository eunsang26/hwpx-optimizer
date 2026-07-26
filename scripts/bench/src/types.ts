export const GO_METRIC_ID = "ssimulacra2" as const;
export const SSIMULACRA2_MATCH_TOLERANCE = 0.5;
export const Q_GRID = [60, 65, 70, 75, 80, 85, 88, 90, 95] as const;
export const PRIMARY_PROFILE = "balanced" as const;
export const PACKAGE_SAVINGS_GO_PERCENT = 15;
export const MAX_JPEG_EXCLUSION_RATIO = 0.2;
export const ENCODE_CPU_SOFT_FLAG_RATIO = 2;
export const JPEGLI_ENV = "HWPX_BENCH_JPEGLI";
export const SSIMULACRA2_ENV = "HWPX_BENCH_SSIMULACRA2";
export const CORPUS_DIR_ENV = "HWPX_BENCH_DIR";

export type BenchProfileName = "balanced" | "aggressive";
export type RawImage = { data: Buffer; width: number; height: number; channels: 3 };
export type EncodeResult = { bytes: Buffer; encodeMs: number; quality: number; candidate: string };
export type ImageStatus = "ok" | "error" | "no-data";
