# Internal Distribution Guide

이 문서는 HWPX Optimizer를 회사 내부에 배포할 때 감사, 정보보안, 정보관리 검토에 제출할 기본 운영 기준을 정리한다.

## 배포 목적

HWPX Optimizer는 사용자의 PC 안에서 HWPX 문서 용량 원인을 분석하고, 원본을 보존한 채 최적화된 새 HWPX 파일을 생성하는 로컬 유틸리티다. 서버 업로드, 로그인, 계정, 과금, 클라우드 저장, 텔레메트리, 외부 네트워크 기반 최적화 경로를 제공하지 않는다.

## 사용 대상

- 일반 HWPX 보고서, 제출 문서, 내부 검토 문서
- 사용자가 열람 권한을 가진 로컬 파일
- 사내 보안 정책상 로컬 PC에서 편집 및 저장이 허용된 문서

## 제작자 및 사용 조건

- 제작/관리: 한강유역수도지원센터 조은상 과장
- 본 소프트웨어는 비영리 목적의 개인 또는 기관 내부 사용에 한해 무상 사용을 허용한다.
- 사전 서면 승인 없는 소프트웨어 수정, 변형, 파생물 제작, 실행 파일 또는 압축 파일의 무단 재배포, 판매·임대·유료 서비스 포함 등 영리 목적 이용, 제작자 또는 출처 표시 제거를 금지한다.
- 현재 Windows 배포 파일은 공개 CA 인증서가 아닌 자체서명 코드서명 인증서로 서명된 배포본이며, Windows에서 게시자를 신뢰하지 못한다는 경고가 표시될 수 있다. 사용자는 실행 전 배포 파일의 SHA256 값을 배포 공지, `SHA256SUMS.txt`, `release-manifest.json`과 대조해 확인해야 한다.
- 사용자는 원본 문서를 보존하고 생성된 결과물을 제출, 배포, 보관하기 전에 직접 열람하여 내용, 서식, 이미지, 표, 첨부 리소스 이상 여부를 확인해야 한다.
- 본 소프트웨어의 사용 또는 사용 불능, 최적화 결과물의 오류, 문서 손상, 데이터 손실, 제출 지연, 업무상 손해 등으로 발생하는 문제에 대한 최종 확인 및 사용 책임은 사용자에게 있다.
- 배포 패키지에는 사용자에게 보이는 `TERMS.txt`를 포함한다.

## 제외 문서

다음 문서는 최적화하지 않는다.

- 암호화된 HWPX 또는 읽기 위해 비밀번호가 필요한 문서
- DRM, 문서보안, 권한 제한, 반출 통제 솔루션이 적용된 문서
- 전자서명, 무결성 보증, 승인 완료 상태를 유지해야 하는 문서
- 읽기 전용, 편집 제한, 배포 제한 등 보호 메타데이터가 감지된 문서
- HWP 바이너리 문서. 사용자가 직접 HWPX로 저장 또는 내보낸 뒤 일반 문서로 처리해야 한다.

프로그램은 위 보호 조치를 해제, 복호화, 우회하지 않는다. 보호 신호가 감지되면 “보안 처리된 문서는 최적화 대상이 아닙니다. 암호화, DRM, 전자서명, 권한 제한을 해제하거나 우회하지 않습니다.”라고 안내하고 처리를 중단한다.

## 개인정보와 로그 정책

- 원본 파일은 직접 수정하지 않는다.
- 결과 파일은 새 이름 또는 사용자가 지정한 출력 위치에 저장한다.
- Desktop 앱은 최근 파일, 입력 경로, 출력 폴더 경로, 처리 이력, 내부 로그를 저장하지 않는다.
- 영구 설정에는 기본 모드, 덮어쓰기 방지, 제출 기준 같은 비민감 환경설정만 저장한다.
- JSON 리포트 저장은 기본적으로 꺼져 있으며, 사용자가 명시적으로 켠 경우에만 결과 파일 옆에 생성한다.
- JSON 리포트는 사용자가 선택한 산출물이며 프로그램 내부 로그가 아니다. 문서 구조, 용량, 적용 작업, 경고 중심으로 생성하고 원문 본문을 수집하는 용도가 아니다.
- 실제 업무 문서, 샘플 문서, 생성 리포트는 저장소에 커밋하지 않는다.
- 문제 재현을 위해 파일 제공이 필요한 경우 개인정보와 업무상 비밀을 제거한 테스트 파일만 사용한다.

## 배포 절차

1. 배포 브랜치에서 테스트, typecheck, build, release hygiene, desktop smoke를 통과시킨다.
2. Windows 배포 전 `npm run release:check:win-portable:self-signed`를 실행한다.
3. `release/SHA256SUMS.txt`, `release/release-manifest.json`, `release/RELEASE_NOTICE_0.1.0.txt`를 생성하고 검증한다.
4. `npm run release:verify-artifacts`로 배포 산출물 안에 개발 파일, 샘플, 리포트, 설정, 로그, 소스맵, 타입 선언이 포함되지 않았음을 확인한다.
5. 배포 파일명, 버전, 배포일, 담당자, SHA256 값, 자체서명 상태, `TERMS.txt` 사용 조건, 보증 부인 및 사용자 책임 문구를 배포 공지에 포함한다.
6. 승인된 사내 공유 위치 또는 소프트웨어 배포 시스템으로만 배포한다.
7. 직원 간 공유 시에도 사용 후 폴더가 아니라 릴리즈 게이트를 통과한 원본 ZIP 또는 portable EXE만 공유한다.
8. 공개 CA 코드서명 인증서가 준비된 경우 자체서명 대신 공개 CA 서명 절차를 수행하고 서명 결과를 배포 기록에 남긴다.

## Desktop vs CLI Portable 선택

| | Desktop (Electron) | CLI Portable ZIP |
|---|---|---|
| 대상 사용자 | GUI, 드래그앤드롭, 배치 UI | 명령줄·끌어다 놓기, Node 미설치 PC |
| 산출물 | `HWPX Optimizer-<version>-x64.exe` / `.zip` | `hwpx-opt-win-x64.zip` |
| 릴리즈 게이트 | `release:check:win-portable` | `release:check:cli-portable` |
| Windows E2E | `release:verify-win-portable-smoke` | CI: `cli-portable-release.yml` on `windows-latest` (synthetic HWPX); 로컬: `HWPX_OPT_SMOKE_INPUT=sample*.hwpx npm run release:verify-cli-portable-smoke` |
| 코드서명 | 자체서명 EXE (현재) | 미서명 `node.exe` + `.bat` |
| SHA256 출처 | `release/SHA256SUMS.txt`, `release-manifest.json` | 동일 manifest + zip 전용 `hwpx-opt-win-x64.SHA256SUMS.txt` |

두 배포 경로는 독립적으로 승인·배포한다. Desktop만 필요하면 CLI ZIP을 함께 배포할 필요는 없다.

## CLI Portable Windows ZIP

경량 CLI 배포(`release/hwpx-opt-win-x64.zip`)는 Electron Desktop 배포와 별도로 관리한다.

1. Linux/WSL에서 `npm run release:check:cli-portable`을 실행한다 (또는 CI `.github/workflows/cli-portable-release.yml`의 Linux 게이트 통과).
2. CI가 활성화된 경우, 동일 워크플로의 `windows-latest` 스모크 작업이 Linux에서 빌드한 ZIP을 받아 **합성(synthetic) 최소 HWPX**로 `release:verify-cli-portable-smoke`를 실행한다. Linux 게이트만 통과했다고 Windows 런타임 지원을 주장할 수 없다.
3. 내부 배포 전 실제 문서 QA는 로컬 Windows(또는 WSL PowerShell)에서 `HWPX_OPT_SMOKE_INPUT=sample*.hwpx npm run release:verify-cli-portable-smoke`로 `drop-here.bat` 포함 E2E를 확인한다. `sample*.hwpx`는 저장소에 커밋하지 않으며 CI에 업로드하지 않는다.
4. `release/hwpx-opt-win-x64.SHA256SUMS.txt` 또는 `release/SHA256SUMS.txt` / `release/release-manifest.json`의 SHA256 값을 배포 공지에 포함한다.

- 지원 OS: **Windows 10+ x64** (Node 설치 불필요; ZIP 압축 해제 후 폴더에서 실행).
- 배포는 **사내 공유 위치**를 사용한다. 이메일 첨부 배포는 Mark-of-the-Web(MotW)과 보안 필터로 차단될 수 있으므로 지양한다.
- CLI portable은 공개 CA 코드서명 Electron 산출물과 달리 **서명되지 않은 `node.exe`와 `.bat` 런처**를 포함한다. SmartScreen, 백신, 그룹 정책으로 실행이 차단될 수 있으므로 IT 부서와 **허용 목록(allowlist)** 및 MotW 처리 절차를 사전에 문서화한다.
- 사용자에게 ZIP을 한 번 압축 해제한 뒤 `drop-here.bat`(끌어다 놓기) 또는 `hwpx-opt.cmd`(명령줄)로 실행하도록 안내한다. 폴더를 끌어다 놓으면 결과는 `<폴더>/optimized/`에 저장된다.

## 사용자 안내 문구

사내 공지에는 다음 문구를 포함한다.

> 이 도구는 HWPX 문서를 외부로 전송하지 않고 사용자 PC에서만 처리합니다. 원본 파일은 수정하지 않으며 결과 파일을 별도로 생성합니다. 암호화, DRM, 전자서명, 권한 제한 등 보안 처리된 문서는 최적화하지 않으며, 보안 조치를 해제하거나 우회하지 않습니다.
> Desktop 앱은 최근 파일, 처리 이력, 출력 폴더 경로, 내부 로그를 저장하지 않습니다. JSON 리포트는 사용자가 저장을 켠 경우에만 생성되는 별도 산출물입니다.
> 제작/관리자는 한강유역수도지원센터 조은상 과장입니다. 비영리 목적의 개인 또는 기관 내부 사용은 허용되며, 사전 승인 없는 수정, 재배포, 영리 이용, 제작자 표시 제거는 금지됩니다.
> 현재 Windows 배포 파일은 공개 CA 인증서가 아닌 자체서명 코드서명 인증서로 서명된 배포본입니다. Windows에서 게시자를 신뢰하지 못한다는 경고가 표시될 수 있으니, 실행 전 배포 파일의 SHA256 값을 배포 공지, `SHA256SUMS.txt`, `release-manifest.json`과 대조해 확인하세요.
> 본 소프트웨어는 있는 그대로 제공되며, 결과물은 제출·배포·보관 전에 사용자가 직접 확인해야 합니다. 원본 보존과 최종 사용 책임은 사용자에게 있습니다.

## 사용자 금지사항

- 보안 처리된 문서의 보호 조치를 해제한 뒤 본 도구로 처리하지 않는다.
- 원본 업무 문서나 생성 리포트를 Git 저장소, 외부 메신저, 외부 저장소에 업로드하지 않는다.
- 승인되지 않은 경로로 실행 파일을 재배포하지 않는다. 직원 간 공유가 필요한 경우 승인된 릴리즈 ZIP 또는 portable EXE만 공유한다.
- 프로그램을 수정, 변형하거나 영리 목적 서비스에 포함하지 않는다.
- 원본 문서를 보존하고, 결과물을 제출·배포·보관하기 전에 직접 열람하여 이상 여부를 확인한다.
- 처리 결과가 공식 제출본 또는 승인본을 대체하는 경우에는 담당 부서 검토를 먼저 받는다.
