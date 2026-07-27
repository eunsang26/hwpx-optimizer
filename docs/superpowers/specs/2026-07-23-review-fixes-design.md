# 리뷰 지적사항 일괄 수정 (백엔드+프론트+디자인)

날짜: 2026-07-23
브랜치: `claude/hwpx-optimize-verification-8e25ef`

## Goal

코드 스캔·디자인 리뷰에서 나온 정확성·안전성·접근성·디자인 정체성 결함을 4개 배치로
나눠 전부 수정하고, 각 배치마다 테스트·타입체크로 검증한다. 최종적으로 "제출 기준
통과 여부"가 한눈에 들어오고, 신뢰할 수 있으며, 접근성 기준을 만족하는 완성도로 끌어올린다.

## 확정된 설계 결정

- 배치 목록 파일별 체크박스: **기능 연결** — 선택된(체크된) 파일만 `runBatch`가 처리, 전체선택 토글 동작.
- P2 시그니처: **한도선 게이지 + 판정 필** — 수평 게이지에 제출 한도선을 그리고 결과 파일 위치 표시 + "통과(17.3MB)/초과(+3.2MB)" 필. 기존 `#target-track-fill` 발전.
- 다크모드: **제외**(라이트 우선 도구, YAGNI).
- "mimetype 테스트 실패": **코드 수정 대상 아님** — 워크트리↔메인 체크아웃 버전 스큐 아티팩트. 별도 안내.

## 진행 방식

영역별 배치 → 각 배치 끝에 `nvm use 20 && npx vitest run` + `npm run typecheck` → 커밋 → 보고.
기존에 커밋 안 된 verifier 수정(dimensions collapsed)은 Batch 1에 함께 커밋.

## Batch 1 — 백엔드 코어 (`packages/core`)

1. [MED] 확장자 변경 시 출력 경로 충돌 가드 — `balancedOptimizer.ts:96`. 변환 outputPath가 기존/다른 엔트리와 충돌하면 스킵 또는 유니크화.
2. [MED] 시각 중복 해싱 전체 raw 디코드 → 다운스케일 샘플 해시 — `visualSimilarity.ts:74`.
3. [MED] 보안메타 키워드 스캔 오탐 완화 — `reader.ts:249`. 임의 텍스트 substring → 요소/속성명·네임스페이스 기반으로 좁힘.
4. [MED] BMP 미지원 변형(8bit/RLE/BITFIELDS) 명시적 감지·경고 — `bmp.ts`, `opportunities.ts`.
5. [LOW] media-type 재작성 키 매칭 확장 — `balancedOptimizer.ts:270` (`findHrefAttributeKey` 재사용, media-type 대소문자 무시).
6. [LOW] TIFF→PNG orientation 통일(`.rotate()`) — `opportunities.ts:467`.

## Batch 2 — 백엔드 통합 (CLI/Electron)

1. [MED] 문서 워커 워치독 타임아웃/행 복구 — `apps/desktop/src/main.ts:709`.
2. [LOW] no-overwrite 네이밍 TOCTOU → `wx`/`O_EXCL` 생성 — cli `index.ts:150`, desktopService.
3. [LOW] Electron `hwpx:optimize` IPC 인자 런타임 검증 — `main.ts:197`.
4. [LOW] `--jobs` 4 클램프 문서화/경고 — cli `index.ts:602`.

## Batch 3 — 프론트 기능/접근성 (`apps/desktop`)

1. [HIGH] 단일 최적화 레이스 가드 — `renderer.ts:1192` (`optimizeRunning` 플래그 + filePath 캡처, loadFile 가드 확장).
2. [HIGH] 배치 체크박스 선택 반영 — `templates.ts:54`, `renderer.ts` (선택 상태 + runBatch 반영 + 전체선택).
3. [MED] 분석 취소 시 `analysisSequence` 무효화 — `renderer.ts:303`.
4. [MED] 배치 진행바 per-item 리셋 — `renderer.ts:1220`.
5. [MED] 설정/도움말 패널 `inert`+포커스 이동/복원 — `styles.css:1947`, `renderer.ts:601`.
6. [MED] 이미지 비교 모달 Esc + 포커스 트랩 — `renderer.ts:324`.
7. [LOW] 단위 표기 통일, 퍼센트 정밀도, 데드 UI 제거, `role="progressbar"`+aria-live, 커스텀 한도 소수점, 썸네일 src 이스케이프.

## Batch 4 — 프론트 디자인 P1–P6

1. [P1] Pretendard Variable 로컬 `@font-face` 번들(woff2) — CSP `font-src 'self'` 유지.
2. [P2] 기준 통과 시그니처: 한도선 게이지 + 판정 필.
3. [P3] 요약 지표 위계(핵심 지표 강조).
4. [P4] 상태 색: 기준 초과 시 red/amber 결정적 사용.
5. [P5] `prefers-reduced-motion` 대응 + 포커스 링을 select/input/checkbox/summary로 확장.
6. [P6] 빈 상태 카피(대시 4개 → 안내 문구).

## 검증 기준

- 각 배치: core 테스트 통과 유지, 타입체크 통과, 신규/수정 동작에 회귀 테스트 추가.
- 디자인: 브라우저 프리뷰 캡처로 전후 비교(빈 상태 + 채워진 상태 + 좁은 폭).
