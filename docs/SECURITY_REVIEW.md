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
| 덮어쓰기 방지 | 기존 출력 파일이 있으면 suffix를 붙인다. 입력 파일을 출력 또는 리포트 경로로 지정하면 거절한다. |
| 샘플/리포트 관리 | root-level `sample*.hwpx`, `sample*.hwp`, `sample*.json`, `sample*.txt`, `결과/`는 커밋 금지 대상이다. |
| 개인정보 흔적 정리 | `clean-shape-comment`는 작성자/편집 흔적성 shape comment를 정리하는 선택 작업이다. 원문 본문 수집 용도가 아니다. |
| 보안 문서 | 암호화, DRM, 전자서명, 권한 제한 문서는 최적화하지 않는다. |
| Desktop 기록 저장 | 최근 파일, 입력 경로, 출력 폴더 경로, 처리 이력, 내부 로그를 저장하지 않는다. JSON 리포트는 기본 off이며 사용자가 켠 경우에만 별도 산출물로 생성한다. |
| IPC 경로 제한 | Desktop main process는 선택·분석된 HWPX와 이번 실행에서 생성된 결과 파일만 분석, 최적화, 검증, 열기 대상으로 허용한다. |

## 3. 보안성 검토 자료

배포 담당자는 다음 명령 결과를 릴리즈 기록에 남긴다.

```bash
npm test
npm run typecheck
npm run build
npm audit
npm run release:hygiene
npm run release:verify-artifacts
npm run desktop:smoke
npm run release:check:win-portable
```

릴리즈 산출물은 `release/release-manifest.json`과 `release/SHA256SUMS.txt`로 해시를 검증한다. 의존성 취약점은 `npm audit` 결과를 기준으로 배포 전 검토한다.

## 4. 배포 통제

- 배포 파일은 승인된 사내 공유 위치 또는 소프트웨어 배포 시스템으로만 배포한다.
- 배포 공지에는 버전, 배포일, 담당자, 변경 내역, SHA256 값, 제작자/사용 조건을 포함한다.
- 배포 패키지에는 사용자에게 보이는 `TERMS.txt`를 포함한다.
- 임의 재배포와 외부 반출을 금지한다.
- 사전 승인 없는 수정, 변형, 파생물 제작, 영리 목적 이용, 제작자 또는 출처 표시 제거를 금지한다.
- 결과물 제출·배포·보관 전 사용자 직접 확인, 원본 보존, 최종 사용 책임을 공지한다.
- 직원 간 공유가 필요한 경우 사용 후 폴더가 아니라 릴리즈 게이트를 통과한 원본 ZIP 또는 portable EXE만 공유한다.
- 코드서명 인증서가 준비된 경우 Windows artifact에 서명하고 서명 결과를 배포 기록에 남긴다.
- 코드서명 인증서가 없는 경우 미서명 상태와 사유를 승인 기록에 명시한다.

## 5. 운영 문서

배포 검토 패키지에는 다음 문서를 포함한다.

- [Internal Distribution Guide](INTERNAL_DISTRIBUTION.md)
- [Release](RELEASE.md)
- [Windows QA Checklist](WINDOWS_QA_CHECKLIST.md)
- [Known Limitations](KNOWN_LIMITATIONS.md)
- `TERMS.txt`
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
- 본 소프트웨어는 있는 그대로 제공되며, 결과물 이상 여부의 최종 확인 및 사용 책임은 사용자에게 있다.
