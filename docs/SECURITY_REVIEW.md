# Security Review Checklist

이 문서는 HWPX Optimizer의 사내 배포 전 보안성 검토 대응 항목을 정리한다. 각 릴리즈 담당자는 아래 항목을 확인하고 배포 기록에 테스트 결과, 산출물 해시, 예외 사항을 남긴다.

## 1. 로컬 전용 증빙

| 항목 | 현재 처리 |
| --- | --- |
| 서버 업로드 | 없음. CLI와 Desktop 모두 로컬 파일을 읽고 로컬 결과 파일을 쓴다. |
| 로그인/계정 | 없음. 사용자 인증, 계정 생성, 과금 기능이 없다. |
| 텔레메트리 | 없음. 사용 통계나 문서 내용을 외부로 전송하지 않는다. |
| 네트워크 기반 최적화 | 없음. 최적화는 TypeScript core와 로컬 native dependency로 수행한다. |
| Electron 제한 | renderer는 CSP `connect-src 'none'`을 사용하고, main process에서 외부 HTTP/HTTPS/WebSocket 요청을 차단한다. `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`로 실행된다. |

## 2. 원본과 개인정보 보호

| 항목 | 현재 처리 |
| --- | --- |
| 원본 보존 | 원본 파일을 직접 덮어쓰지 않는다. CLI와 Desktop 모두 기본적으로 새 결과 경로를 만든다. |
| 덮어쓰기 방지 | 기본 non-overwrite는 출력 이름을 배타적으로 확보하고 충돌 시 suffix를 붙인다. 명시적 overwrite도 입력 파일 또는 같은 inode의 링크를 출력·리포트 대상으로 허용하지 않는다. Desktop은 현재 세션에서 선택한 모든 입력을 worker 재시작 후에도 보호한다. |
| 샘플/리포트 관리 | root-level `sample*.hwpx`, `sample*.hwp`, `sample*.json`, `sample*.txt`, `결과/`는 커밋 금지 대상이다. |
| shape comment 정리 범위 | `clean-shape-comment`는 지원하는 comment에서 자동 생성된 `원본 그림의 이름:`·`원본 그림의 크기:` 행만 지운다. 작성한 설명은 보존한다. 개인정보 익명화나 편집 이력 전체 제거 기능은 아니다. |
| 보안 문서 | 암호화, DRM, 전자서명, 권한 제한 문서는 최적화하지 않는다. |
| Desktop 기록 저장 | 앱 설정 whitelist는 중첩 속성까지 제한하며 최근 파일, 입력 경로, 출력 폴더 경로, 처리 이력, 내부 로그를 저장하지 않는다. JSON 리포트는 기본 off이며 켠 경우 별도 산출물로 생성한다. 이는 앱 소유 설정 정책이며 OS·뷰어의 최근 문서 기록까지 통제하지 않는다. [설정·복구 계약](DESKTOP_SETTINGS_2026-10-15.md). |
| IPC 경로 제한 | Desktop main process는 선택·분석된 HWPX와 이번 실행에서 생성된 결과 파일만 분석, 최적화, 검증, 열기 대상으로 허용한다. |

## 3. 보안성 검토 자료

배포 담당자는 다음 명령 결과를 릴리즈 기록에 남긴다.

```bash
npm test
npm run typecheck
npm run build
npm run release:audit
npm audit
npm run release:hygiene
npm run release:verify-artifacts
npm run desktop:smoke
npm run release:check:win-portable:self-signed
```

릴리즈 산출물은 `release/release-manifest.json`과 `release/SHA256SUMS.txt`로 해시를 검증한다. 배포 차단 판정은 `npm run release:audit`를 사용한다. 이 명령은 production audit와 full audit 응답을 모두 검증하고, production 의존성 및 devDependencies에 선언돼도 실제 배포되는 Electron의 **moderate 이상** 취약점이 있으면 실패한다. 응답 오류·불완전 JSON도 재시도 후 실패한다. 나머지 개발·빌드 도구 advisories는 full audit에서 별도로 검토하며 전체 취약점 0으로 표현하지 않는다.

`22546ee`의 2026-10-15 Windows 검증은 위 runtime moderate 이상 0, 전체 20개(high 8·moderate 11·low 1)였다. 최신 판정은 릴리즈마다 재실행해야 한다. [현재 증거 목록](RELEASE_EVIDENCE_2026-10-15.md)은 합성 CI·실제 패키지 실행·과거 실제 문서 확인·한컴/기관 PC 미실시를 구분한다. 자동 통과를 수동 보안성 검토나 최종 배포 승인으로 해석하지 않는다.

## 4. 배포 통제

- 배포 파일은 승인된 사내 공유 위치 또는 소프트웨어 배포 시스템으로만 배포한다.
- 배포 공지에는 버전, 배포일, 담당자, 변경 내역, SHA256 값, 자체서명 상태, 제작자/사용 조건, 보증 부인 및 사용자 책임 문구를 포함한다.
- `release:manifest`는 `release/RELEASE_NOTICE_<version>.txt`를 생성하며, `release:verify-manifest`는 공지문에 artifact 파일명과 SHA256이 포함되었는지 검증한다.
- 배포 패키지에는 사용자에게 보이는 `TERMS.txt`를 포함한다.
- 임의 재배포와 외부 반출을 금지한다.
- 사전 승인 없는 수정, 변형, 파생물 제작, 영리 목적 이용, 제작자 또는 출처 표시 제거를 금지한다.
- 결과물 제출·배포·보관 전 사용자 직접 확인, 원본 보존, 최종 사용 책임을 공지한다.
- 직원 간 공유가 필요한 경우 사용 후 폴더가 아니라 릴리즈 게이트를 통과한 원본 ZIP 또는 portable EXE만 공유한다.
- 공개 CA 코드서명 인증서가 없는 경우 자체서명 코드서명 인증서로 Windows artifact에 서명하고, Windows 게시자 신뢰 경고 가능성을 승인 기록에 명시한다.
- 공개 CA / 조직 PFX가 준비된 경우 `HWPX_WIN_CSC_LINK` + `HWPX_WIN_CSC_KEY_PASSWORD`(또는 `CSC_LINK` / `CSC_KEY_PASSWORD`)를 설정한 뒤 동일 서명 스크립트로 서명하고, `release/RELEASE_NOTICE_*.txt`의 서명 종류와 SHA256을 배포 기록에 남긴다.

## 5. 운영 문서

배포 검토 패키지에는 다음 문서를 포함한다.

- [Internal Distribution Guide](INTERNAL_DISTRIBUTION.md)
- [Release](RELEASE.md)
- [Windows QA Checklist](WINDOWS_QA_CHECKLIST.md)
- [Known Limitations](KNOWN_LIMITATIONS.md)
- `TERMS.txt`
- `release/RELEASE_NOTICE_<version>.txt`
- 릴리즈별 SHA256 checksum과 manifest
- 테스트 및 QA 결과 요약

## 6. 사전 합의

정보보안 또는 정보관리 검토 요청 시 다음 범위를 명확히 제시한다.

- 이 도구는 일반 HWPX 문서 용량 최적화 도구다.
- 문서는 외부로 전송되지 않고 사용자 PC에서 처리된다.
- 원본 문서는 수정하지 않고 결과 파일을 별도로 만든다.
- 프로그램 자체에는 최근 파일, 처리 이력, 출력 폴더 경로, 내부 로그를 저장하지 않는다.
- 보안 처리된 문서는 처리하지 않으며, 암호화, DRM, 전자서명, 권한 제한을 해제하거나 우회하지 않는다.
- 배포는 승인된 내부 경로로만 수행한다.
- 비영리 목적의 개인 또는 기관 내부 사용만 무상 허용하며, 사전 승인 없는 수정, 재배포, 영리 이용은 금지한다.
- 현재 Windows 배포 파일은 자체서명 배포본이며, Windows 게시자 신뢰 경고 가능성과 실행 전 SHA256 대조 확인이 필요하다.
- 본 소프트웨어는 있는 그대로 제공되며, 결과물 이상 여부의 최종 확인 및 사용 책임은 사용자에게 있다.
