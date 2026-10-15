# Windows 로컬 폰트와 라이선스 검증

OPT-016의 패키징 변경과 검증 기록이다. 앱의 글꼴은 `Pretendard Variable`이며 외부 URL이나 시스템 설치를 요구하지 않는다. 글꼴 파일과 포함 라이선스의 내용은 수정하지 않았다.

## 포함 계약

`copy-assets.mjs`가 `PretendardVariable.woff2`와 `OFL.txt` 두 필수 파일을 명시적으로 복사한다. 원본 파일이 없으면 빌드를 실패시킨다. electron-builder `files`에도 다음 경로를 각각 포함한다.

- `apps/desktop/dist/fonts/PretendardVariable.woff2`
- `apps/desktop/dist/fonts/OFL.txt`

이전에는 dist 복사는 있었지만 Windows 파일 목록이 woff2·OFL.txt를 포함하지 않았다. `check-release-artifacts.mjs`는 실제 `app.asar`에서 두 파일을 꺼내 체크아웃의 원본과 바이트 단위로 비교한다. 없거나 비었거나 바뀐 파일이면 실패하며, 성공 시 바이트 수와 SHA256을 기록한다. CLI 전용 ZIP에는 데스크톱 폰트를 요구하지 않는다.

## 로딩 검증

일반 Electron 스모크와 패키지 스모크는 첫 페이지를 열기 전에 세션을 오프라인으로 만든다. 기존 HTTP/HTTPS/WS/WSS 차단도 유지한다. `document.fonts.load`로 두께 400과 700의 글꼴이 로드되었는지 확인한 뒤, 한글·영문·숫자 문자열 `한글 문서 압축 ABC0123`을 렌더한다. Chromium의 `CSS.getPlatformFontsForNode`로 실제 사용 글꼴을 읽어 Pretendard·`isCustomFont: true`·양수 glyph 수를 요구한다. CSS에 이름만 지정했거나 시스템 fallback으로 그려지는 상태는 통과하지 않는다.

`desktop:smoke:packaged:win`은 Windows용 실제 배포 디렉터리를 다음 조건으로 검사한다.

1. 시스템/사용자 폰트 등록과 폰트 폴더에 Pretendard가 없는지 읽기 전용 PowerShell로 검사한다. 설치된 환경이면 깨끗한 환경 증거를 만들 수 없으므로 실패한다. 글꼴을 설치하거나 삭제하지 않는다.
2. 빌드한 앱 디렉터리 전체를 체크아웃 밖의 새 임시 폴더로 복사한다. 저장소의 `node_modules`로 누락된 의존성을 보완할 수 없다. `NODE_PATH`·`NODE_OPTIONS` 주입과 외부 문서 입력도 사용하지 않는다.
3. 새 cwd와 userData/cache로 복사된 EXE를 실행한다. `app.isPackaged`와 실제 `resources/app.asar/.../PretendardVariable.woff2` URL을 요구한다.
4. 오프라인 custom-font 검증 뒤 합성 문서의 분석·압축·검증·저장·일괄·초기화 전체 스모크를 실행한다. 정상 종료 코드뿐 아니라 폰트 증거와 전체 워크플로 완료 마커를 요구한다. 180초를 넘기거나 증거가 없으면 실패한다.

Windows release workflow는 기존 릴리즈 게이트 뒤 이 패키지 스모크를 실행한다. 로컬/CI 실행 명령은 `npm run desktop:smoke:packaged:win`이며, 인자로 다른 unpacked 앱의 EXE 경로를 지정할 수 있다. Linux에서 Windows 패키지 검증을 건너뛰어 성공으로 처리하지 않는다.

## Linux 검증

2026-10-15 Node 24.13.0/Electron 42.11.13. 실제 ASAR를 만드는 대상 테스트 7개와 관련 repo 구성 검사를 먼저 실행했다. 전체 Vitest 86개 파일·676개 테스트 통과·1개 건너뛰기, 타입 검사·빌드·실제 Electron 스모크·기존 합성 corpus 2/2가 통과했다.

- 실제 ASAR에 두 파일이 있는 경우를 수락하고 font/license 누락과 변경 네 가지 경우를 거부했다.
- 네트워크 오프라인 상태에서 두께 400·700 모두 Pretendard custom font로 16 glyph를 렌더했다.
- 빌드 폴더의 폰트만 잠시 잘못된 합성 바이트로 바꾸는 음성 검증에서 스모크가 종료 코드 1로 실패했고 폰트/완료 성공 마커를 출력하지 않았다. finally에서 빌드 파일을 복원했고 소스 폰트 SHA256은 같았다. 복원 후 전체 스모크는 정상 완료했다. 소스 폰트나 입력 문서는 변경하지 않았다.

Linux 빌드의 원본/복사본 기준:

| 파일 | 바이트 | SHA256 |
| --- | ---: | --- |
| PretendardVariable.woff2 | 2057688 | `9599f12fd42fc0bce1cd50b47a0c022e108d7aa64dd0d1bb0ed44f3282d900b4` |
| OFL.txt | 4418 | `d31ddd9f2bed32fd7e302a205cf2380ba0de6529152d239ef99cfb6f261bfc04` |

## Windows 검증

실제 Windows 패키지 실행 결과를 확인한 뒤 기록한다. 깨끗한 CI 환경에서의 자동화와 기관 PC의 수동 QA는 구분한다. 이 작업이 Windows 10/11의 모든 정책·디스플레이·접근성 환경이나 한글 앱의 문서 외형을 검증하는 것은 아니다.
