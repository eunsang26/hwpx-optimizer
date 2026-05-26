# HWPX Optimizer 0.1.0 Release Approval Record

## Release Artifacts

- Primary artifact: `release/HWPX Optimizer-0.1.0-x64.zip`
- Secondary artifact: `release/HWPX Optimizer-0.1.0-x64.exe`
- Version: `0.1.0`
- Release candidate generated: `2026-05-26 15:16 KST`
- Signing status: self-signed Authenticode. The Windows artifacts are signed with a local self-signed code-signing certificate, not a public CA certificate, so Windows publisher-trust warnings can still appear.

## Checksums

| Artifact | Bytes | SHA256 |
| --- | ---: | --- |
| `HWPX Optimizer-0.1.0-x64.zip` | 147,778,073 | `63a36b9263f80cff01c3061931d5782d2c530efb252cd033a4cc4f78e1a157ab` |
| `HWPX Optimizer-0.1.0-x64.exe` | 96,567,232 | `097930f24676ad1addf59058d6e454e7d50428bffae51cba4ca4d3071edc2486` |

Checksum source files:

- `release/SHA256SUMS.txt`
- `release/release-manifest.json`
- `release/RELEASE_NOTICE_0.1.0.txt`

## Automated Release Gate

Command:

```bash
PATH=/home/eunsang26/.nvm/versions/node/v20.20.2/bin:$PATH npm run release:check:win-portable
```

Result: passed on `2026-05-26`.

Covered evidence:

- Release hygiene: passed.
- Vitest: 35 test files, 281 tests passed.
- TypeScript build/typecheck: passed.
- Regression corpus: 4/4 passed, including local `sample2.hwpx` and `sample3.hwpx`.
- `npm audit`: 0 vulnerabilities.
- Desktop smoke: passed.
- Windows ZIP and portable EXE packaging: passed.
- Artifact hygiene: passed, including `TERMS.txt` presence in the Windows ZIP artifact.
- Windows sharp native runtime verification: passed.
- Self-signed Authenticode verification: passed for the portable EXE and unpacked app EXE.
- Manifest, checksum, and release notice generation and verification: 2 release artifacts verified.
- Windows portable automated smoke through PowerShell: passed in `safe` mode with checksum match.

Windows CI evidence:

- GitHub Actions `Windows Release Build` run `26159434272` passed on `main` at commit `88df45e`.
- The CI workflow runs `release:check:win:ci`, which is the Windows packaging gate without private real HWPX samples and without the local self-signed post-signing step.
- The sample-backed self-signed release gate remains the local QA gate recorded above because root-level `sample*.hwpx` files and the local self-signed certificate are not committed.

Additional ZIP smoke:

- ZIP artifact was extracted under the Windows local temp directory.
- `scripts/windows-portable-smoke.ps1` was run against the extracted `HWPX Optimizer.exe`.
- Real local sample: `sample2.hwpx`.
- Modes: `safe`, `balanced`, and `aggressive`.
- Result: all three modes passed.
- Smoke temp: `C:\Users\<user>\AppData\Local\Temp\hwpx-release-zip-final-1779776335`.
- Note: the extracted inner EXE is not listed in `release/SHA256SUMS.txt`; the checksum warning for `HWPX Optimizer.exe` is expected. The ZIP artifact itself is covered by `release/SHA256SUMS.txt`.

Additional portable EXE smoke:

- Portable EXE artifact was copied under the Windows local temp directory.
- `scripts/windows-portable-smoke.ps1` was run against `HWPX Optimizer-0.1.0-x64.exe`.
- SHA256 matched `release/SHA256SUMS.txt`.
- Real local sample: `sample2.hwpx`.
- Modes: `safe`, `balanced`, and `aggressive`.
- Result: all three modes passed.
- Smoke temp: `C:\Users\<user>\AppData\Local\Temp\hwpx-optimizer-smoke-sample-final-1779776194`.

## Code Signing Evidence

PE signature inspection after the release gate:

- `release/HWPX Optimizer-0.1.0-x64.exe`: Authenticode certificate table present; security directory file offset `96565016`, size `2216`.
- `release/win-unpacked/HWPX Optimizer.exe`: Authenticode certificate table present; security directory file offset `226578432`, size `2216`.

This confirms self-signed code signing only. It does not claim public CA trust or SmartScreen reputation.

## Security and Policy Evidence

Current source evidence:

- Start-screen safety text exists in `apps/desktop/src/index.html`: "원본은 변경하지 않고, 보안 문서 우회 없이 내 PC에서만 처리됩니다."
- Help text states protected documents are not bypassed and files stay on the PC.
- Help and settings text state the producer, permitted-use, and user-responsibility notice: non-commercial personal or internal organizational use is permitted; unapproved modification, redistribution, commercial use, and removal of producer attribution are prohibited; optimized outputs must be reviewed by the user before submission, distribution, or retention.
- Settings text states recent files, output folders, processing history, and internal logs are not stored.
- Desktop smoke checks that the local security policy text is present.
- `TERMS.txt` is included in the packaged Windows ZIP and `release/win-unpacked`.
- `RELEASE_NOTICE_0.1.0.txt` is generated beside the release artifacts with SHA256 values, self-signed status, permitted-use terms, warranty disclaimer, and user-responsibility notice.
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
> Current Windows release artifacts are signed with a self-signed code-signing certificate, not a public CA certificate. Windows publisher-trust warnings can still appear. Before running them, compare their SHA256 values against the release notice, `SHA256SUMS.txt`, and `release-manifest.json`.
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
- Signing status: self-signed Authenticode; public CA trust is not claimed.
- Primary SHA256: `63a36b9263f80cff01c3061931d5782d2c530efb252cd033a4cc4f78e1a157ab`
- Secondary SHA256: `097930f24676ad1addf59058d6e454e7d50428bffae51cba4ca4d3071edc2486`
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
- Self-signed status included in release notice: `TBD yes/no`
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
| Self-signed code signing is present and public CA trust is not claimed | `release:verify-win-signature`; release notice states self-signed status and Windows publisher-trust warning | Complete |
| Producer, permitted-use, and user-responsibility notice | App help/settings text, root `TERMS.txt`, ZIP `TERMS.txt`, internal distribution docs | Complete |
| Security and policy source evidence | Desktop policy text, settings storage text, protected-document reader policy, reader tests | Complete |
| Clean Windows manual QA | Must be run on a clean Windows 10/11 machine using the checklist above | Pending |
| Release owner/date/location | Template fields exist, but actual owner, release date, and approved distribution location are not filled | Pending |
| Distribution control record | Required controls are documented, but actual internal distribution path and approval evidence are not attached | Pending |

This release preparation record is therefore ready for the clean Windows QA and distribution-approval owner to fill the remaining pending items. It is not a final product-ready sign-off until every pending item above is complete.
