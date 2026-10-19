# 벤치마크 실패 추적 — 2026-10-15

OPT-022는 개발용 jpegli 벤치마크의 판정과 진단을 수정한다. 제품의 이미지 profile·core 최적화·배포 의존성은 바꾸지 않는다. 실제 업무 문서를 읽거나 외부 metric/encoder를 설치하지 않았으며, 아래 검증은 합성 입력과 제어된 곡선/인코더를 사용한다. **실제 corpus의 capacity GO 증거가 아니다.**

## 문제와 수정

기존 `runBench.ts`는 문서 처리 예외를 JPEG 수 0·절감률 null·wall-clock 0으로 바꿨다. 절감률 중앙값은 null을 제외하므로 좋은 문서만으로 GO가 가능했고 실패 문서의 이름·원인이 사라졌다. 실제 corpus가 있을 때 JPEG 통계는 real만 쓰지만 PNG 합계와 성장량 soft flag의 분모는 fixture도 포함했다.

`measurement.ts`가 문서 처리와 corpus 순회를 맡고 `runBench.ts`는 명령·보고서 파일 쓰기를 맡는다. 예외는 문서별 상태와 단계/이미지/이유/오류로 남기고 다른 문서는 계속한다. `report.ts`는 예상 문서 목록을 기준으로 모든 결과를 기록하고, 빠진 응답도 실패로 처리한다. 완성하지 못한 문서에 0이라는 측정값을 만들지 않는다.

| 사례 | 통계와 판정 |
| --- | --- |
| 선택 범위의 읽기/ZIP/이미지/인코딩/metric/재패키징 실패 | `error`, stats null, 제외 이유와 실패 수를 기록한다. 살아남은 문서의 중앙값이 높아도 **NO-GO**다. |
| 일부 JPEG의 iso-quality 곡선 miss | 문서 `partial`, 이미지별 `curve-miss` 등 이유를 기록한다. 성공한 이미지로 package 비교를 유지하며 모든 JPEG를 제외율 분모에 넣는다. 기존 ≤20% 기준을 유지한다. |
| JPEG 문서의 매칭 이미지가 0개 | `no-data` / `no-valid-jpegs`. 다른 문서 때문에 전체 제외율이 낮아도 **NO-GO**다. |
| JPEG가 없는 문서 | `no-data` / `no-jpeg-images`. 절감률·JPEG wall-clock 중앙값에 넣지 않고 이유를 기록한다. 완료된 PNG control은 선택 범위에 남는다. 전체에 JPEG 측정이 없으면 **NO-GO**다. |
| 합성 전용/manifest 불일치/빈 corpus | **INVALID**다. fixture 측정으로 실제 corpus의 GO를 대신할 수 없다. |
| metric/jpegli 도구 누락, 지정 실행 파일의 spawn 실패 또는 실행 도중 도구 소실 | **INVALID**다. 기존 결과를 남기고 현재 오류와 남은 skipped 문서를 기록한다. corpus 문제와 도구 문제를 `invalidReasons`에 함께 남긴다. |
| 정상 측정의 절감률/제외율 기준 미달 | 기존 **NO-GO**다. 보고서를 썼다면 INVALID/NO-GO도 프로세스 exit 0이라는 기존 계약을 유지한다. |

일반 문서 오류와 도구 누락을 구별하며, corpus/tool invalidity가 판정에서 우선한다. 도구의 비정상 종료나 잘못된 metric 출력은 문서 처리 오류로 기록한다. 도구를 호출하기 전에 발견한 문서 오류는 그 문서의 오류다. 외부 도구가 계산한 실제 RD 성능을 합성 테스트에서 주장하지 않는다.

## 통계 범위와 보고서

real 문서가 있으면 JPEG·PNG·CPU·wall-clock·성장량·Axis B 진단이 모두 real만 사용한다. fixture는 문서 행에 남되 `fixture-diagnostic`으로 통계/판정에서 제외한다. 합성 전용 실행은 fixture 통계를 표시하되 INVALID다. `corpus.documentCount`와 `statistics.documentCount`는 선택 범위의 실패/skip/no-data까지 포함하며, 중앙값에 들어간 문서 수는 `medianDocumentCount`로 별도 표시한다.

각 `documents` 행은 source·relativePath·status·reason·issues·stats·inDecisionScope·includedInStatistics·medianExclusionReason를 제공한다. `jpegli.jpegTotal/jpegExcluded/jpegExclusionRatio`는 완료한 선택 범위 문서의 실제 측정 수다. 실패 문서의 미측정 JPEG 수를 0개로 가정하거나 제외율로 숨기지 않고 실패 문서 수 자체로 GO를 막는다. JPEG가 없는 문서의 가짜 wall-clock 0도 중앙값에서 제거했다.

보고서는 로컬 상대 파일명·이미지명과 오류 문자열을 담는다. 오류에는 로컬 절대 경로가 포함될 수도 있다. `scripts/bench/out/`과 실제 corpus는 계속 로컬에만 둔다. 이번 작업의 명령 테스트는 소스/합성 fixture를 `.tmp/bench-execution-*`에 복사해 실행하므로 기존 사용자의 `out/rd-report.json`을 덮어쓰지 않는다.

## 검증 범위

- `measurement.test.ts`: 합성 문서로 만든 manifest가 실제로 일치하는 test directory에서 ZIP 읽기·Sharp 디코딩/인코딩·재패키징을 실행한다. RD 곡선과 jpegli 후보는 제어된 대체 구현이다. 성공 문서의 package 절감률 >15%와 다른 문서의 실제 ZIP 오류를 함께 만들어 NO-GO, 원본 SHA256 불변, 결과 행의 보존을 확인한다.
- 같은 파일에서 5개 JPEG 중 1개 miss의 partial, JPEG 없음/전체 miss, 입력 누락, 실제 이미지 decode 실패, 주입된 repack 실패, preflight 도구 누락과 중간 소실을 확인한다.
- `report.test.ts`: real/fixture 이름 충돌을 포함한 모든 통계의 동일 범위, fixture 실패의 진단 격리, 20% 경계, 전체 제외율이 20% 미만이어도 완전히 미측정인 JPEG 문서의 차단, 누락/skip/non-finite 결과의 차단을 확인한다.
- `execution.test.ts`: 격리된 실제 `runBench.ts` 자식 프로세스가 NO-GO 및 missing executable INVALID 보고서를 쓰고 exit 0으로 끝나는지 확인한다. NO-GO의 외부 도구 경로는 제어된 stand-in이고 입력은 JPEG가 없어 호출하지 않는다. 이 검사는 실제 외부 encoder/metric의 품질을 검증하지 않는다.
- `toolAvailability.test.ts`: 실제 spawn ENOENT를 typed metric/jpegli 오류로 구분한다. `corpus.test.ts`는 빈 matching manifest의 INVALID를 추가로 확인한다.
- `npm run typecheck`에 bench source/test의 noEmit 검사를 추가했다. 벤치마크 모듈을 runtime 배포 산출물에 넣지 않는다.

실제 비공개 corpus·실제 jpegli/SSIMULACRA2를 사용한 capacity 판정은 별도 승인된 로컬 실행이 필요하다. green CI는 그 판정을 대체하지 않는다. 자세한 JSON 계약과 사용법은 [bench README](../scripts/bench/README.md#failure-and-statistics-policy)를 따른다.

로컬 Linux / Node 24.13.0: bench 11개 파일·45개 통과·1개 skip, 저장소 설정 회귀까지 포함한 대상 12개 파일·52개 통과·1개 skip, 전체 93개 파일·751개 통과·1개 skip. `npm run typecheck`(bench 포함)·`npm run build`·release hygiene·runtime audit 통과. runtime moderate 이상 0이며 full audit의 개발/빌드 도구 20개(high 8·moderate 11·low 1)는 잔존한다. skip은 기존 외부 jpegli 미설치 후보 테스트다. CI의 플랫폼별 실행은 [PR #9 검사](https://github.com/eunsang26/hwpx-optimizer/pull/9/checks)에서 해당 head와 결과를 확인한다.
