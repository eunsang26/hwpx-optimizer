# 릴리즈 검증 증거 — 2026-10-15 / 2026-10-16 갱신

이 문서는 OPT-021의 현재 계약과 검증 범위를 연결한다. 앱 버전은 **0.1.9**, 현재 검증 런타임은 **`209053f0b25a07123017099bdcd6f3ebff6c8f3d`**이다. `22546ee`의 최초 기록은 날짜·범위를 붙여 이력으로 보존한다. [현재 한컴·큰 실제 문서 기록](HANCOM_QA_2026-10-16.md)과 [화면 가독성 기록](UI_READABILITY_2026-10-16.md)을 함께 참고한다. 같은 앱 버전이라도 다른 커밋의 테스트를 그대로 승인 근거로 사용할 수 없다. 이 기록은 사전 배포 검증이며 최종 제품 출시·기관 배포 승인이 아니다.

2026-10-19 의존성 갱신: `579d0a8`은 개발·패키징 도구의 lockfile만 바꿨다. 앱 코드와 배포 런타임(sharp 0.35.5, Electron 42.11.13)은 `209053f`와 같고 electron-builder는 26.17.0이 됐다. 이 head(`29eed90`)의 자동 검사와 Windows 실제 패키지 검사를 다시 통과했다(아래 보안 audit 판정). 한컴·큰 실제 문서 수동 확인은 계속 `209053f` 패키지 기준이며 새 패키지에서 반복하지 않았다.

2026-10-15 문서 정합성 확인 이력: XML/문서/이미지/자원 보존 대상 57개와 audit 정책 9개 테스트를 먼저 통과한 뒤, 로컬 전체 90개 파일·730개 통과·1개 skip, typecheck/build·release hygiene·runtime audit를 통과했다. 변경 문서 9개의 상대 링크와 아래 Windows 실행의 정확한 head SHA·success·artifact 0개를 확인했다. 문서 수정으로 새 수동 QA나 새 Windows 런타임 검증을 수행했다고 주장하지 않는다.

## 보존 및 검증 계약

| 구분 | 현재 동작 | 소스·회귀 근거 |
| --- | --- | --- |
| XML | 본문 공백·숫자 문자열·혼합/미지 내용·작성한 설명을 보존한다. 알려진 element-only 컨테이너의 구조적 공백만 제거하며 UTF-8과 XML 정규화 규칙을 적용한다. | `xmlDocument.ts`, `xmlMinify.ts`; `xmlPreservation.test.ts`, `documentVerifier.test.ts` |
| safe 이미지 | resize·손실 재인코딩을 하지 않는다. 바뀐 참조 이미지의 format·크기·decoded pixel/alpha·EXIF orientation을 확인한다. ICC·고정밀·다중 프레임·모호한 BMP alpha 등 보호 표현은 원본 바이트를 유지한다. | `optimizer.ts`, `verifier.ts`; `imagePreservation.test.ts`, `imageDuplicates.test.ts` |
| 리소스/배치 | 폰트·OLE·불투명 package part를 보존한다. 원래 XML 위치별 리소스 사용을 비교하고 허용된 삭제·정확 중복 별칭·변환만 인정한다. 미지 참조는 중복 병합을 막는다. | `resourcePolicy.ts`, `referenceGraph.ts`, `verifier.ts`; `resourcePolicy.test.ts`, `resourceMappings.test.ts` |
| advanced | 지원되는 BMP/TIFF→PNG, resize·JPEG profile을 적용할 수 있다. PSNR/SSIM은 512×512 contain 표본의 밝은/어두운 배경 중 낮은 점수로 검사한다. 생성된 그림 이름/크기 행만 정리하며 작성한 설명은 남긴다. | `opportunities.ts`, `imagePreview.ts`, `verifier.ts`; `balanced.test.ts`, `aggressive.test.ts` |
| 검증 호출 | 최적화는 출력 반환 전 original+mode 비교를 수행한다. 단독 CLI `verify` 및 Desktop 결과 검증은 원본 없는 ZIP/XML/참조 검사다. 어느 쪽도 한컴 렌더링을 수행하지 않는다. | `optimize.ts`, CLI `index.ts`, `desktopService.ts`; `verifier.test.ts`, `documentVerifier.test.ts` |
| 파일/설정 | 입력과 같은 inode의 출력·리포트를 거절한다. 문서/리포트 묶음은 처리된 실패·취소 시 복구하고 정상 종료가 복구를 기다린다. 설정은 whitelist·범위 검사 후 임시파일 sync/rename으로 교체한다. 강제 종료/전원 손실의 다중 파일 원자성 및 프로세스 간 설정 병합은 보장하지 않는다. | [저장·취소 계약](DESKTOP_CANCELLATION_2026-10-15.md), [설정 계약](DESKTOP_SETTINGS_2026-10-15.md) |

safe도 ZIP/XML 바이트 전체가 동일하다는 뜻은 아니다. advanced 품질 점수도 모든 화면·인쇄 결과의 동일성을 입증하지 않는다. 원본과 출력의 최종 열람은 별도 QA다.

## 2026-10-15 실행 증거 이력

아래 CI는 합성 입력만 사용했다. 문서·리포트·화면을 업로드하지 않았으며 두 실행 모두 artifact 0개, 업로드 skipped다. 결과가 존재하는 실제 Windows 패키지 실행과 소스 실행을 구분한다.

| 날짜·커밋 | 환경·대상 | 결과 및 한계 |
| --- | --- | --- |
| 2026-10-15 · `22546ee` | [PR Checks 38693914662](https://github.com/eunsang26/hwpx-optimizer/actions/runs/38693914662), Linux Node 22.12.0 / 24.21.0 | 각각 90개 파일·730개 테스트 통과·1개 skip, typecheck/build, 합성 corpus 2/2, 실제 Electron 소스 실행에서 문서 11개+설정 4개 흐름 통과. |
| 2026-10-15 · `22546ee` | 같은 PR 실행의 Windows CLI / Node 24.21.0 | 전체 테스트·typecheck/build·runtime audit 및 실제 CLI ZIP optimize/verify/batch/런처 통과. 이 job은 Electron을 실행하지 않는다. |
| 2026-10-15 · `22546ee` | [Windows Desktop 38693910368](https://github.com/eunsang26/hwpx-optimizer/actions/runs/38693910368), Windows Server 2025 Datacenter 10.0.26100 x64, runner image `windows-2025-vs2026` / `20260925.250.1`, Node 24.21.0, Electron 42.11.13, sharp 0.35.5 | 전체 테스트·typecheck/build·runtime audit·NSIS 빌드·ASAR/native/locale/font 검사 통과. 소스 실행과 checkout 밖으로 복사한 실제 패키지 실행 각각 문서 11개+설정 4개 완료 marker. 시스템 Pretendard 없는 호스트에서 fresh profile·오프라인 glyph 검사 통과. 기관 Windows 10/11·설치 후 수동 검증은 아니다. |
| 2026-10-15 · `22546ee` | 로컬 Linux / Node 24.13.0, 실제 Electron+Playwright, 격리 profile·합성 입력 | 800/720px 복구·입력 오류·저장 실패 화면, page error 0, 원본 해시 불변, 저장 수락→실제 앱 종료→새 프로세스에서 설정 복원 통과. 짧은 자동 재실행이며 장시간 soak가 아니다. [설정 상세](DESKTOP_SETTINGS_2026-10-15.md). |

현재 실행에서 배포 파일의 공개 다운로드·운영 배포를 만들지 않았다. CI의 manifest/ASAR 검증은 해당 job 내부 산출물에 대한 것이며, 별도 기관 배포 파일의 SHA256 확인을 대체하지 않는다. 향후 배포 시 실제 배포 파일명·SHA256·서명 종류를 그 배포 기록에 고정한다.

## 2026-10-16 현재 실행 증거

런타임 `209053f`의 [PR 검사](https://github.com/eunsang26/hwpx-optimizer/actions/runs/38859308738)와 [Windows 데스크톱 릴리즈 검사](https://github.com/eunsang26/hwpx-optimizer/actions/runs/38859318306)가 모두 통과했다. 94개 파일·792개 테스트 통과·1개 skip, 타입 검사·빌드·audit를 확인했다. Linux Node 22.12.0·24.21.0 각각과 Windows Node 24.21.0의 소스/프로젝트 밖 실제 패키지 각각에서 문서 11개+설정 4개+HCI 9개+가독성 3개 흐름·40개 화면 조건을 통과했다. Windows CLI의 실제 ZIP/native 실행, 데스크톱 NSIS·ASAR/native/로캘·오프라인 번들 글꼴 및 합성 측정도 통과했다. CI는 합성 입력만 사용했으며 artifact 0개·업로드 skipped다.

같은 커밋으로 만든 별도 unpacked 패키지를 **개인 Windows 11 Pro 10.0.26200**에서 실행했다. 이 산출물의 hash는 [한컴 기록](HANCOM_QA_2026-10-16.md#환경과-산출물)에 고정한다. 사용자 지정 사례 A(94,078,344바이트·이미지 28개·17쪽)를 세 모드로 처리했다. Windows 저장·재검증·초기화, 저장된 결과의 original+mode 비교, 한컴 13.0.0.711에서 전체 페이지 렌더링·동일한 UNICODE 텍스트를 확인했다. safe는 17/17쪽 pixel도 일치했다. balanced/aggressive의 허용된 이미지 재압축 차이는 별도로 기록한다. 원본은 불변이고 자료는 로컬에만 남긴다. 사용자는 로컬 보고서의 균형·적극 글자/표/그림 품질을 확인하고 문제가 없다고 응답했다. 실제 취소/재시도와 같은 폴더 세 번 연속 저장도 통과했다. 부분 파일 없이 세 문서/보고서 쌍을 생성했고 원본·기존 출력 해시와 반복 구간 원본 수정 시각이 유지됐으며, 반복 후 새 프로세스의 빈 화면/설정 복원을 확인했다. 이 PC는 기관 PC가 아니며 짧은 재실행·세 번 반복을 장시간 soak로 세지 않는다.

| 모드 | 실제 출력 바이트 | Windows UI 처리 시간 | 40MiB 판정 |
| --- | ---: | ---: | --- |
| safe | 94,078,344 | 20.73초 | 초과/미달 판정 유지 |
| balanced | 51,577,976 | 61.65초 | 초과/미달 판정 유지 |
| aggressive | 46,237,361 | 19.87초 | 초과/미달 판정 유지 |

시간은 파일을 선택/분석한 뒤 실행 클릭부터 완료 표시까지이며 한컴 변환·준비 시간과 구분한다. 실제 PC의 한 사례로 전체 문서/기관 PC 성능을 보장하지 않는다. 내장 글꼴·OLE 선언이 없고 5개 이미지는 24MP 보호 한도를 넘으므로 이 사례의 자원 구성을 다른 범주로 확대 해석하지 않는다.

## 2026-10-15 큰 합성 입력 측정 이력

위 Windows Desktop 실행은 `scripts/bench/measure-resource-limits.mjs`도 실행했다. 입력은 **25,907,497바이트 합성 HWPX**(3072×2560 JPEG 3개·16MiB font part)이며, 앱을 통한 실제 대형 업무 문서 처리 측정은 아니다. 균형 최적화·검증·해시·저장·worker 정리를 포함하되 fixture 생성과 Node 프로세스 시작은 제외한다. 5ms 표본의 관측 RSS로 순간 peak를 놓칠 수 있다.

| worker | 시간(ms) | 관측 peak RSS(MiB) | worker별 peak retained(MiB) | 종료 raw |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 3,690.4 | 272.8 | 59.8 | 0 |
| 2 | 4,273.6 | 482.3 | 59.8 | 각각 0 |
| 4 | 6,787.7 | 818.5 | 59.8 | 각각 0 |

32/128MiB 위조 확장 크기는 64KiB 한도에서 거부됐다. [리소스 한도와 과거 측정](RESOURCE_LIMITS_2026-10-15.md)은 커밋별로 보존한다. 512MiB 입력/2GiB ZIP 해제 상한을 모든 PC에서 처리 가능한 크기로 해석하거나 위 수초 실행을 장시간 재시작 안정성으로 해석하지 않는다.

## 보안 audit 판정

`npm run release:audit`는 production audit와 full audit의 완전한 응답을 요구하고 production 의존성 및 배포되는 Electron의 **moderate 이상** 취약점으로 차단한다. 나머지 빌드 도구도 전체 audit에 표시한다. `22546ee`의 과거 Windows 실행과 `209053f`의 현재 Windows 실행은 각각 runtime moderate 이상 **0**, full audit **20개(high 8·moderate 11·low 1)**였다. 2026-10-19 `29eed90`은 npm 11.19.0의 `npm audit fix`(호환 범위 갱신)로 runtime moderate 이상 **0**, full audit **8개(high 0·moderate 8·low 0)**가 됐다. 남은 8개는 electron-builder 계열이며 major 변경이 필요해 보류했다. [PR 검사](https://github.com/eunsang26/hwpx-optimizer/actions/runs/39202900671)의 Linux/Node 22.12.0·24.21.0과 Windows CLI가 792개 테스트를, Linux 둘은 11+4+9+3개 Electron 흐름·40개 화면 조건을 통과했다. [Windows 데스크톱 릴리즈 검사](https://github.com/eunsang26/hwpx-optimizer/actions/runs/39202900772)는 같은 테스트·audit·NSIS와 소스/실제 패키지 각각의 11+4+9+3개 흐름을 통과했다. 두 실행의 artifact는 0개다. 이는 알려진 취약점의 당시 조회 결과이며 전체 취약점 0·미래 안전성 선언이 아니다. gate 실패·조회 실패를 통과로 기록하지 않는다.

## 실제 문서·한컴·기관 PC 수동 검증

현재 코드의 최종 수동 QA는 **미완료**다. 다음 표의 미실시는 실패 또는 성공을 관측했다는 뜻이 아니다. 기존 [2026-07-26 Windows QA](WINDOWS_QA_CHECKLIST.md#evidence-log--2026-07-26-v015-prerelease)는 당시 commit `a0ec3f0`·WSL2+Windows PowerShell·Node 24.13.0·v0.1.5 self-signed의 실제 문서 AllModes 통과 기록이다. 현재 코드에서 재실행하지 않았고 한컴과 기관 PC soak는 당시에도 미실시였다. 2026-10-15 문서 정합성 작업에서는 비공개 샘플을 읽지 않았다. 2026-10-16에는 사용자가 지정한 한 파일을 로컬에서 읽어 검증했으며 문서·화면·리포트를 외부로 전송하지 않았다.

| 남은 검증 | 현재 버전·환경·결과 | 완료 시 남길 관측 |
| --- | --- | --- |
| 한컴 열기·내용/배치 확인 | `209053f`, 개인 Windows 11/한컴 13.0.0.711, 사례 A 세 모드 모두 열기·17쪽/텍스트 일치, safe 전체 pixel 일치. 별도 unpacked artifact hash 기록. 자동 렌더링 및 현재 사례의 사용자 품질 확인 완료. 다른 버전/인쇄·기관 승인은 별도 | 정확한 commit·artifact SHA256·Windows build·한컴 제품/version, safe/balanced/aggressive 각각 실제 출력 열기, 복구 경고 여부, 페이지/본문 공백·숫자·표·그림·투명도·작성 설명의 비교 결과 |
| 대표 대형 실제 문서 | `209053f` 사례 A 94,078,344바이트/이미지 28개, CPU/RAM·처리 시간·출력·original+mode 검증·재실행/원본 불변 기록. 개인 PC 한 사례이며 내장 글꼴/OLE 실제 사례를 새로 입증하지 않음 | 비식별 사례 ID, 입력 바이트/이미지 수·최대 pixel·폰트/OLE 유무, OS/CPU/RAM·앱 commit/hash, 모드·실행시간·출력 바이트·원본 해시 불변·성공/오류·재시도 결과 |
| 기관 Windows 10/11 장시간·재시작 | CI는 Windows Server, 현재 실제 PC는 사용자가 개인 PC라고 확인함. 짧은 Windows 정상 종료/재실행·설정 복원/앱 문서 경로 비저장은 확인했으나 기관 PC·장시간 지속/반복은 **미실시** | 대상 OS build·RAM·artifact hash, 시작/종료 시각·실제 지속 시간·문서 수·반복 횟수, 처리 중 취소/정상 종료·재실행, UI 응답·오류·설정 복구·앱 경로/이력 비저장 결과 |

수동 검증은 승인된 로컬 문서와 별도 출력으로 수행한다. 원본을 덮어쓰지 않고 입력·출력 해시를 로컬에서 대조한다. OS·한컴의 최근 문서 기록과 앱 소유 설정 정책을 구분한다. 외부에 공유하는 기록에는 실제 파일명·경로·문서 내용·화면을 넣지 않고 비식별 사례 ID와 결과만 남긴다. 장시간 항목은 실제 기간/반복 수를 보고하고 기간을 측정하지 않은 채 통과로 표시하지 않는다. 남은 기관 PC 장시간 관측과 최종 담당자 확인이 채워질 때까지 OPT-021의 해당 완료 기준과 최종 출시 승인은 열어 둔다.
