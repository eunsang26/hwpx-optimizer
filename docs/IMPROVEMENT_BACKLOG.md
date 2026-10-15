# HWPX Optimizer 개선 작업목록

[2026년 10월 14일 전체 리뷰](CODEBASE_REVIEW_2026-10-14.md)에 따른 추적 목록이다. 기준 커밋은 `315b61b`이다. 사용자가 전체 구현과 UI/UX·HCI 개선을 승인했다. `codex/comprehensive-improvements`에서 한 항목씩 구현·검증하며 진행한다.

P1은 문서 내용·원본·다른 사용자 파일 손실 또는 그 검증 누락으로 먼저 수정한다. P2는 기능 신뢰성·검증·배포 개선, P3는 유지보수와 문서 개선이다. 크기 S/M/L은 상대 범위이며 일정 약속이 아니다. 담당과 PR은 작업 시작 시 정한다.

## 추적표

| ID | 우선순위 | 작업 | 영역 | 크기 | 선행 | 상태 | 담당 및 PR |
| --- | --- | --- | --- | --- | --- | --- | --- |
| OPT-001 | P1 | XML 본문 공백과 숫자 문자열 보존 | core | M | 없음 | 완료 | Codex · [PR #9](https://github.com/eunsang26/hwpx-optimizer/pull/9) |
| OPT-002 | P1 | 투명도 보존과 정확 이미지 중복 판정 | core | L | 없음 | 완료 | Codex · [PR #9](https://github.com/eunsang26/hwpx-optimizer/pull/9) |
| OPT-003 | P1 | 배치 임시파일 정리의 소유권 보장 | CLI | M | 없음 | 완료 | Codex · [PR #9](https://github.com/eunsang26/hwpx-optimizer/pull/9) |
| OPT-004 | P1 | CLI 하드링크 원본 보호 | CLI | M | 없음 | 완료 | Codex · [PR #9](https://github.com/eunsang26/hwpx-optimizer/pull/9) |
| OPT-005 | P1 | 데스크톱 모든 입력 파일 보호 | desktop | M | OPT-004 정책 | 완료 | Codex · [PR #9](https://github.com/eunsang26/hwpx-optimizer/pull/9) |
| OPT-006 | P1 | 본문과 이미지 배치 보존 검증 | core | L | OPT-001, OPT-002 | 완료 | Codex · [PR #9](https://github.com/eunsang26/hwpx-optimizer/pull/9) |
| OPT-007 | P2 | 미해결 binary 리소스 ID 검출 | core | M | 없음 | 완료 | Codex · [PR #9](https://github.com/eunsang26/hwpx-optimizer/pull/9) |
| OPT-008 | P2 | safe 폰트와 OLE 삭제 금지 | core | S | 없음 | 완료 | Codex · [PR #9](https://github.com/eunsang26/hwpx-optimizer/pull/9) |
| OPT-009 | P2 | 변환 경로 변경을 verifier에 전달 | core | M | OPT-006 대응 정책 | 완료 | Codex · [PR #9](https://github.com/eunsang26/hwpx-optimizer/pull/9) |
| OPT-010 | P2 | non-overwrite 저장의 원자적 경로 확보 | CLI, desktop | M | OPT-003, OPT-005 | 완료 | Codex · [PR #9](https://github.com/eunsang26/hwpx-optimizer/pull/9) |
| OPT-011 | P2 | 출력과 보고서 저장 실패 계약 통일 | CLI, desktop | M | OPT-004, OPT-010 | 완료 | Codex · [PR #9](https://github.com/eunsang26/hwpx-optimizer/pull/9) |
| OPT-012 | P2 | 취소와 시간 제한 중 저장 복구 | desktop | M | OPT-011 | 완료 | Codex · [PR #9](https://github.com/eunsang26/hwpx-optimizer/pull/9) |
| OPT-013 | P2 | quick 분석 비용과 옵션 일관성 | core, desktop | M | OPT-002 | 완료 | Codex · [PR #9](https://github.com/eunsang26/hwpx-optimizer/pull/9) |
| OPT-014 | P2 | 디코드 메모리와 worker 동시성 한도 | core, CLI | L | OPT-002 | 대기 | 미정 |
| OPT-015 | P2 | 추정과 실측 크기 계약 구분 | core, desktop | M | 없음 | 대기 | 미정 |
| OPT-016 | P2 | Windows 패키지 폰트와 라이선스 포함 | packaging | S | 없음 | 대기 | 미정 |
| OPT-017 | P2 | PR 검증 workflow 추가 | CI | M | 없음 | 대기 | 미정 |
| OPT-018 | P2 | 저장과 취소 동작 기반 통합 테스트 | desktop, tests | M | OPT-010, OPT-012 | 대기 | 미정 |
| OPT-019 | P3 | main과 renderer 책임 분리 | desktop | L | OPT-018 | 대기 | 미정 |
| OPT-020 | P3 | 설정 원자적 저장과 값 검증 | desktop | S | 없음 | 대기 | 미정 |
| OPT-021 | P3 | 보존 계약과 릴리즈 증거 문서 정합성 | docs, release | M | OPT-001~008 | 대기 | 미정 |
| OPT-022 | P3 | 벤치마크 실패 문서 추적과 판정 | bench | M | 없음 | 대기 | 미정 |
| OPT-023 | P2 | 실제 화면과 흐름 기반 UX 개선 | desktop, UX | M | 화면 캡처 감사 | 진행 | Codex · [PR #9](https://github.com/eunsang26/hwpx-optimizer/pull/9) |
| OPT-024 | P2 | 키보드와 상태 전달 및 오류 복구 HCI 개선 | desktop, HCI | M | OPT-023 감사 | 대기 | Codex |
| OPT-025 | P3 | 화면 계층과 작은 창 및 확대 가독성 개선 | desktop, UI | M | OPT-023 감사 | 대기 | Codex |
| OPT-026 | P1 | sharp·Electron 런타임 보안 패치와 배포 검증 | core, packaging | M | 없음 | 완료 | Codex · [PR #9](https://github.com/eunsang26/hwpx-optimizer/pull/9) |

## 작업별 완료 기준

### OPT 001 XML 텍스트 보존

대상: `xmlMinify.ts`, `balancedOptimizer.ts` 및 XML parser 공통 정책.

- [x] 문자열 parsing과 공백 보존 설정을 모든 재작성 경로에 적용한다.
- [x] ` A `, 공백만 있는 본문, `00123`, 소수·지수 형태 문자열, entity, mixed content를 보존한다.
- [x] safe·balanced·aggressive 최종 출력의 본문 동일성을 확인한다. XML 서식 공백 제거는 본문과 구분한다.
- [x] 잘못된 입력 XML을 재작성으로 정상화해 성공 처리하지 않는다.

검증 기록: 2026-10-14 Linux/Node 24.13.0. `xmlPreservation.test.ts` 17개 통과, 관련 6개 파일의 초기 대상 테스트 110개 통과. 최종 `npm test` 63개 파일·436개 테스트 통과·1개 건너뛰기, `npm run typecheck`, `npm run build` 통과. 공통 parser/builder가 텍스트·CDATA·주석을 보존하며 알려진 구조 컨테이너의 서식 공백만 줄인다. 원본 ZIP을 읽을 때 XML well-formedness를 검사한다.

### OPT 002 투명도와 이미지 동일성

대상: `decodedImage.ts`, `optimizer.ts`, `opportunities.ts`, `visualSimilarity.ts`, `imagePreview.ts`.

- [x] RGBA 등 필요한 채널을 디코드·변환·캐시에 보존한다.
- [x] RGB가 같고 alpha가 다른 이미지가 정확 중복으로 병합되지 않는다.
- [x] safe PNG의 alpha와 픽셀이 같으며 고급 모드 검증이 투명도 변경을 검출한다.
- [x] 색 프로필·16비트 PNG·alpha mask BMP·다중 페이지 TIFF의 보존/건너뛰기 정책을 정하고 fixture로 확인한다.

검증 기록: 2026-10-14 Linux/Node 24.13.0. 새 `imagePreservation.test.ts` 15개, 기존 관련 8개 파일 89개 테스트 통과. 전체 `npm test` 64개 파일·451개 테스트 통과·1개 건너뛰기, 타입 검사·빌드·Electron 스모크 통과. safe는 변경된 참조 이미지의 정확 픽셀/alpha 해시도 검사한다. 고급 품질 검증은 밝은 배경과 어두운 배경 합성 중 낮은 PSNR/SSIM을 사용한다. 색 프로필·고비트·다중 프레임·alpha BMP 및 방향 메타데이터 PNG는 이미지 원본 바이트를 유지하고 이유를 보고한다.

### OPT 003 배치 정리 소유권

대상: CLI `sweepStaleTempFiles`, 임시 경로 생성, path claim 정리.

- [x] 다른 프로그램의 `.tmp`와 도구 출력처럼 이름 붙인 사용자 파일을 삭제하지 않는다.
- [x] 작업별 소유 기록과 실행 잠금으로 종료된 실행의 잔여물만 정리한다.
- [x] 입력·출력 같은 폴더, 공용 출력 폴더, 동시 배치 실행을 검증한다.
- [x] 잘못된 옵션을 검증하기 전에 사용자 폴더를 변경하지 않는다.

검증 기록: 2026-10-14 Linux/Node 24.13.0. CLI 관련 4개 대상 파일 66개 테스트 및 workspace의 최종 13개 테스트 통과. 전체 65개 파일·464개 테스트 통과·1개 건너뛰기, 타입 검사·빌드 통과. `.tmp`와 이름뿐인 0바이트 결과는 보존한다. 출력 폴더별 전용 잠금/작업 공간에 owner 기록과 예약 파일의 dev·inode·생성/변경 시각을 저장해 종료된 작업만 복구한다. 같은 폴더의 동시 실행·동시 복구·상대 경로·사용자 대체 파일을 검사했다. 소유 기록이 없거나 손상된 잠금은 자동 삭제하지 않고 확인이 필요한 오류를 반환한다.

### OPT 004 CLI 원본 동일성

대상: CLI `pathsReferToSameFile`, analyze/report/optimize/batch 저장 경계.

- [x] 경로·심볼릭링크·하드링크의 동일성을 검사해 원본을 보호한다.
- [x] `analyze --report <원본 하드링크> --overwrite`와 `report`가 쓰기 전에 거부된다.
- [x] Linux와 Windows에서 지원되는 동일성 확인 및 원본 해시 불변 테스트가 통과한다.

검증 기록: 2026-10-14 Linux/Node 24.13.0 및 [Windows/Node 20.20.2 실행](https://github.com/eunsang26/hwpx-optimizer/actions/runs/38521737761). 대상 3개 파일·72개 테스트 및 두 OS의 전체 66개 파일·474개 테스트 통과·1개 건너뛰기, 타입 검사·빌드 통과. 경로 정규화와 realpath에 파일 dev/inode 비교를 추가했다. 단독 보고서는 non-overwrite에서 배타적으로 생성하고 overwrite에서 임시파일을 승격해 링크 대상 inode를 직접 잘라 쓰지 않는다. analyze/report/optimize/batch의 하드링크 및 기존 심볼릭링크를 확인했다. Windows 릴리즈 실행 전체는 별도 sharp 의존성 audit에서 실패했으며 OPT-026으로 추적한다.

### OPT 005 데스크톱 입력 보호

대상: `main.ts` 입력 등록, `desktopService.ts` 출력 저장.

- [x] 생성 결과와 현재 실행에서 선택한 모든 입력의 파일 동일성을 비교한다.
- [x] `preventOverwrite: false`에서도 입력 원본은 보호한다.
- [x] 다른 폴더의 같은 이름, 이미 최적화된 입력, 기존 output 하위 폴더의 입력을 검증한다.

검증 기록: 2026-10-14 Linux/Node 24.13.0. 데스크톱 대상 3개 파일·37개 테스트, 전체 67개 파일·481개 테스트 통과·1개 건너뛰기. 타입 검사·빌드·Electron 스모크 통과. main이 선택 입력의 정규 경로와 dev/inode/생성 시각을 보유하고 worker에 신뢰된 목록을 전달한다. 서비스는 이전 분석 입력도 기억하며 문서와 보고서 저장 전에 경로/파일 동일성을 검사한다. worker 재생성과 미선택 생성 결과 덮어쓰기 허용을 별도로 확인했다. 입력 캐시는 inode·생성/변경 시각이 달라지면 재사용하지 않는다.

### OPT 006 문서 보존 verifier

대상: `verifier.ts`, manifest·reference graph 및 변환 변경 내역.

- [x] 허용 변경을 명시하고 본문·레이아웃 속성 변경을 거부한다.
- [x] 같은 이미지 파일들이 남아 있어도 사용 위치의 ID가 뒤바뀌면 거부한다.
- [x] safe에서 이미지 방향·픽셀·투명도 변경을 거부한다.
- [x] 정상 XML 서식 정리·중복 통합·허용 변환은 통과한다.

검증 기록: 2026-10-14 Linux/Node 24.13.0. 문서 검증 회귀 18개 및 XML 보존 회귀 19개, 관련 4개 파일·84개 대상 테스트 통과. 최종 전체 71개 파일·526개 테스트 통과·1개 건너뛰기, 타입 검사·빌드·합성 corpus 2/2·Electron 스모크 통과. XML 본문/레이아웃/사용 위치 및 비이미지 package part를 비교하고 정확 중복/지원 변환/자동 생성 설명 줄 정리만 허용한다. 스타일 ID 충돌은 통합을 건너뛰며 작성한 대체 설명을 보존한다. safe 방향 변경은 거부하고 고급 모드의 충실한 EXIF 회전 반영은 허용한다. UTF-8/XML 문자 공백 처리도 보완하고 Python 표준 XML parser로 독립 비교했다. 변환 이름 충돌의 명시적 전달·preview 연결은 OPT-009에서 이어간다.

### OPT 007 미해결 binary ID

대상: `referenceGraph.ts`, `manifest.ts`, `verifier.ts`.

- [x] 미등록 `binaryItemIDRef`와 존재하지 않는 manifest 리소스를 경고·검증 실패로 전달한다.
- [x] 이미지 ID와 문서 내부 스타일·문단 ID를 구분해 정상 문서를 잘못 거부하지 않는다.
- [x] 직접 경로·상대 경로·percent encoding 기존 사례가 유지된다.

검증 기록: 2026-10-14 Linux/Node 24.13.0. 리소스 참조 회귀 11개를 포함한 대상 4개 파일·41개 테스트, 전체 70개 파일·506개 테스트 통과·1개 건너뛰기, 타입 검사·빌드 통과. manifest 파일 누락과 중복 ID 및 명시적 binary ID 미등록을 보고서 경고와 verifier 오류로 전달한다. 일반 문단/스타일 Ref는 미등록 binary ID로 간주하지 않는다. XML 숫자 문자 참조·상대 경로·percent 인코딩·문자 그대로의 entity 파일명 및 정상 삭제의 manifest 정리를 확인했다.

### OPT 008 safe 리소스 삭제 정책

대상: `planner.ts`, `structuralOpportunities.ts`.

- [x] safe에서도 font·OLE를 항상 보존한다.
- [x] `BinData/font.ttf`, `BinData/object.ole` 미참조 fixture에서 삭제가 적용되지 않는다.
- [x] 삭제 정책을 공유하고 safe와 고급 모드의 차이를 명시한다.

검증 기록: 2026-10-14 Linux/Node 24.13.0. 새 정책 테스트 5개를 포함한 대상 3개 파일·16개 테스트, 전체 69개 파일·495개 테스트 통과·1개 건너뛰기. 타입 검사·빌드 통과. safe·balanced·aggressive 모두 미참조 글꼴/OLE 바이트를 보존한다. 공유 삭제 정책을 계획과 실행 양쪽에 적용해 외부에서 전달된 삭제 plan도 보호한다. 일반 미사용 BinData 정리는 유지한다.

### OPT 009 변환 경로 대응

대상: `balancedOptimizer.ts`, `verifier.ts`, `imagePreview.ts`.

- [x] `originalPath → outputPath` 및 ID 변경 정보를 명시적으로 전달한다.
- [x] BMP와 다른 내용의 동일 stem PNG가 공존할 때 `-opt.png` 결과가 최종 verifier와 preview를 통과한다.
- [x] TIFF 변환·다중 충돌·통합 후 변환도 전체 최적화 API로 확인한다.

검증 기록: 2026-10-14 Linux/Node 24.13.0. 대상 4개 파일·45개 테스트, 최종 전체 72개 파일·531개 테스트 통과·1개 건너뛰기. 타입 검사·빌드·합성 corpus 2/2·Electron 스모크 통과. 변환과 중복 통합의 실제 outputPath 및 original/output ID를 보고서에 기록하고 verifier·renderer IPC·preview로 전달한다. BMP 동일 stem PNG와 -opt/-opt2 충돌, TIFF, 통합 후 충돌 변환, 잘못된 mapping 및 비표시 변환의 desktop preview를 확인했다. 이전 보고서는 stable ID/XML 사용 위치로 대응을 복구하며 확장자 추측을 사용하지 않는다. 원본을 반환한 rollback에서는 폐기된 변환 mapping을 기록하지 않는다.

### OPT 010 배타적 저장

대상: `desktopService.ts`, CLI pathClaims·단일 분석 보고서·배치 보고서 저장.

- [x] 존재 확인 후 rename 대신 배타적 예약/승격으로 사용자 파일 덮어쓰기를 막는다.
- [x] 서로 다른 프로세스가 같은 폴더에 쓰면 고유한 결과 또는 명확한 충돌 오류가 나온다.
- [x] 문서와 보고서 이름을 함께 확보하고 예약 실패 시 자기 파일만 정리한다.

검증 기록: 2026-10-15 Linux/Node 24.13.0. 동시 저장·사용자 대체 파일·배치 복구 대상 4개 파일·30개 테스트 및 전체 76개 파일·551개 테스트 통과·1개 건너뛰기. 타입 검사·빌드·합성 corpus 2/2·배포 runtime audit·Electron 스모크 통과. 실제 ASAR fixture로 core/io runtime 누락 거부 3개 테스트를 추가하고 배포 검사에 필수 모듈 존재 조건을 넣었다. `packages/io`를 CLI/desktop이 공유하며 빈 디렉터리 예약과 배타적 hardlink 승격을 사용한다. hardlink 미지원 시 `O_EXCL` 스트리밍 복사를 사용하므로 이름은 보호하지만 바이트 전체의 원자적 공개를 보장하지 않는다. 다른 파일이 생기거나 예약이 바뀌면 보존하고 실패한다. 구형 0바이트 배치 예약 복구도 유지한다. 덮어쓰기 rollback과 강제 종료 복구는 OPT-011/012에서 이어간다.

Windows 검증: Node 24.21.0. 구현 커밋 `391eed6`의 [CLI ZIP/native 실행 스모크](https://github.com/eunsang26/hwpx-optimizer/actions/runs/38656830941)가 548개 테스트·타입 검사·빌드·audit와 함께 통과했다. ASAR 검사 보완 커밋 `0c9ca1b`의 [데스크톱 릴리즈 빌드](https://github.com/eunsang26/hwpx-optimizer/actions/runs/38657036685)는 551개 테스트·타입 검사·빌드·합성 corpus·audit·Electron 스모크·실제 ASAR의 core/io 필수 파일 검사·unpacked native 검사를 통과했다. 두 실행 모두 1개 테스트를 건너뛰었고 합성 문서만 사용했으며 산출물 업로드를 비활성화했다.

### OPT 011 문서와 보고서 저장 계약

대상: CLI 및 데스크톱 `writeOptimizationArtifacts`, `commitBatchJob`.

- [x] 출력과 보고서의 동일 경로·별칭을 쓰기 전에 거부한다.
- [x] 보고서 승격·출력 승격 각각의 실패에 기존 결과·보고서가 유실되지 않는다.
- [x] 보고서 저장 실패라도 검증된 문서를 보존할지 rollback할지 정책을 통일하고 결과 상태에 반영한다.
- [x] 쓰기·rename 실패를 주입하고 결과·보고서·임시파일 상태를 확인한다.

검증 기록: 2026-10-15 Linux/Node 24.13.0. 공통 저장 트랜잭션 18개 및 CLI·batch·desktop 경계 17개 회귀 테스트를 추가했다. 원본·배타적 저장을 포함한 대상 6개 파일·59개 테스트와 최종 전체 78개 파일·586개 테스트 통과·1개 건너뛰기. 타입 검사·빌드·합성 corpus 2/2·Electron 스모크 통과. 모든 경계가 문서/보고서 묶음 rollback을 사용하며 overwrite에서도 이전 파일을 보관했다가 복원한다. 동일 경로, hardlink, symbolic link와 부모 디렉터리 별칭을 쓰기 전에 거부한다. 쓰기·backup rename·각 결과 승격 실패와 사용자 대체 파일로 인한 복원 실패를 주입했다. 복원을 막는 사용자 파일은 보존하고 오류에 남겨 둔 복구 디렉터리를 알린다. 성공 후 정리 경고는 성공을 실패로 바꾸지 않는다. 강제 종료는 OPT-012 범위다.

Windows 검증: 커밋 `fc4f29a`, Node 24.21.0. [CLI ZIP/native 실행 스모크](https://github.com/eunsang26/hwpx-optimizer/actions/runs/38658307060)와 [데스크톱 릴리즈 빌드·Electron 스모크·ASAR/native 검사](https://github.com/eunsang26/hwpx-optimizer/actions/runs/38658310332)가 모두 통과했다. 두 실행 모두 78개 파일·586개 테스트 통과·1개 건너뛰기, 타입 검사·빌드·배포 audit 통과. 합성 입력만 사용하고 산출물 업로드는 비활성화했다.

### OPT 012 취소와 저장 복구

대상: `main.ts` cancel/watchdog, `documentWorker.ts`, artifact 저장 경계.

- [x] read·transform·verify·write·rename 단계의 취소와 worker 종료를 검증한다.
- [x] 저장 commit 이후 취소는 완료 결과를 유실하거나 취소로 오표시하지 않는다.
- [x] 중단된 저장을 복구·정리하고 다음 작업이 정상 실행된다.
- [x] 시간 제한 정책을 측정된 대용량 처리 시간에 맞추고 실패 원인을 구분한다.

Linux 검증: 2026-10-15 Node 24.13.0. 실제 worker 10개·작업 수명주기 8개·저장 취소 10개 테스트를 추가했다. 전체 81개 파일·614개 테스트 통과·1개 건너뛰기, 타입 검사·빌드·Electron 스모크 통과. 실제 Electron/로컬 Playwright로 저장 전 취소→재시도, commit 직후 취소→완료 결과 유지, 처음으로 복귀→저장 파일 유지, 저장 중 정상 앱 종료→이전 파일 복원을 확인했다. worker는 계산한 바이트만 전달하고 main이 저장과 rollback을 소유한다. 취소 응답과 다음 작업은 복구가 끝난 뒤 허용한다. 38.5MB 합성 입력에서 계산·전달·저장 3.61초, 최대 진행 응답 간격 2.60초를 측정했다. 제한은 총 실행 시간이 아닌 진행 응답 없는 5분이며 단계와 사용자 취소·시간 초과·예기치 않은 종료를 구분한다. Windows 검증도 통과했다. [상세 근거와 한계](DESKTOP_CANCELLATION_2026-10-15.md). 주 프로세스 강제 종료나 전원 장애의 자동 재시작 복구는 보장하지 않는다.

Windows 검증: 커밋 `00bdf5c`, Node 24.21.0. [CLI ZIP/native 실행](https://github.com/eunsang26/hwpx-optimizer/actions/runs/38662097570)과 [데스크톱 릴리즈·합성 측정](https://github.com/eunsang26/hwpx-optimizer/actions/runs/38662097421)이 모두 통과했다. 두 실행 모두 81개 파일·614개 테스트 통과·1개 건너뛰기, 타입 검사·빌드·배포 audit 통과. 데스크톱은 합성 corpus 2/2·Electron 스모크·실제 ASAR runtime 및 unpacked native 검사도 통과했다. Windows 합성 38.5MB 입력에서 계산·전달·저장 3.51초, 최대 진행 응답 간격 2.39초였다. 합성 입력만 사용했고 산출물 업로드는 모두 비활성화했다.

### OPT 013 quick 분석

대상: `optimize.ts`, `structuralOpportunities.ts`, Desktop 분석 요청.

- [x] 기본값과 명시적 `quick`의 동작이 같으며 quick에서 불필요한 정확 픽셀·유사 이미지 검사를 생략한다.
- [x] 상세 중복 검사와 정확 인코딩 측정을 필요에 따라 실행한다.
- [x] 이미지 수별 quick/deep 시간·인코딩·디코드 횟수를 기록한다.
- [x] 예측 정보가 줄어드는 경우 UI에 추정 근거를 반영한다.

Linux 검증: 2026-10-15 Node 24.13.0. core 기본값과 명시적 quick이 시간 필드를 제외하고 동일하며 혼합 JPEG·PNG·TIFF·BMP에서 Sharp raw/인코딩 출력을 실행하지 않는다. Desktop 자동 single/batch는 quick, 단일 파일 상세 분석과 CLI deep은 픽셀·유사 이미지 검사 및 후보 인코딩을 수행한다. 보고서·화면·CLI가 추정 근거와 미검사를 표시한다. 24개 합성 이미지에서 quick 219.6ms·deep 2,209.3ms, raw/인코딩 출력은 quick 각 0회·deep 각 48회였다. 실제 Electron/Playwright로 키보드 상세 검사, 옵션·포커스 유지, 취소/오류 뒤 계획 유지, 재시도·최적화·처음으로 및 작은 창을 확인했다. 전체 83개 파일·620개 테스트 통과·1개 건너뛰기, 타입 검사·빌드·합성 corpus 2/2·배포 audit·Electron 스모크 통과. Windows 검증도 통과했다. [분석 계약·측정·한계](QUICK_ANALYSIS_2026-10-15.md).

Windows 검증: 커밋 `831bdba`, Node 24.21.0. [CLI ZIP/native 실행](https://github.com/eunsang26/hwpx-optimizer/actions/runs/38663816515)과 [데스크톱 릴리즈·합성 측정](https://github.com/eunsang26/hwpx-optimizer/actions/runs/38663816648)이 통과했다. 두 실행 모두 83개 파일·620개 테스트 통과·1개 건너뛰기, 타입 검사·빌드·배포 audit 통과. 데스크톱은 합성 corpus 2/2·Electron 스모크·NSIS·실제 ASAR runtime 및 unpacked native 검사도 통과했다. 24개 이미지의 quick 231.5ms·deep 2,678.9ms, raw/인코딩 출력은 quick 각 0회·deep 각 48회였다. 합성 입력만 사용하고 산출물 업로드는 모두 비활성화했다.

### OPT 014 메모리와 동시성

대상: `decodedImage.ts`, `reader.ts`, `opportunities.ts`, CLI workerPool.

- [ ] 파일 크기·이미지 픽셀·worker 수별 peak RSS와 raw cache 잔존량을 측정한다.
- [ ] 사용하지 않는 fire-and-forget JPEG 디코드를 제거하거나 비용 효과를 입증한다.
- [ ] worker 수와 이미지 동시성의 곱을 제어하고 지원 한도를 정의한다.
- [ ] ZIP64·위조 선언 크기·큰 디코드에서 제한이 실제 할당 전에 작동하는지 확인한다.
- [ ] 모든 문서 처리는 로컬에서 수행한다.

### OPT 015 추정과 실측

대상: `types.ts`, `report.ts`, `projectPackageSize.ts`, `submissionPlan.ts`, `targetPlan.ts`.

- [ ] estimated size와 actual size를 타입 및 보고서에서 구분한다.
- [ ] 최적화 전은 예상 제출 가능, 최적화 후는 실제 결과에 따른 판정을 표시한다.
- [ ] 사진·차트·BMP·JPEG·PNG·중복 혼합 corpus에서 목표 경계와 예측 오차를 기록한다.
- [ ] CLI·desktop 목표 배분의 공통 계약을 정의하고 엄격한 `< targetBytes`를 유지한다.

### OPT 016 폰트 패키징

대상: `package.json` electron-builder files, `copy-assets.mjs`, 배포물 검사.

- [ ] `PretendardVariable.woff2`와 `OFL.txt`를 명시적으로 포함한다.
- [ ] 실제 Windows `app.asar` 또는 배포 디렉터리에서 파일 존재를 확인한다.
- [ ] 외부 네트워크 없이 깨끗한 PC에서 폰트 로딩을 확인한다.

### OPT 017 PR 게이트

대상: `.github/workflows`.

- [ ] `pull_request`에서 테스트·타입 검사·빌드·합성 corpus·Linux 스모크를 실행한다.
- [ ] 정기 또는 릴리즈 Windows 테스트에서 native sharp와 포터블 실행을 검증한다.
- [ ] 실제 업무 샘플과 결과물을 CI에 업로드하지 않는다.
- [ ] Node 지원 버전과 Windows 런타임 검증을 명시한다.

### OPT 018 동작 통합 테스트

대상: `repoConfig.test.ts`, renderer·IPC·worker 테스트.

- [ ] 문자열 검사에 의존한 상태·취소·저장 검증을 실제 실행 기반 테스트로 옮긴다.
- [ ] 선택·추가·삭제·취소·재시도·일괄 완료·보고서 저장 실패 흐름을 검증한다.
- [ ] 파일 보존 결함은 최종 출력/원본 해시와 내용으로 검사한다.
- [ ] 정적 설정 검사는 필요한 범위에 유지하고 코드 형태에 묶인 검사를 줄인다.

### OPT 019 책임 분리

대상: `main.ts`, `renderer.ts`, shared helpers.

- [ ] main의 스모크 실행 코드를 테스트 전용 모듈로 옮긴다.
- [ ] worker 요청 수명주기와 IPC 파일 권한 경계를 분리한다.
- [ ] renderer의 단일·배치 상태 전이와 DOM 표시를 분리한다.
- [ ] 중복 목표 배분·품질 상수·액션 카탈로그를 정리하고 기존 흐름 테스트를 유지한다.

### OPT 020 설정 저장

대상: `persistentDesktopSettingsPatch`, `normalizeDesktopSettings`, `main.ts` settings 저장.

- [ ] customBytes를 유한한 양수로 검사하고 지원 범위를 정한다.
- [ ] 같은 디렉터리의 임시파일 후 승격으로 설정을 저장한다.
- [ ] 손상된 설정·버전 migration·동시 저장을 검증하고 복구 결과를 안내한다.

### OPT 021 문서와 릴리즈 증거

대상: `ARCHITECTURE.md`, `KNOWN_LIMITATIONS.md`, `SECURITY_REVIEW.md`, `TESTING.md`, QA 문서.

- [ ] safe 보존 및 verifier 설명을 수정 완료된 실제 동작과 맞춘다.
- [ ] audit의 moderate 이상 차단과 전체 취약점 0 표현을 일치시킨다.
- [ ] 실제 Windows·한컴 열기·큰 문서·장시간 재시작을 버전·환경·결과별로 기록한다.
- [ ] synthetic 통과와 실제 문서 검증, 로컬 호스트 검증과 배포물 검증을 구분한다.

### OPT 022 벤치마크 실패 추적

대상: `scripts/bench/src/runBench.ts`, `report.ts`, corpus tests.

- [ ] 문서별 처리 실패와 제외 이유를 보고서에 남긴다.
- [ ] 실패 문서를 중앙값에서 조용히 제외해 GO가 되지 않도록 판정 정책을 정한다.
- [ ] 실제 corpus와 fixture의 통계 범위를 맞추고 실패/부분 성공 fixture로 확인한다.
- [ ] 측정 도구 미설치 INVALID와 정상 NO-GO를 구분하는 기존 정책을 유지한다.

### OPT 023 화면과 흐름 기반 UX

대상: 기존 Electron 앱의 빈 화면·파일 선택·단일 분석·배치·진행·완료·설정 흐름.

- [ ] 실제 실행 화면을 캡처·검토하고 화면별 관찰 근거를 기록한다.
- [ ] 제출 용량 최적화라는 사용자 과제에 맞게 다음 행동과 결과 확인을 명확히 한다.
- [ ] 예상 결과와 검증된 실측 결과, 단일·파일별·합계 목표를 구별한다.
- [ ] 기존 시각 스타일을 기반으로 확인된 UX 마찰을 수정하고 전후 흐름을 검증한다.

- [x] 2026-10-15 추가 요청: 단일·일괄 압축 완료 뒤 처음 화면으로 돌아가 새 작업을 시작할 수 있다. 저장 결과·설정은 유지하고 파일 선택으로 포커스를 옮긴다.

부분 구현 기록: 완료 후 `처음으로`를 상단과 결과 영역에 추가했다. 실제 Electron/Playwright에서 단일 완료 → Enter 초기화 → 키보드 재선택 → 일괄 완료 → 초기화 → 새 단일 문서 선택을 확인했다. 기본 800×560 및 최소 720×520 화면, 보존된 10MB 설정, 입력·저장 파일 해시와 빈 목록을 검사했다. 전체 586개 테스트·타입 검사·빌드·초기화 회귀를 포함한 Electron 스모크 통과. [전후 캡처와 검증 기록](UI_RESET_FLOW_2026-10-15.md). 커밋 `c0e09db`의 [Windows 릴리즈·초기화 스모크](https://github.com/eunsang26/hwpx-optimizer/actions/runs/38659239767)도 586개 테스트·타입 검사·빌드·audit·ASAR/native 검사와 함께 통과했다. 나머지 예상/실측 구분·완료 화면 계층 및 전체 흐름 개선은 계속 진행한다.

### OPT 024 키보드와 피드백 및 오류 복구

대상: renderer의 포커스·live status·폼 검증·진행·취소·실패와 재시도.

- [ ] 키보드만으로 파일 선택부터 결과 열기와 모달 닫기를 수행한다.
- [ ] 모달의 포커스 진입·유지·복귀, 명확한 포커스 표시를 검증한다.
- [ ] 분석·저장·취소·완료·실패를 시각과 보조기술에 일관되게 전달한다.
- [ ] 잘못된 용량 입력에 해당 컨트롤과 연결된 설명 및 복구 방법을 제공한다.
- [ ] 진행 표시·감소된 모션·반복 실행과 부분 실패의 HCI 동작을 검증한다.

### OPT 025 화면 계층과 가독성

대상: 기존 styles.css, index.html 및 renderer 화면 표시.

- [ ] 사용자 목표·주요 행동·상세 설정·완료 결과의 시각 계층을 화면 근거로 정리한다.
- [ ] 최소 지원 창 크기와 확대 상태에서 주요 행동과 내용이 잘리거나 겹치지 않는다.
- [ ] 텍스트 대비·클릭 영역·설정 레이블·표와 긴 파일명의 가독성을 확인한다.
- [ ] 변경 후 실제 화면을 다시 캡처해 확인하고 시각 검증 범위를 기록한다.

### OPT 026 배포 런타임 보안 패치

2026-10-14 릴리즈 audit에서 `sharp` 높음 등급 의존성 보고를 확인했다. [libheif advisory](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c) 및 [librsvg advisory](https://github.com/advisories/GHSA-wq5f-xc86-pv6w)에 대응하는 [sharp 0.35.5](https://github.com/lovell/sharp/releases/tag/v0.35.5)를 검증한다.

Electron 패치의 npm tooling 최소 버전(22.12)에 맞춰 Node 개발/CI/CLI 배포 pin도 공식 LTS 24.21.0으로 통일한다. 기존 Node 20 검증 기록은 과거 증거로 유지한다.

전체 audit에서 배포 바이너리인 Electron도 보고되어 같은 작업에 포함한다. Electron 42.11.13으로 같은 major 안에서 업데이트하고, [Electron 공식 advisory](https://github.com/electron/electron/security/advisories/GHSA-9f4c-93c8-jc8g)에 따라 `devDependencies`라도 릴리즈 차단 대상에 포함한다. 전체 audit 실패/잘못된 응답을 통과로 처리하지 않는다.

- [x] root·workspace·패키징 pin과 lockfile을 수정 버전으로 통일한다.
- [x] production audit가 통과하고 문서 보존·품질·용량 회귀 테스트를 통과한다.
- [x] Linux 빌드·Electron 스모크 및 Windows CLI/native 배포 실행을 검증한다.
- [x] 실제로 확인한 런타임과 남은 개발 도구 advisory를 문서에 반영한다.

검증 기록: 2026-10-14 Linux/Node 24.13.0. 전체 68개 파일·490개 테스트 통과·1개 건너뛰기, 타입 검사·빌드·합성 corpus 2/2·Electron 스모크 통과. sharp 0.35.5/libvips 8.18.7, Electron 42.11.13. 배포 runtime moderate+ 0개; 전체 audit 20개(높음 8, 중간 11, 낮음 1)의 개발/패키징 도구 advisory는 남아 있다. 첫 Windows 실행은 npm 11.19의 lockfile 검증에서 WASM 선택 의존성 `@emnapi/runtime`·`@emnapi/core` 누락으로 설치 실패했다. 동일 Node 24.21.0/npm 11.19.0을 공식 archive/checksum으로 준비해 깨끗한 workspace에서 lockfile을 보정했다. `npm ci --dry-run`, Node 24.21.0 전체 495개 테스트·타입 검사·빌드·runtime audit 통과. Windows native 실행은 재검증 중이다.

Windows 검증: 보정 커밋 `1363fda`에서 [CLI ZIP/native 실행 스모크](https://github.com/eunsang26/hwpx-optimizer/actions/runs/38527067723)와 [데스크톱 릴리즈 빌드·Electron 스모크·unpacked native 검사](https://github.com/eunsang26/hwpx-optimizer/actions/runs/38527071838) 모두 통과했다. 두 실행 모두 495개 테스트·타입 검사·빌드·audit 통과. 합성 문서만 사용하고 산출물 업로드는 비활성화했다. clean 기관 PC·한컴 수동 QA는 OPT-021에 남아 있다.

## 완료와 갱신 규칙

한 번에 한 작업을 수행한다. 상태는 대기 → 진행 → 검증 → 완료로 갱신하며, 작업 시작 시 담당과 branch/PR을 기록한다. 범위가 달라지면 ID는 유지하고 변경 이유를 기록한다.

동작 변경은 해당 패키지의 재현 회귀 테스트를 먼저 실행한 뒤 `npm test`, `npm run typecheck`, `npm run build`를 통과해야 한다. Electron 경계 변경은 스모크, 패키징 변경은 실제 Windows 산출물 검사를 추가한다. 완료 시 체크박스, 변경 커밋/PR, 검증 명령·결과·환경을 기록한다. 구현 없이 테스트가 통과했다는 이유로 완료 처리하지 않는다.
