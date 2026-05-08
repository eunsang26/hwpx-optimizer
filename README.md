# HWPX 문서 최적화

HWPX 문서 최적화는 한글 HWPX 파일의 용량 원인을 분석하고, 원본 파일은 그대로 둔 채 최적화된 `.hwpx` 파일을 새로 저장하는 무료 로컬 유틸리티입니다. Core 엔진, CLI, Electron 데스크톱 앱이 같은 TypeScript 코드를 공유합니다.

이 프로젝트의 기본 원칙은 로컬 처리입니다.

- 서버 업로드 없음
- 로그인, 계정, 과금, 클라우드 저장, 텔레메트리 없음
- 원본 파일 직접 수정 없음
- 기본 결과 파일명은 `<원본파일명>.optimized.hwpx`
- JSON 리포트는 데스크톱 설정에서 끌 수 있음

## 현재 상태

구현됨:

- HWPX ZIP 패키지 읽기와 필수 구조 검증
- XML, BinData, 이미지, 폰트, OLE, 기타 파일 분류
- 이미지 포맷, 용량, 픽셀 크기, 메타데이터, BMP 후보, 중복 이미지, 과대 이미지 분석
- 내부 리소스 참조 그래프 생성
- `safe`, `balanced`, `aggressive` 최적화 모드
- `analyze`, `report`, `verify`, `optimize`, `batch` CLI 명령
- 파일 선택, 드래그앤드롭, 분석, 모드 선택, 최적화, 결과 확인, 설정을 지원하는 Electron 데스크톱 앱
- 데스크톱 최적화 worker thread 처리, 진행률 표시, 취소
- Linux unpacked, Windows unpacked, Windows portable EXE, Windows ZIP 빌드
- Core, CLI, Desktop service/view-model 테스트

아직 완료 전 확인이 필요한 항목:

- GitHub Actions Windows runner에서 NSIS installer 생성과 release gate 통과는 확인됨. artifact 업로드는 수동 실행 기본값에서 꺼져 있고, 태그 릴리즈 또는 명시적 선택 시에만 수행함
- 깨끗한 Windows PC에서 수동 GUI QA 필요
- 시각 유사도 자동 비교는 아직 없음
- 특이한 HWPX XML 참조 형태는 더 많은 실제 문서 검증 필요

자세한 현재 제한은 [Known Limitations](docs/KNOWN_LIMITATIONS.md)를 확인하세요.

## 설치

필요한 것:

- Node.js 20 이상
- npm
- `sharp`와 `electron`이 지원하는 운영체제

의존성 설치:

```bash
npm install
```

Electron 다운로드 캐시는 프로젝트 내부 `.npm-cache/electron` 경로를 사용할 수 있습니다.

```bash
electron_config_cache=.npm-cache/electron node node_modules/electron/install.js
```

## 데스크톱 앱 사용

개발 환경에서 앱 실행:

```bash
npm run build
npm run desktop:start
```

Windows portable 실행 파일 만들기:

```bash
npm run desktop:portable:win
```

Windows 빠른 실행용 ZIP 만들기:

```bash
npm run desktop:zip:win
```

Windows에서 실행 시작이 빠른 배포 방식은 ZIP입니다. `release/HWPX Optimizer-0.1.0-x64.zip`을 한 번 압축 해제한 뒤 폴더 안의 `HWPX Optimizer.exe`를 실행하면 됩니다. 단일 portable EXE는 복사와 실행은 간단하지만, 시작할 때 앱 묶음을 임시 폴더로 풀기 때문에 ZIP 방식보다 실행 시작이 느릴 수 있습니다.

사용 흐름:

1. HWPX 파일을 앱에 끌어다 놓거나 `파일 선택`을 누릅니다.
2. 원본 용량, 이미지 개수, BMP 후보, 메타데이터, 예상 절감량을 확인합니다.
3. `안전`, `균형`, `최대 압축` 중 하나를 선택합니다.
4. `최적화 실행`을 누릅니다.
5. 결과 파일, 결과 폴더, JSON 리포트를 확인합니다.

설정은 이 컴퓨터의 Electron user data 경로에만 저장됩니다.

## 최적화 모드

### 안전 모드

문서 외형 변경 가능성이 낮은 작업만 수행합니다.

- ZIP 재압축
- XML minify
- JPEG 메타데이터 제거
- PNG 무손실 최적화
- 참조되지 않는 BinData 제거
- 이미지 리사이즈 없음
- JPEG 품질 저하 없음
- BMP 변환 없음

### 균형 모드

일반적인 대용량 문서 원인을 줄입니다.

- 안전 모드 작업
- BMP를 PNG로 변환
- 문서 표시 크기 대비 과도하게 큰 JPEG 리사이즈
- JPEG 품질 약 88
- PNG 최적화
- 이미지 설명 메타데이터 정리
- byte-identical 중복 이미지 참조 통합

### 최대 압축 모드

용량 절감을 우선합니다.

- 균형 모드 작업
- 더 강한 이미지 픽셀 예산
- JPEG 품질 약 80
- PNG palette 최적화
- 중복 이미지 참조 통합
- 이미지 품질 차이가 보일 수 있음

분석 화면과 리포트는 최적화 전에 “왜 파일이 큰지”와 “어떤 작업으로 얼마나 줄어들 수 있는지”를 먼저 보여줍니다.

## CLI 사용

개발 환경에서 CLI 실행:

```bash
npm run cli -- analyze input.hwpx
```

설치 후 workspace bin 실행:

```bash
node_modules/.bin/hwpx-opt analyze input.hwpx
```

문서 분석 후 JSON 리포트 저장:

```bash
npm run cli -- analyze input.hwpx --report input.report.json
```

사람이 읽기 쉬운 텍스트 리포트 생성:

```bash
npm run cli -- report input.hwpx --out input.report.txt
```

안전 모드 최적화:

```bash
npm run cli -- optimize input.hwpx --mode safe
```

균형 모드 최적화:

```bash
npm run cli -- optimize input.hwpx --mode balanced
```

최대 압축 모드 최적화:

```bash
npm run cli -- optimize input.hwpx --mode aggressive --out output.hwpx
```

고급 작업을 선택해서 실행:

```bash
npm run cli -- optimize input.hwpx --mode balanced --actions resize-jpeg,optimize-png
```

결과 검증:

```bash
npm run cli -- verify output.hwpx
```

폴더 안의 `.hwpx` 파일 일괄 최적화:

```bash
npm run cli -- batch ./docs --mode safe --out ./optimized
```

batch 모드는 파일 하나가 실패해도 전체 처리를 중단하지 않고, 출력 폴더에 `batch-report.json`을 저장합니다.

## 개발

특정 영역을 수정할 때는 대상 테스트를 먼저 실행합니다.

```bash
npm test -- packages/core/test/optimizer.test.ts
```

커밋 전 기본 검증:

```bash
npm test
npm run typecheck
npm run build
```

릴리즈 후보 검증:

```bash
npm run release:check
```

Windows portable 릴리즈 후보 검증:

```bash
npm run release:check:win-portable
```

이 명령은 단일 portable EXE와 빠른 실행용 ZIP을 함께 생성하고 체크섬 manifest를 검증합니다.

Windows installer 릴리즈 검증은 Windows release machine 또는 Windows CI runner에서 실행합니다.

```bash
npm run release:check:win
```

## 샘플 파일 정책

실제 HWPX/HWP 문서는 개인정보나 업무 문서를 포함할 수 있습니다. 저장소에는 올리지 않습니다.

루트 경로의 다음 파일은 git에서 무시됩니다.

- `sample*.hwpx`
- `sample*.hwp`
- `sample*.json`
- `sample*.txt`
- `결과/`

실수로 staging되면 커밋 전에 반드시 제외하세요.

## 문서

- [아키텍처](docs/ARCHITECTURE.md)
- [테스트](docs/TESTING.md)
- [릴리즈](docs/RELEASE.md)
- [Windows QA 체크리스트](docs/WINDOWS_QA_CHECKLIST.md)
- [알려진 한계](docs/KNOWN_LIMITATIONS.md)
