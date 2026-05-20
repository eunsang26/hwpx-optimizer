# HWPX Optimizer 0.1.0 Release Approval Record

## Release Artifacts

- Primary artifact: `release/HWPX Optimizer-0.1.0-x64.zip`
- Secondary artifact: `release/HWPX Optimizer-0.1.0-x64.exe`
- Version: `0.1.0`
- Release candidate generated: `2026-05-20 20:23 KST`
- Signing status: unsigned. Code signing is intentionally excluded from this approval record and must be handled separately when an approved certificate is available.

## Checksums

| Artifact | Bytes | SHA256 |
| --- | ---: | --- |
| `HWPX Optimizer-0.1.0-x64.zip` | 143,515,511 | `83887f2b985560356d9309d795486e898fce4db628fd4787cad7abee0e76aecd` |
| `HWPX Optimizer-0.1.0-x64.exe` | 96,581,519 | `20b6e1920b49705a495a3a9a0e908452a03ae1010de6c82b03516ee0d08709a1` |

Checksum source files:

- `release/SHA256SUMS.txt`
- `release/release-manifest.json`
- `release/RELEASE_NOTICE_0.1.0.txt`

## Automated Release Gate

Command:

```bash
PATH=/home/eunsang26/.nvm/versions/node/v20.20.2/bin:$PATH npm run release:check:win-portable
```

Result: passed on `2026-05-20`.

Covered evidence:

- Release hygiene: passed.
- Vitest: 35 test files, 277 tests passed.
- TypeScript build/typecheck: passed.
- Regression corpus: 4/4 passed, including local `sample2.hwpx` and `sample3.hwpx`.
- `npm audit`: 0 vulnerabilities.
- Desktop smoke: passed.
- Windows ZIP and portable EXE packaging: passed.
- Artifact hygiene: passed, including `TERMS.txt` presence in the Windows ZIP artifact.
- Windows sharp native runtime verification: passed.
- Manifest, checksum, and release notice generation and verification: 2 release artifacts verified.
- Windows portable automated smoke through PowerShell: passed in `safe` mode with checksum match.

Windows CI evidence:

- GitHub Actions `Windows Release Build` run `26087133720` passed on `main` at commit `c9f5c3f`.
- The CI workflow runs `release:check:win:ci`, which is the Windows packaging gate without private real HWPX samples.
- The sample-backed release gate remains the local QA gate recorded above because root-level `sample*.hwpx` files are not committed.

Additional ZIP smoke:

- ZIP artifact was extracted under the Windows local temp directory.
- `scripts/windows-portable-smoke.ps1` was run against the extracted `HWPX Optimizer.exe`.
- Real local sample: `sample2.hwpx`.
- Modes: `safe`, `balanced`, and `aggressive`.
- Result: all three modes passed.
- Smoke temp: `C:\Users\<user>\AppData\Local\Temp\hwpx-release-zip-5dddb5a6-352a-41d9-95a2-4e452b7eff43`.
- Note: the extracted inner EXE is not listed in `release/SHA256SUMS.txt`; the checksum warning for `HWPX Optimizer.exe` is expected. The ZIP artifact itself is covered by `release/SHA256SUMS.txt`.

Additional portable EXE smoke:

- Portable EXE artifact was copied under the Windows local temp directory.
- `scripts/windows-portable-smoke.ps1` was run against `HWPX Optimizer-0.1.0-x64.exe`.
- SHA256 matched `release/SHA256SUMS.txt`.
- Real local sample: `sample2.hwpx`.
- Modes: `safe`, `balanced`, and `aggressive`.
- Result: all three modes passed.
- Smoke temp: `C:\Users\<user>\AppData\Local\Temp\hwpx-release-exe-9c155524-5ebf-402d-a41a-6c0b5301c7da`.

## Code Signing Boundary

PE signature inspection after the release gate:

- `release/HWPX Optimizer-0.1.0-x64.exe`: no Authenticode security directory.
- `release/win-unpacked/HWPX Optimizer.exe`: no Authenticode security directory.

This record therefore confirms artifact integrity and automated release verification only. It does not claim code signing completion.

## Security and Policy Evidence

Current source evidence:

- Start-screen safety text exists in `apps/desktop/src/index.html`: "원본은 변경하지 않고, 보안 문서 우회 없이 내 PC에서만 처리됩니다."
- Help text states protected documents are not bypassed and files stay on the PC.
- Help and settings text state the producer, permitted-use, and user-responsibility notice: non-commercial personal or internal organizational use is permitted; unapproved modification, redistribution, commercial use, and removal of producer attribution are prohibited; optimized outputs must be reviewed by the user before submission, distribution, or retention.
- Settings text states recent files, output folders, processing history, and internal logs are not stored.
- Desktop smoke checks that the local security policy text is present.
- `TERMS.txt` is included in the packaged Windows ZIP and `release/win-unpacked`.
- `RELEASE_NOTICE_0.1.0.txt` is generated beside the release artifacts with SHA256 values, unsigned status, permitted-use terms, warranty disclaimer, and user-responsibility notice.
- Protected document rejection message is defined in `packages/core/src/reader.ts`.
- Reader tests cover encrypted package flags, signature entries, and protection metadata rejection.

## Clean Windows QA Status

Status: pending before formal product-ready distribution.

Required clean Windows checks:

- Run `scripts/windows-portable-smoke.ps1` from a clean Windows 10/11 machine against the ZIP artifact after extraction.
- Run the smoke script with a real local HWPX sample in `safe`, `balanced`, and `aggressive` modes.
- Launch the desktop app manually and confirm local-only, original-preserving, protected-document rejection, and no recent-file/history/internal-log storage messaging.
- Confirm drag/drop analysis, optimization progress, output file actions, output folder actions, and optional report behavior.
- Confirm the original HWPX timestamp and size are unchanged.
- Confirm repeated optimizations do not overwrite prior outputs by default.
- Confirm at least one large HWPX package completes or fails with a clear non-crashing error.
- Confirm representative real-world documents do not produce missing-reference verifier failures.
- Confirm protected, signed, or encrypted HWPX-like packages are rejected without decryption, bypass, or signature-preservation promises.

## Distribution Controls

Approved distribution path:

- Use only an approved internal shared location or software distribution system.
- Distribute the original ZIP or portable EXE only; do not distribute extracted working folders.
- Include artifact filename, version, release date, owner, change summary, SHA256, and signing status in the release notice.
- Include the `TERMS.txt` permitted-use, warranty-disclaimer, and user-responsibility notice in the release notice.
- Prohibit external redistribution and unapproved sharing.

Required user notice:

> This tool processes HWPX documents only on the user's PC. It does not modify the original file and creates optimized outputs separately. It does not optimize encrypted, DRM-protected, electronically signed, or permission-restricted documents, and it does not remove or bypass protection. The desktop app does not store recent files, processing history, output folder paths, or internal logs. JSON reports are created only when the user enables report saving.
> Current Windows release artifacts are unsigned. Before running them, compare their SHA256 values against the release notice, `SHA256SUMS.txt`, and `release-manifest.json`.
> Producer/maintainer: 한강유역수도지원센터 조은상 과장. Non-commercial personal or internal organizational use is permitted. Unapproved modification, redistribution, commercial use, and removal or alteration of producer attribution are prohibited.
> This software is provided as is. Users must preserve original documents and review optimized outputs before submission, distribution, or retention. Final verification and use responsibility belongs to the user.

Release notice template:

- Product: `HWPX Optimizer`
- Version: `0.1.0`
- Release date: `YYYY-MM-DD`
- Release owner: `TBD`
- Distribution location: `TBD approved internal location`
- Primary download: `HWPX Optimizer-0.1.0-x64.zip`
- Secondary download: `HWPX Optimizer-0.1.0-x64.exe`
- Signing status: unsigned; code signing is excluded from this release-preparation record.
- Primary SHA256: `83887f2b985560356d9309d795486e898fce4db628fd4787cad7abee0e76aecd`
- Secondary SHA256: `20b6e1920b49705a495a3a9a0e908452a03ae1010de6c82b03516ee0d08709a1`
- Release notice: `RELEASE_NOTICE_0.1.0.txt`
- Redistribution: approved internal location only; do not share extracted working folders.
- Use terms: non-commercial personal or internal organizational use only; no unapproved modification, redistribution, commercial use, or removal of producer attribution.
- Warranty/user responsibility: provided as is; users must preserve originals and review outputs before submission, distribution, or retention.

## Clean Windows QA Evidence Template

Fill this section only after running the checklist on a clean Windows 10/11 machine.

- QA date: `TBD`
- QA owner: `TBD`
- Machine type: `TBD clean Windows 10/11`
- Windows version/build: `TBD`
- Artifact tested: `TBD ZIP primary or portable EXE secondary`
- Artifact source path: `TBD approved release location or local transfer path`
- Artifact SHA256 observed on Windows: `TBD`
- SHA256 matched `release/SHA256SUMS.txt`: `TBD yes/no`
- `scripts/windows-portable-smoke.ps1` no-sample launch: `TBD pass/fail`
- `scripts/windows-portable-smoke.ps1 -Sample <sample.hwpx> -AllModes`: `TBD pass/fail`
- Manual launch without terminal dependency: `TBD pass/fail`
- Start-screen local-only/original-preserving/security-document policy text visible: `TBD pass/fail`
- Drag/drop analysis workflow: `TBD pass/fail`
- Optimization progress does not freeze: `TBD pass/fail`
- Output file opens in a compatible HWPX viewer: `TBD pass/fail`
- Original file timestamp and size unchanged: `TBD pass/fail`
- Repeated optimization does not overwrite outputs by default: `TBD pass/fail`
- Large HWPX package completes or fails with a clear non-crashing error: `TBD pass/fail`
- Representative real-world documents avoid missing-reference verifier failures: `TBD pass/fail`
- Protected, signed, or encrypted HWPX-like package is rejected without decryption, bypass, or signature-preservation promises: `TBD pass/fail`
- QA evidence attachment location: `TBD`
- QA result summary: `TBD pass/fail`

## Distribution Approval Record Template

Fill this section before internal distribution.

- Release date: `TBD`
- Release owner: `TBD`
- Approver: `TBD`
- Approved distribution location: `TBD`
- Distribution method: `TBD internal share or software distribution system`
- Primary artifact placed at approved location: `TBD yes/no`
- Secondary artifact placed at approved location: `TBD yes/no`
- SHA256 values included in release notice: `TBD yes/no`
- Unsigned status included in release notice: `TBD yes/no`
- User notice included in release notice: `TBD yes/no`
- External redistribution prohibition included: `TBD yes/no`
- Extracted working folders excluded from distribution: `TBD yes/no`
- Approval evidence attachment location: `TBD`

## Approval State

Automated release gate: complete.

Artifact integrity package: complete.

Clean Windows QA: pending.

Distribution approval: pending until clean Windows QA evidence is attached.

## Prompt-to-Artifact Completion Audit

| Requirement | Evidence | Status |
| --- | --- | --- |
| ZIP is the primary artifact | `release/HWPX Optimizer-0.1.0-x64.zip`; checksum table above | Complete |
| Portable EXE is the secondary artifact | `release/HWPX Optimizer-0.1.0-x64.exe`; checksum table above | Complete |
| Release gate was rerun for the current artifacts | `release:check:win-portable` command and evidence above | Complete |
| Manifest, SHA256 files, and release notice match artifacts | `release/release-manifest.json`, `release/SHA256SUMS.txt`, `release/RELEASE_NOTICE_0.1.0.txt`, `release:verify-manifest` | Complete |
| ZIP artifact runtime smoke | Extracted ZIP under Windows local temp; `sample2.hwpx`; `safe`, `balanced`, `aggressive` | Complete |
| Portable EXE runtime smoke | Copied EXE under Windows local temp; SHA256 match; `sample2.hwpx`; `safe`, `balanced`, `aggressive` | Complete |
| Code signing excluded and not claimed | PE security directory check records no Authenticode signature block | Complete |
| Producer, permitted-use, and user-responsibility notice | App help/settings text, root `TERMS.txt`, ZIP `TERMS.txt`, internal distribution docs | Complete |
| Security and policy source evidence | Desktop policy text, settings storage text, protected-document reader policy, reader tests | Complete |
| Clean Windows manual QA | Must be run on a clean Windows 10/11 machine using the checklist above | Pending |
| Release owner/date/location | Template fields exist, but actual owner, release date, and approved distribution location are not filled | Pending |
| Distribution control record | Required controls are documented, but actual internal distribution path and approval evidence are not attached | Pending |

This release preparation record is therefore ready for the clean Windows QA and distribution-approval owner to fill the remaining pending items. It is not a final product-ready sign-off until every pending item above is complete.
