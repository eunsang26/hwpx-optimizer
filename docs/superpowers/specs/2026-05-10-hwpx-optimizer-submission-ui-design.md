# HWPX Optimizer Submission UI Redesign

## Purpose

Redesign the desktop app around the way public agency staff actually use it: after finishing a HWPX report, they need to reduce the file to a submission limit without damaging the document or overwriting the original.

The UI should present HWPX optimization as a safe submission-prep workflow, not as a generic compression dashboard. The primary mental model is:

> Set the submission limit, choose how much visual preservation matters, let the app build an automatic optimization plan, then run it.

## Accepted Concepts

Primary single-file concept:

- Generated concept: `/home/eunsang26/.codex/generated_images/019e0d90-6e71-7343-b886-300d49e29928/ig_0b4d334a7f50a1aa0169ff6b19f3088191a50b141de42cc511.png`
- Browser companion copy: `.superpowers/brainstorm/2-1778345170/content/target-preservation-plan-concept.png`

Batch-mode concept:

- Generated concept: `/home/eunsang26/.codex/generated_images/019e0d90-6e71-7343-b886-300d49e29928/ig_0b4d334a7f50a1aa0169ff6c60cc208191bc32c827643bba27.png`
- Browser companion copy: `.superpowers/brainstorm/2-1778345170/content/batch-mode-concept.png`

The generated images are visual references, not app assets. The implementation must use code-native text and controls.

## Core Product Framing

Visible framing:

- App title: `HWPX 보고서 최적화`
- Trust note: `원본은 그대로, 내 컴퓨터에서만 처리`
- Primary action, single-file: `목표에 맞게 줄이기`
- Primary action, batch: `<N>개 파일 줄이기`

The app should avoid sounding like a technical optimizer. Prefer submission-centered copy:

- `제출 제한`
- `보존 기준`
- `자동 최적화 계획`
- `목표 달성 가능`
- `원본은 변경하지 않고, 결과 파일은 새 이름으로 저장합니다.`

## Information Architecture

### User-Controlled Inputs

The user controls two high-level inputs.

`제출 제한` defines the desired result condition:

- `10 MB 이하`
- `20 MB 이하`
- `50 MB 이하`
- `직접 입력`
- `제한 없음`

`보존 기준` defines how aggressively the app may optimize:

- `외형 보존 우선`
- `권장`
- `용량 우선`

Do not present `안전 / 균형 / 최대` as the primary user-facing decision. Those can remain internal planning profiles, but the UI should frame them as preservation policy and generated plan strength.

### Program-Generated Plan

After analysis, the app creates an `자동 최적화 계획`.

The plan owns:

- selected optimization actions
- expected saving per action
- total expected saving
- expected output size
- target-status label
- warnings or attention states

If the user manually changes any action checkbox, the plan status changes to `사용자 지정 계획`.

## Single-File Screen

### Layout

Use a compact two-column utility layout.

Left/main column:

- top file summary
- submission limit and preservation controls
- result prediction
- primary action
- quiet secondary actions
- trust line
- post-run verification strip
- collapsible details row

Right sidebar:

- automatic optimization plan
- target-status summary
- total expected saving
- checkbox action list with per-action saving
- custom-plan note

### Required Single-File Copy

File summary example:

- `2026_사업결과보고서.hwpx`
- `28.4 MB`

Prediction:

- `28.4 MB → 예상 16.8 MB`
- `목표 달성 가능`
- `약 41% 감소`

Controls:

- `제출 제한`
- `20 MB 이하`
- `보존 기준`
- `권장`

Primary and secondary actions:

- `목표에 맞게 줄이기`
- `다른 파일 선택`
- `저장 위치`

Trust line:

- `원본은 변경하지 않고, 결과 파일은 새 이름으로 저장합니다.`

Collapsible details:

- `세부 분석 보기 · 이미지 12개 · 중복 2그룹 · 주의 리소스 0개`

Verification preview:

- `최적화 후 자동 확인`
- `문서 구조 확인`
- `누락 리소스 확인`
- `이미지 품질 기준 확인`
- `완료 후: 파일 열기 · 폴더 보기 · 결과 비교`

### Optimization Action Labels

Use non-technical action labels:

- `큰 이미지 적정 크기로 줄이기`
- `중복 이미지 정리`
- `이미지 불필요 정보 제거`
- `사용하지 않는 파일 제거`
- `개인정보 흔적 정리`

Show estimated saving on each row, for example:

- `8.2 MB`
- `3.1 MB`
- `420 KB`
- `900 KB`
- `120 KB`

## Batch Screen

### Entry Rule

Keep the default screen focused on one file. Switch to batch mode only when:

- the user selects multiple files
- the user selects a folder
- multiple HWPX files are dropped

Do not show a large batch panel on the initial single-file screen.

### Layout

Use the same visual system as the single-file screen.

Left/main column:

- batch header
- total-size summary
- shared submission limit and preservation controls
- file add/folder add/clear actions
- dense file list table
- completion actions strip

Right sidebar:

- `일괄 최적화 계획`
- target-status summary
- total expected saving
- checkbox action list with total expected saving
- primary batch action button
- original-preservation trust line

### Required Batch Copy

Header and summary:

- `8개 파일 일괄 최적화`
- `총 184.2 MB → 예상 96.5 MB`
- `예상 절감 87.7 MB`

Shared controls:

- `공통 제출 제한`
- `20 MB 이하`
- `보존 기준`
- `권장`

Batch actions:

- `파일 추가`
- `폴더 추가`
- `목록 비우기`
- `8개 파일 줄이기`

Sidebar status:

- `7개 목표 달성 가능 · 1개 확인 필요`
- `파일별 결과를 새 이름으로 저장합니다.`

Completion strip:

- `완료 후: 결과 폴더 보기 · 실패한 파일만 다시 시도 · 처리 내역 확인`
- `최적화 후 자동 확인: 문서 구조 · 누락 리소스 · 이미지 품질 기준`

### Batch File Rows

Rows should be table-like, scan-friendly, and compact. Required data:

- file name
- original size
- expected size
- target status
- processing state

Example rows:

- `2026_사업결과보고서.hwpx` · `28.4 MB → 16.8 MB` · `목표 달성 가능` · `대기`
- `첨부_사진대장.hwpx` · `54.1 MB → 18.9 MB` · `목표 달성 가능` · `대기`
- `회의록.hwpx` · `8.2 MB → 7.9 MB` · `이미 목표 이하` · `대기`
- `참고자료.hwpx` · `61.8 MB → 27.4 MB` · `목표 미달 가능` · `확인 필요`
- `사업비_정산.hwpx` · `31.7 MB → 19.2 MB` · `목표 달성 가능` · `대기`

Only attention rows, such as `목표 미달 가능`, should receive amber emphasis.

## Visual System

The app should feel like a compact Windows productivity utility.

Color:

- app background: cool light gray
- main surfaces: true white
- text: dark neutral
- muted text: cool gray
- borders: crisp 1px cool gray
- primary accent: restrained blue
- success/positive: teal
- caution: amber, only for attention states
- danger: reserved for failures

Shape and elevation:

- radius: 6px to 8px
- shadows: minimal; prefer borders over floating cards
- avoid nested cards
- avoid large dashboards, charts, hero layouts, illustrations, gradients, and decorative content

Typography:

- compact Korean UI typography
- section headings should be clear but not oversized
- buttons and controls need explicit type sizing and weight
- no viewport-scaled font sizes
- no negative letter spacing

Container model:

- one main work area plus one calm right sidebar
- rows/lists/tables instead of card grids
- details are collapsed or visually secondary by default

## Interaction Rules

Changing `제출 제한` recalculates:

- target-status label
- expected output size
- selected plan actions
- total expected saving
- batch row target statuses

Changing `보존 기준` recalculates:

- selected plan actions
- expected output size
- target-status label
- action availability if an action violates the selected preservation policy

Changing an action checkbox:

- updates total expected saving
- updates expected output size
- updates target-status label
- switches the plan label to `사용자 지정 계획`

Running optimization:

- must never overwrite the original
- must show progress without blocking the UI
- must show verification outcome after completion
- must make `파일 열기`, `폴더 보기`, and `결과 비교` easy to find

Batch processing:

- must allow canceling the active run
- must preserve per-file status
- must support retrying only failed files
- should not block the whole UI if one file fails

## Scope Boundaries

In scope for the implementation plan:

- desktop renderer redesign
- settings/state additions required for submission limit and preservation preference
- plan mapping from high-level preferences to existing optimization action toggles
- batch-mode layout using the existing multi-file capabilities
- result/verification copy updates
- tests for view-model state and desktop smoke assertions

Out of scope unless separately approved:

- changing core optimization algorithms
- adding new binary document transformations
- adding cloud upload, accounts, telemetry, or network-dependent paths
- expert threshold tuning
- heavy visual analytics or charts

## Verification Requirements

Implementation must be checked with:

- targeted desktop/view-model tests
- full `npm test`
- `npm run typecheck`
- `npm run build`
- `npm run desktop:smoke`
- `git diff --check`

For visual fidelity, compare the implemented Electron screen against the accepted concept images. The final handoff should include:

- accepted concept path
- rendered screenshot method
- concept and implementation screenshot inspection via `view_image`
- at least five concrete comparison points
- above-the-fold copy diff result
- remaining intentional deviations, if any
