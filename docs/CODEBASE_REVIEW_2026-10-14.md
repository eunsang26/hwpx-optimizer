# HWPX Optimizer 코드베이스 리뷰

2026년 10월 14일 기준 v0.1.9, 커밋 `315b61b`를 검토했다. 코어의 문서 보존, CLI와 데스크톱의 파일 저장, worker 처리, 제출 목표 계산, 테스트, Windows 패키징, 회귀 검증과 벤치마크가 범위다.

기존 검증은 통과하지만 safe 모드에서 본문과 투명도가 바뀌는 결함이 재현됐다. 배치 정리와 일부 저장 경로에서는 사용자 파일을 잃을 수 있다. 새 기능이나 큰 리팩터링보다 **문서 내용 보존과 원본 파일 보존을 먼저 수정**해야 한다. 실행 순서와 완료 기준은 [개선 작업목록](IMPROVEMENT_BACKLOG.md)에 기록했다.

## 현재 구조와 검증 결과

버퍼 기반 코어, CLI의 파일 경계, Electron의 preload 격리와 문서 worker 분리는 유지할 가치가 있다. PNG·JPEG 변환 실패를 건너뛰고, 고급 모드 결과를 검증한 뒤 저장하며, 합성 fixture와 Windows 런처 테스트를 갖춘 점도 좋은 기반이다. 다만 검증기의 검사 범위와 테스트 데이터가 아래 결함을 놓친다.

| 검증 | 결과 |
| --- | --- |
| `npm test` | 62개 파일 통과, 테스트 419개 통과·1개 건너뛰기 |
| `npm run typecheck` | 통과 |
| `npm run build` | 통과 |
| `npm run desktop:smoke:built` | Linux Xvfb에서 통과 |
| `npm run quality:corpus` | 합성 사례 2개 통과 |
| `npm run release:hygiene` | 통과 |

실행 환경은 Node v24.13.0이다. Windows CI가 지정한 Node 20.20.2 및 Windows 배포물 실행 결과를 이번 검증으로 대체할 수 없다. Electron 스모크에서 Linux sharp 바이너리 호환성 경고가 출력됐다. 실제 업무 문서, Windows 설치·서명, 한컴에서의 열기와 시각 비교는 이번 검증에 포함하지 않았다. 의존성의 최신 취약점 조회도 수행하지 않았다.

재현에는 직접 생성한 HWPX와 별도의 임시 디렉터리를 사용했다. 기존 입력 문서와 `.claude/`는 변경하지 않았다. 제품 구현 변경은 없으며, 이 문서와 작업목록만 추가했다.

## 먼저 수정할 결함

### 본문 공백과 숫자 문자열 변경

**P1 · 재현 확인 · OPT 001**

[xmlMinify.ts](../packages/core/src/xmlMinify.ts)의 parser는 기본 텍스트 trimming과 숫자 변환을 사용한다. 실제 결과는 다음과 같다.

```xml
<!-- 입력 -->
<hp:t> A </hp:t><hp:t>00123</hp:t><hp:t> </hp:t>
<!-- 재작성 결과 -->
<hp:t>A</hp:t><hp:t>123</hp:t><hp:t></hp:t>
```

미사용 BinData를 함께 넣어 출력이 충분히 작아지는 합성 문서를 `optimizeHwpxBufferSafe`로 처리했을 때도 변경된 본문이 최종 출력에 남았다. XML이 잘 구성됐는지만 확인하는 현재 검증은 이를 허용한다. [balancedOptimizer.ts](../packages/core/src/balancedOptimizer.ts)의 XML 참조 재작성도 기본 parser 설정을 사용하므로 공통 보존 정책이 필요하다.

본문 문자열을 숫자로 해석하지 않고 앞뒤·공백 전용 텍스트를 보존해야 한다. 압축 대상인 XML 서식 공백과 HWPX 본문 공백을 구분해야 하며, 입력 XML 검증 전에 잘못된 문서를 재작성해 정상화하는 경로도 막아야 한다.

### PNG 투명도 손실과 잘못된 중복 병합

**P1 · 재현 확인 · OPT 002**

[decodedImage.ts](../packages/core/src/decodedImage.ts)의 공유 디코더는 `removeAlpha()` 후 RGB 3채널만 반환한다. [optimizer.ts](../packages/core/src/optimizer.ts), [opportunities.ts](../packages/core/src/opportunities.ts)는 이 RGB를 PNG로 인코딩한다. 128×128, alpha 0.25의 PNG를 safe 모드로 처리한 결과 `hasAlpha: true`가 `false`가 됐다.

[visualSimilarity.ts](../packages/core/src/visualSimilarity.ts)의 정확 픽셀 해시도 같은 RGB만 사용한다. RGB는 같고 alpha만 다른 두 이미지가 same-visual 그룹으로 묶였으며, `actions: ["consolidate-duplicate-images"]`로 실제 병합됐다. [imagePreview.ts](../packages/core/src/imagePreview.ts)의 품질 계산 또한 alpha를 제거하므로 고급 모드 검증을 통과했다.

변환·정확 해시·품질 검증 모두에 투명도 보존이 필요하다. BMP의 alpha mask, TIFF 다중 페이지, PNG 색 프로필과 비트 깊이도 같은 보존 계약 아래 테스트하되, 아직 재현하지 않은 형식을 이미 실패한 것으로 간주하지 않는다.

### 배치 정리가 다른 프로그램의 임시파일 삭제

**P1 · 재현 확인 · OPT 003**

[CLI index.ts](../packages/cli/src/index.ts)의 `sweepStaleTempFiles`는 출력 폴더의 모든 `*.tmp`를 삭제한다. 빈 입력 폴더와 공용 출력 폴더에 `other-program.tmp`를 만든 뒤 `runBatch`를 실행하면 해당 파일이 삭제된다. 정리는 배치 목표 옵션 검증보다 먼저 실행된다.

파일 확장자나 0바이트라는 이유만으로 소유권을 추정하지 않아야 한다. 작업별 임시 디렉터리·소유 기록과 실행 잠금을 사용해 다른 작업의 파일 및 진행 중인 실행의 파일을 보존해야 한다. 현재 `cli.test.ts`는 일반 `.txt` 보존만 확인하고 `leftover.tmp` 삭제를 기대하므로 테스트 계약도 바꿔야 한다.

### CLI 하드링크 보고서가 원본 파일 변경

**P1 · 재현 확인 · OPT 004**

[CLI index.ts](../packages/cli/src/index.ts)의 `pathsReferToSameFile`은 정규 경로와 `realpath`만 비교한다. 하드링크는 다른 경로지만 같은 파일이다.

임시 원본 `hard-input.hwpx`에 연결된 `hard-report.json`을 만들고 `analyze --report hard-report.json --overwrite`를 실행하면 종료 코드 0과 함께 원본이 JSON으로 바뀐다. `report` 명령도 직접 쓰기 경로를 사용한다. 기존 심볼릭링크 방어만으로는 원본 불변 계약을 충족하지 못한다.

실제 파일 식별자를 비교하고, 모든 쓰기 경계에서 원본과 출력·보고서의 충돌을 확인해야 한다. Windows에서 지원되는 파일 동일성 확인도 검증해야 한다.

### 데스크톱 출력이 이전 입력 문서 덮어쓰기

**P1 · 서비스 경계 재현 확인 · OPT 005**

[desktopService.ts](../apps/desktop/src/main/desktopService.ts)의 출력 이름은 `<base>_optimized.hwpx`이며 `preventOverwrite: false`이면 기존 경로를 그대로 사용한다. [main.ts](../apps/desktop/src/main.ts)는 선택한 입력 경로들을 기억하지만 저장 대상과 비교하지 않는다.

`destination/source_optimized.hwpx`를 입력으로 분석·최적화한 뒤, 다른 폴더의 `source.hwpx`를 같은 destination으로 저장하면 이전 입력 파일이 교체된다. 사용자가 여러 입력을 선택하거나 기존 최적화 문서를 다시 사용하는 경우에 가능하다. 이번 재현은 데스크톱 서비스 API에서 확인했으며 GUI 클릭 경로를 별도로 재현한 것은 아니다.

덮어쓰기 허용은 생성한 결과 파일에만 적용하고, 현재 실행의 모든 입력 경로와 같은 파일은 항상 보호해야 한다. CLI의 원본 식별 정책과 일관되게 구현해야 한다.

### 검증기가 본문과 이미지 배치 변경 허용

**P1 · 재현 확인 · OPT 006**

[verifier.ts](../packages/core/src/verifier.ts)는 참조된 리소스의 존재, 이미지 형식·치수, 고급 모드의 이미지 품질을 비교한다. 본문 문자열·레이아웃 속성·각 이미지 사용 위치의 원본 대응은 비교하지 않는다.

다른 색의 이미지 두 개를 포함한 문서에서 이미지 바이트를 그대로 둔 채 본문을 교체하고 `binaryItemIDRef`의 순서를 바꿨다. `verifyHwpxOutput(output, { original, mode: "balanced" })`가 통과했다. 이 재현은 검증 API의 누락을 보여주며, 현재 optimizer가 모든 종류의 본문·배치 변경을 자동으로 발생시킨다는 뜻은 아니다.

허용된 변경 목록을 기준으로 본문과 레이아웃을 비교하고, 리소스 경로·ID 변경 내역으로 각 이미지 사용 위치를 대응시켜야 한다. safe 모드에는 치수·형식 외에 방향·픽셀·투명도의 보존 검증이 필요하다.

## 추가로 확인한 기능 결함

| 작업 | 근거와 영향 | 확인 수준 |
| --- | --- | --- |
| OPT 007 | 존재하지 않는 `binaryItemIDRef`를 graph가 무시해 verifier가 통과시킨다. 일반 스타일 ID와 binary resource ID를 구별해 해결해야 한다. | API 재현 |
| OPT 008 | safe planner가 미참조 `BinData/font.ttf`를 삭제한다. 고급 structural planner는 font·OLE를 제외하지만 safe는 제외하지 않는다. 문서의 폰트·OLE 보존 약속과 불일치한다. | safe 출력 재현 |
| OPT 009 | 충돌 시 `image1-opt.png`로 변환한 뒤 verifier는 동일 stem의 기존 `image1.png`를 후보로 선택한다. 올바른 출력인데 aspect ratio 오류가 발생했다. 기존 충돌 테스트는 변환만 검사한다. | 변환 후 검증 재현 |
| OPT 010 | 데스크톱 non-overwrite는 존재 검사 후 rename이다. 같은 입력을 동시에 서비스 호출하면 두 결과가 같은 출력 경로를 반환했다. 서로 다른 앱 실행 사이에도 배타적 저장이 필요하다. | 동시 서비스 호출 재현 |
| OPT 011 | CLI `--out`과 `--report`가 동일하고 `--overwrite`이면 종료 코드 0이지만 최종 파일은 ZIP뿐이고 JSON 보고서는 남지 않는다. 보고서 승격 후 출력 승격 실패 시 기존 보고서를 지우는 rollback도 있다. | 경로 중복 재현, rollback은 코드 확인 |
| OPT 016 | 폰트와 OFL은 dist에 복사하지만 electron-builder의 명시적 파일 목록에 `.woff2`와 해당 `.txt`가 없다. 소스·로컬 빌드 검사만으로 배포물 포함을 보장하지 못한다. | 패키징 설정 확인, Windows 패키징 재현 필요 |

## 성능과 유지보수 개선

- **OPT 012:** worker 즉시 종료·시간 제한은 파일 저장 중에도 가능하다. 임시파일과 보고서가 일부 남는지, 완료된 출력이 취소로 표시되는지 fault injection으로 확인하고 저장 단계의 취소 계약을 정해야 한다.
- **OPT 013:** quick 분석에서도 structural opportunity 검출이 정확 픽셀 중복 검출을 호출한다. 기본 analysis 옵션과 duplicateMode 선택도 다르며, 분석에서 balanced·aggressive 인코딩을 모두 측정한다. quick/deep 의미를 통일하고 측정 비용을 분리해야 한다.
- **OPT 014:** ZIP 전체 버퍼, 엔트리, raw 디코드 캐시, 인코딩 결과가 함께 유지된다. `resizeJpeg`의 실행을 기다리지 않는 디코드와 worker 수×이미지 동시성 조합을 포함해 최대 메모리를 측정하고 한도를 정해야 한다. ZIP64에서 선언 크기를 미리 확인하지 못하는 경로도 별도 검증 대상이다.
- **OPT 015:** 보고서의 `optimizedSize`는 분석에서는 추정값, 최적화 후에는 실측값이다. ZIP 압축률 상수와 JPEG 품질 추정이 실제 목표 통과를 보장하지 않으므로 계약과 표시를 구분하고 오차를 측정해야 한다.
- **OPT 017:** 두 GitHub workflow는 태그 push 또는 수동 실행에서 동작한다. PR마다 문서 보존·타입·빌드·스모크 검증을 실행하는 게이트가 필요하다.
- **OPT 018:** 많은 renderer 검증이 `repoConfig.test.ts`의 문자열·정규식 검사에 의존한다. 코드 형태를 검사해도 실제 저장·취소·선택 흐름을 보장하지 못한다.
- **OPT 019:** main 1,432줄 중 대규모 스모크 코드가 제품 엔트리에 있고 renderer는 2,792줄이다. worker·IPC·스모크와 단일/배치 상태 전이를 분리하면 테스트 가능한 경계가 늘어난다.
- **OPT 020:** settings 쓰기는 원자적이지 않다. 손상된 JSON은 기본값으로 조용히 돌아가며 customBytes는 유한한 양수인지 확인하지 않는다. 복구와 입력 검증을 강화해야 한다.
- **OPT 021:** 문서의 safe 보존 계약과 구현 차이, audit의 moderate 이상 차단과 문서의 0 production 취약점 표현 차이를 정리해야 한다. 실제 Windows·한컴 QA는 증거와 함께 별도 추적해야 한다.
- **OPT 022:** 벤치마크에서 문서 처리 예외를 통계 0·절감률 null로 바꾸면 실패 문서가 절감률 중앙값에서 제외된다. 성공 일부만으로 GO가 날 가능성을 막고 실패 문서 수와 원인을 보고해야 한다. 이는 코드상 개선 항목이며 외부 인코더를 사용한 전체 재현은 수행하지 않았다.

## 개선 순서

첫 묶음은 OPT 001~006이다. 본문·픽셀·입력 파일 불변 조건을 회귀 테스트로 고정한 뒤, OPT 007~011의 검증·저장 계약을 보완한다. 패키징과 PR 게이트는 이 단계와 함께 개선할 수 있다.

그다음 취소·메모리·quick 분석 비용과 추정 정확도를 측정한다. 큰 모듈 분리는 동작 회귀 테스트가 갖춰진 후 진행한다. 작업 하나마다 근거가 된 재현이 통과하고 필수 게이트가 완료돼야 작업목록에서 완료로 변경한다.
