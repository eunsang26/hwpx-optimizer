# CLI Portable 사내 배포 가이드 (0.1.1+)

Electron Desktop과 **별도**로 `hwpx-opt-win-x64.zip`만 배포할 때 사용한다.  
전사 공통 정책은 [INTERNAL_DISTRIBUTION.md](./INTERNAL_DISTRIBUTION.md)를 따른다.

## 배포 전 체크리스트

- [ ] GitHub Actions **CLI Portable Windows ZIP** 워크플로의
  `cli-portable-windows` 작업 green (게이트 + ZIP 빌드 + synthetic HWPX smoke)
- [ ] (권장) Windows에서 실문서 QA:  
  `HWPX_OPT_SMOKE_INPUT=path/to/sample.hwpx npm run release:verify-cli-portable-smoke`
- [ ] 태그 `v*` push 시 artifact에서 ZIP + metadata 다운로드  
  - `hwpx-opt-win-x64` — ZIP + `hwpx-opt-win-x64.SHA256SUMS.txt`  
  - `hwpx-opt-win-x64-metadata` — `release-manifest.json`, `SHA256SUMS.txt`, `RELEASE_NOTICE_<version>.txt`
- [ ] 배포 공지 SHA256을 artifact의 checksum 파일과 대조
- [ ] IT: MotW, SmartScreen, `node.exe` / `.bat` allowlist 절차 확인
- [ ] 사내 공유 위치에만 업로드 (이메일 첨부 지양)

## 태그 릴리즈 (CI artifact)

```bash
git tag v0.1.1
git push origin v0.1.1
```

Actions → **CLI Portable Windows ZIP** → 해당 tag run → Artifacts 다운로드.

수동 검증만 필요할 때:

```bash
gh workflow run cli-portable-release.yml -f upload_artifact=true
```

## 0.1.1 태그 릴리즈 기록 (2026-07-24)

| 항목 | 값 |
|------|-----|
| Tag | `v0.1.1` |
| CI run | https://github.com/eunsang26/hwpx-optimizer/actions/runs/30061595586 |
| ZIP SHA256 | `db49cf8a81498764e977d304bb3f0814bdbe80c865af9298b81bd1d70d19f470` |
| ZIP bytes | 37,021,099 (~35.3 MB) |
| Artifacts | `hwpx-opt-win-x64`, `hwpx-opt-win-x64-metadata` |

사내 공지에는 위 SHA256을 그대로 붙여 넣으면 된다. **작성 완료 공지 초안:** [CLI_PORTABLE_NOTICE_0.1.1_사내공지.md](./CLI_PORTABLE_NOTICE_0.1.1_사내공지.md) (`RELEASE_NOTICE_0.1.1.txt`는 metadata artifact에도 포함).

---

## 사내 배포 공지 템플릿 (다음 버전용)

아래는 **0.1.2+** 등 차기 배포용 빈 템플릿이다. **0.1.1 공지는 위 링크 파일을 그대로 사용**한다.

---

**제목:** HWPX Optimizer CLI Portable Windows ZIP [0.1.1] 사내 배포

**배포 일시:** [YYYY-MM-DD]  
**담당:** 한강유역수도지원센터 조은상 과장  
**대상:** Windows 10+ x64 (Node 설치 불필요)

### 배포 파일

| 파일 | SHA256 |
|------|--------|
| `hwpx-opt-win-x64.zip` | `[artifact에서 복사]` |

- 바이트 크기: `[release-manifest.json artifacts[].bytes]`
- CI run: `[GitHub Actions run URL]`
- 태그: `v0.1.1`

### 사용 방법

1. ZIP을 **한 번** 압축 해제한다 (이메일 첨부 시 MotW로 차단될 수 있음).
2. **`drop-here.bat`** — HWPX 파일 또는 폴더를 끌어다 놓는다.  
   - 파일 1개 → 옆에 `*.optimized.hwpx` 생성  
   - 폴더 → `<폴더>/optimized/`에 결과 저장
3. **`hwpx-opt.cmd`** — 명령 프롬프트에서 `analyze`, `optimize`, `batch` 등 (기본 `--mode balanced`).
4. **`사용법.txt`** — 폴더 내 안내.

### 보안·서명

- 이 ZIP은 **코드서명되지 않은** `node.exe`와 `.bat` 런처를 포함한다 (Electron Desktop 자체서명 EXE와 다름).
- SmartScreen / 백신 / 그룹 정책으로 실행이 차단될 수 있다. IT 허용 목록 및 MotW 처리 절차를 따른다.
- 실행 전 ZIP의 SHA256을 위 표와 대조한다.

### 사용 조건 (요약)

> 이 도구는 HWPX 문서를 외부로 전송하지 않고 사용자 PC에서만 처리합니다. 원본 파일은 수정하지 않으며 결과 파일을 별도로 생성합니다. 암호화, DRM, 전자서명, 권한 제한 등 보안 처리된 문서는 최적화하지 않습니다.  
> 제작/관리: 한강유역수도지원센터 조은상 과장. 비영리 목적의 기관 내부 사용만 허용되며, 무단 수정·재배포·영리 이용은 금지됩니다.  
> 결과물은 제출·배포 전 사용자가 직접 확인해야 하며, 원본 보존과 최종 사용 책임은 사용자에게 있습니다.

---

## IT 부서용 메모

| 항목 | 내용 |
|------|------|
| 네트워크 | 런타임 업로드 없음 (로컬 전용) |
| 실행 파일 | `node.exe` (Node 20.20.2), `drop-here.bat`, `hwpx-opt.cmd` |
| 설치 | 없음 (포터블 ZIP, 압축 해제 후 실행) |
| 권장 | 사내 파일 서버 배포, MotW unblock 절차, 필요 시 path allowlist |

## 로컬 QA 기록 (0.1.1 준비)

| 항목 | 결과 |
|------|------|
| Actions run `30061316724` | Windows smoke **PASS** |
| `sample2.hwpx` Windows PowerShell smoke | **PASS** (balanced 92.36%, drop-here 파일/폴더) |
| sharp | 0.35.3 |

*태그 push 후 artifact SHA256은 위 템플릿 표에 tag run 값으로 갱신한다.*
