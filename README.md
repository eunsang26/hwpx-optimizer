# HWPX 문서 최적화 (HWPX Optimizer)

> 한글 `.hwpx` 파일의 용량을 **원본은 그대로 둔 채** 새 파일로 줄여주는 무료 로컬 도구입니다.
> 데스크톱 앱(Windows·Linux)과 CLI를 모두 제공하며, 모든 처리는 사용자의 PC 안에서만 이루어집니다.

- 제작 / 관리: 한강유역수도지원센터 조은상 과장
- 버전: 0.1.0
- 라이선스: 사내·비영리 무상 사용 (자세한 조건은 [`TERMS.txt`](TERMS.txt))

---

## 목차

1. [이 도구가 해 주는 일](#1-이-도구가-해-주는-일)
2. [핵심 원칙 (개인정보·보안)](#2-핵심-원칙-개인정보보안)
3. [설치하기](#3-설치하기)
4. [빠른 시작](#4-빠른-시작)
5. [데스크톱 앱 사용방법](#5-데스크톱-앱-사용방법)
6. [CLI 사용방법](#6-cli-사용방법)
7. [최적화 모드 비교](#7-최적화-모드-비교)
8. [고급 옵션](#8-고급-옵션)
9. [프로젝트 구조](#9-프로젝트-구조)
10. [개발자용 가이드](#10-개발자용-가이드)
11. [알려진 한계](#11-알려진-한계)
12. [문서·문의](#12-문서문의)

---

## 1. 이 도구가 해 주는 일

`.hwpx` 파일은 내부적으로 ZIP 패키지이며, 대부분의 용량은 본문 XML이 아니라 **이미지(BMP/PNG/JPEG/TIFF)** 가 차지합니다. 이 도구는 다음을 수행합니다.

- 문서를 열어 **왜 파일이 큰지** 분석하고 사람이 읽기 쉬운 리포트 생성
- 안전 / 균형 / 최대 압축 세 가지 모드 중 하나로 최적화 실행
- 결과 파일이 **원본 대비 이상이 없는지 자동 검증** (구조 무결성 + 이미지 PSNR)
- 결과를 **원본과 다른 이름**(`<원본>_optimized.hwpx`)으로 저장

전형적인 용량 감소 예 (실제 결과는 문서에 따라 다름):

| 모드        | 일반적 감소율 | 사용 시점                                |
| ----------- | ------------- | ---------------------------------------- |
| 안전        | 5 ~ 25%       | 외형 변화 없이 깨끗이 정리하고 싶을 때    |
| 균형        | 30 ~ 60%      | 이메일·웹 첨부 등 일상 공유용             |
| 최대 압축   | 50 ~ 80%      | 대용량 보고서·아카이브·인쇄용 사본        |

---

## 2. 핵심 원칙 (개인정보·보안)

| 원칙              | 내용                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------- |
| **로컬 처리**     | 어떤 데이터도 외부 서버로 전송되지 않습니다. 인터넷 연결 없이도 동작합니다.            |
| **계정 불필요**   | 회원가입·로그인·과금·텔레메트리(사용 추적) 없음.                                       |
| **원본 보존**     | 원본 파일을 절대 덮어쓰지 않습니다. 결과는 항상 새 파일로 저장됩니다.                  |
| **검증 후 저장**  | 결과 파일이 구조 검증을 통과하지 못하면 파일을 만들지 않습니다.                        |
| **참조 안전**     | 본문이 참조하는 리소스는 삭제하지 않습니다 (참조 그래프 확인 후 처리).                  |

> **주의**: HWPX는 한 ZIP 패키지지만 일부 옛 `.hwp`(바이너리) 파일은 지원하지 않습니다. 이 경우 명확한 오류 메시지로 안내합니다.

---

## 3. 설치하기

### A. 일반 사용자 (Windows)

릴리즈 페이지에서 두 가지 방식 중 하나를 다운로드하세요.

| 배포 방식        | 파일명 예                                  | 특징                                          |
| ---------------- | ------------------------------------------ | --------------------------------------------- |
| **ZIP (권장)**   | `HWPX Optimizer-0.1.0-x64.zip`             | 압축만 풀면 바로 실행 가능, 시작이 빠름        |
| Portable EXE     | `HWPX Optimizer-0.1.0-x64.exe` (portable)  | 단일 실행 파일, 실행 시마다 임시 폴더에 풀림    |
| NSIS Installer   | `HWPX Optimizer Setup-0.1.0.exe`           | 일반적 Windows 설치 마법사                     |

다운로드 후 배포 공지의 SHA256과 `release-manifest.json`을 비교하면 위·변조 여부를 확인할 수 있습니다.

> 현재 Windows 배포 파일은 **자체서명** 인증서로 서명되어 있어, 처음 실행 시 SmartScreen 경고가 표시될 수 있습니다. "추가 정보 → 실행"으로 진행할 수 있습니다.

### B. 소스에서 직접 빌드 (개발자·고급 사용자)

```bash
# 사전 요구사항: Node.js 20 이상, npm
git clone <repository-url>
cd hwpx-optimizer
npm install
```

Electron 다운로드 캐시를 프로젝트 내부에 두고 싶다면:

```bash
electron_config_cache=.npm-cache/electron node node_modules/electron/install.js
```

---

## 4. 빠른 시작

### 데스크톱 앱

```bash
npm run build
npm run desktop:start
```

화면이 뜨면 HWPX 파일을 끌어다 놓고 → 모드 선택 → **최적화 실행** 클릭.

### CLI

```bash
# 1. 분석 (어떤 작업이 가능한지 미리 보기)
npm run cli -- analyze sample.hwpx

# 2. 균형 모드로 최적화
npm run cli -- optimize sample.hwpx --mode balanced

# → sample.optimized.hwpx 와 sample.optimized.hwpx.report.json 생성
```

---

## 5. 데스크톱 앱 사용방법

### 5.1 실행하기

| 환경              | 명령어                                         |
| ----------------- | ---------------------------------------------- |
| 개발/소스 빌드    | `npm run desktop:start`                        |
| Windows 패키지    | 압축 해제 후 `HWPX Optimizer.exe` 더블 클릭     |

### 5.2 화면 흐름

1. **파일 추가**: 창에 `.hwpx` 파일을 드래그하거나 `파일 선택` / `여러 파일` / `폴더 선택` 버튼 사용
2. **분석 결과 확인**: 원본 용량, 이미지 개수, BMP 후보, 중복 이미지, 메타데이터, **예상 절감량**, 카테고리별 비중(이미지/XML/폰트/OLE/기타) 막대 차트가 표시됩니다.
3. **모드 선택**: `안전` · `균형` · `최대 압축` 중 하나 선택
   - 균형/최대 압축 모드에서는 **세부 작업 체크박스**(`이미지 리사이즈`, `BMP→PNG` 등)를 개별로 켜고 끌 수 있으며, 각 항목에 위험도·시각적 영향 배지가 표시됩니다.
4. **최적화 실행**: 진행률이 표시되며, **취소** 버튼으로 중간에 멈출 수 있습니다.
5. **결과 확인**:
   - **결과 파일 / 폴더 열기** 단축 버튼
   - **이미지 비교** 모달: 변경된 이미지의 변환 전/후를 PSNR(품질 등급)과 함께 좌우 비교
   - **다시 검증** 버튼으로 결과의 무결성을 즉시 재확인
   - JSON 리포트 다운로드(설정에서 끌 수 있음)

### 5.3 일괄(다중) 처리

여러 파일을 한 번에 드래그하면 큐(queue)로 추가되어 한 파일씩 순차 처리됩니다. 각 행에는 상태(대기/진행/완료/실패/취소)와 절감 요약이 표시됩니다.

### 5.4 설정

설정은 이 컴퓨터의 Electron user-data 폴더에만 저장됩니다.

- 결과 저장 위치 (원본 옆 / 별도 폴더)
- JSON 리포트 생성 여부
- 이미 최적화된 파일 열 때 경고 표시

---

## 6. CLI 사용방법

빌드 후 `node_modules/.bin/hwpx-opt` 로 사용 가능하며, 개발 환경에서는 `npm run cli --` 뒤에 인자를 붙입니다.

### 6.1 명령어 한눈에 보기

| 명령              | 용도                                            |
| ----------------- | ----------------------------------------------- |
| `analyze`         | 파일을 분석하고 JSON 리포트 저장                  |
| `report`          | 사람이 읽기 쉬운 텍스트 리포트 생성               |
| `optimize`        | 실제 최적화 실행 (안전/균형/최대 압축)            |
| `verify`          | 기존 결과 파일의 구조·시각 검증                   |
| `batch`           | 폴더 안 `.hwpx` 일괄 최적화                       |
| `list-actions`    | `--actions`에 쓸 수 있는 세부 작업 목록 출력      |

### 6.2 분석

```bash
# 결과는 input.hwpx.report.json 으로 자동 저장
npm run cli -- analyze input.hwpx

# 별도 경로로 저장
npm run cli -- analyze input.hwpx --report ./reports/input.json

# 사람이 읽는 텍스트 리포트
npm run cli -- report input.hwpx --out input.report.txt
```

### 6.3 최적화

```bash
# 안전 모드 (기본)
npm run cli -- optimize input.hwpx --mode safe

# 균형 모드
npm run cli -- optimize input.hwpx --mode balanced

# 최대 압축 + 결과 경로 지정
npm run cli -- optimize input.hwpx --mode aggressive --out ./out/result.hwpx

# 특정 작업만 골라 실행
npm run cli -- optimize input.hwpx --mode balanced \
  --actions resize-jpeg,optimize-png,strip-metadata

# 사용 가능한 --actions 목록 확인
npm run cli -- list-actions
```

### 6.4 검증

```bash
npm run cli -- verify output.hwpx
```

구조 무결성과 이미지 PSNR(균형 18 dB, 최대 압축 14 dB) 기준을 함께 점검합니다.

### 6.5 일괄 처리

```bash
# ./docs 폴더 안 .hwpx 전체를 균형 모드로 ./optimized에 저장, 동시 2개 처리
npm run cli -- batch ./docs --mode balanced --out ./optimized --jobs 2
```

- 한 파일이 실패해도 전체가 중단되지 않습니다.
- 출력 폴더에 `batch-report.json`이 생성됩니다. 실패 항목에는 `stage`(read-input / optimize / resolve-output-path / write-output / write-report)가 기록됩니다.
- `--jobs`는 최대 4까지 지정 가능합니다.

---

## 7. 최적화 모드 비교

| 작업                                     | 안전 | 균형 | 최대 압축 |
| ---------------------------------------- | :--: | :--: | :-------: |
| ZIP 재압축 (DEFLATE 9)                   |  ✓   |  ✓   |     ✓     |
| XML 공백 minify                          |  ✓   |  ✓   |     ✓     |
| JPEG 메타데이터 제거 (XMP/IPTC/comment)  |  ✓   |  ✓   |     ✓     |
| PNG 무손실 최적화                        |  ✓   |  ✓   |     ✓     |
| 참조 안 되는 BinData 삭제                |  ✓   |  ✓   |     ✓     |
| BMP / TIFF → PNG 변환                    |      |  ✓   |     ✓     |
| 과대 JPEG 리사이즈 (표시 크기 기준)      |      |  ✓   |     ✓     |
| 과대 PNG 리사이즈                        |      |  ✓   |     ✓     |
| JPEG 품질 재인코딩                       |      | ~88  |   ~80     |
| PNG 팔레트화                             |      |      |     ✓     |
| 중복 이미지 통합 (참조 재배선)            |      |  ✓   |     ✓     |

**모드별 시각 손상 허용선** (PSNR, 낮을수록 차이 큼):

- 안전: 변경 자체가 거의 없음
- 균형: 18 dB 이하면 거부 → 결과 파일을 만들지 않음
- 최대 압축: 14 dB 이하면 거부

> 형식 전환은 한 방향만 허용됩니다: BMP/TIFF → PNG, JPEG → JPEG, PNG → PNG. 픽셀 크기는 절대 커지지 않습니다.

---

## 8. 고급 옵션

| 옵션                              | 적용 명령           | 설명                                                            |
| --------------------------------- | ------------------- | --------------------------------------------------------------- |
| `--mode safe\|balanced\|aggressive` | `optimize`, `batch` | 최적화 강도 선택                                                  |
| `--actions a,b,c`                 | `optimize`, `batch` | 적용할 세부 작업만 골라 실행 (`list-actions`로 키 확인)            |
| `--target-bytes` / `--target-mb`  | 대부분의 명령        | 파일별 목표 용량 (도달 못 하면 리포트에 `missed`로 기록)            |
| `--batch-target-bytes` / `--batch-target-mb` | `batch`   | 폴더 전체의 합산 목표 용량 (원본 크기 비율로 자동 분배)             |
| `--allow-larger`                  | `optimize`, `batch` | 결과가 원본보다 커도 허용 (기본은 거부)                            |
| `--overwrite`                     | `optimize`, `batch` | 같은 이름이 있을 때 덮어쓰기 (기본은 `-2`, `-3` 자동 부여)         |
| `--max-input-bytes`               | 모든 명령           | 처리할 입력 최대 크기(byte). 기본 512 MiB                          |
| `--analysis-mode quick\|deep`     | `analyze`, `report` | 빠른 분석 vs 더 깊은 검사                                          |
| `--jobs N`                        | `batch`             | 동시 처리 개수 (1~4)                                              |

원본 파일 경로와 동일한 위치를 결과·리포트 경로로 지정하면 안전을 위해 작업이 거부됩니다.

---

## 9. 프로젝트 구조

```text
hwpx-optimizer/
├── apps/
│   ├── desktop/         # Electron 데스크톱 앱 (main / preload / renderer)
│   └── tauri-desktop/   # 실험적 Tauri 셸
├── packages/
│   ├── core/            # 모든 HWPX 로직 — reader/analyzer/optimizer/writer/verifier/report
│   └── cli/             # hwpx-opt 커맨드라인 래퍼 (얇은 fs/stdout 어댑터)
├── scripts/             # 빌드·릴리즈·검증·아이콘 생성 스크립트
├── docs/                # 아키텍처·테스트·릴리즈·QA·한계 문서
├── mockups/             # UI 디자인 시안 (HTML)
├── build/               # 빌드 산출물(임시)
├── release/             # 릴리즈 패키지(임시)
├── CLAUDE.md            # AI 에이전트 협업용 가이드
├── CHANGELOG.md         # 변경 이력
├── TERMS.txt            # 사용 조건·면책
└── package.json         # npm workspaces 루트
```

**처리 파이프라인** (`packages/core/src/`):

```
input.hwpx
  → reader.ts            (ZIP 열기, 최소 구조 검증, zip-slip 방어)
  → analyzer.ts          (용량/카테고리/이미지/메타데이터 분석)
  → imageDisplay.ts      (실제 표시 픽셀 예산 계산)
  → referenceGraph.ts    (XML이 실제로 참조하는 BinData 추적)
  → planner.ts / opportunities.ts  (모드별 작업 계획)
  → optimizer.ts / balancedOptimizer.ts  (버퍼에서만 변경)
  → writer.ts            (DEFLATE 9로 재패키징)
  → verifier.ts          (구조 + 시각 PSNR 검증)
  → report.ts            (JSON 리포트)
```

세부 모듈 설명은 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) 참고.

---

## 10. 개발자용 가이드

```bash
# 전체 테스트
npm test

# 한 파일만
npm test -- packages/core/test/optimizer.test.ts

# 타입 검사
npm run typecheck

# 전체 빌드 (core + cli + desktop)
npm run build
```

**커밋 전 권장 게이트**:

```bash
npm test && npm run typecheck && npm run build
```

**데스크톱 스모크 테스트** (헤드리스):

```bash
HWPX_OPT_SMOKE_INPUT=./sample.hwpx \
HWPX_OPT_SMOKE_MODE=balanced \
xvfb-run -a npm run desktop:smoke
```

**릴리즈 검증**:

```bash
# Linux/일반
npm run release:check

# Windows 포터블/ZIP (Windows 머신 없이도 검증 가능한 부분)
npm run release:check:win-portable

# Windows installer 전체 게이트 (Windows 런너에서만)
npm run release:check:win
```

---

## 11. 알려진 한계

- 자동 시각 비교는 PSNR 기반(픽셀 신호 대 잡음비)이며, 미세한 색 차이를 사람이 인지하는 수준까지 보장하지는 않습니다.
- 깨끗한 Windows PC에서의 수동 GUI QA는 별도 체크리스트로 진행됩니다.
- 특이한 HWPX XML 참조 형태(특히 비표준 본문 구조)는 실제 문서 검증이 더 필요합니다.
- 옛 바이너리 `.hwp` 파일은 지원 대상이 아닙니다 (HWPX로 변환 후 사용).

자세한 내용: [`docs/KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md)

---

## 12. 문서·문의

| 문서                                             | 내용                          |
| ------------------------------------------------ | ----------------------------- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)   | 모듈·파이프라인·경계 설명        |
| [`docs/TESTING.md`](docs/TESTING.md)             | 테스트 전략과 회귀 corpus        |
| [`docs/RELEASE.md`](docs/RELEASE.md)             | 릴리즈 절차                    |
| [`docs/WINDOWS_QA_CHECKLIST.md`](docs/WINDOWS_QA_CHECKLIST.md) | Windows 수동 QA 항목 |
| [`docs/KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md) | 현재 한계               |
| [`docs/SECURITY_REVIEW.md`](docs/SECURITY_REVIEW.md) | 보안 검토                   |
| [`CHANGELOG.md`](CHANGELOG.md)                   | 버전별 변경 이력                |
| [`TERMS.txt`](TERMS.txt)                         | 사용 조건·면책 전문             |

### 샘플 파일 정책

실제 HWPX/HWP는 개인정보·업무 문서를 포함할 수 있어 저장소에 올리지 않습니다. 루트의 다음 패턴은 `.gitignore`에 포함되어 있습니다.

- `sample*.hwpx`, `sample*.hwp`, `sample*.json`, `sample*.txt`
- `결과/`

PR 작성 전 staging을 한 번 더 확인해 실수로 포함되지 않도록 해 주세요.

---

문의·의견은 사내 채널 또는 저장소 issue로 부탁드립니다.
