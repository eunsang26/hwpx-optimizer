# HWPX Optimizer 0.1.0 Release Approval Record

## Release Artifacts

- Primary artifact: `release/HWPX Optimizer-0.1.0-x64.zip`
- Secondary artifact: `release/HWPX Optimizer-0.1.0-x64.exe`
- Version: `0.1.0`
- Release candidate generated: `2026-05-19 21:59 KST`
- Signing status: unsigned. Code signing is intentionally excluded from this approval record and must be handled separately when an approved certificate is available.

## Checksums

| Artifact | Bytes | SHA256 |
| --- | ---: | --- |
| `HWPX Optimizer-0.1.0-x64.zip` | 143,513,968 | `d67058036af867dee3aa4502de7bac234663a6c3229d8e0534a704b3c648efd2` |
| `HWPX Optimizer-0.1.0-x64.exe` | 96,570,042 | `8e7e40adb503cfb02226f085d26d646803dd6f39dc42cdfd6d57fbacc35801a7` |

Checksum source files:

- `release/SHA256SUMS.txt`
- `release/release-manifest.json`

## Automated Release Gate

Command:

```bash
PATH=/home/eunsang26/.nvm/versions/node/v20.20.2/bin:$PATH npm run release:check:win-portable
```

Result: passed on `2026-05-19`.

Covered evidence:

- Release hygiene: passed.
- Vitest: 35 test files, 277 tests passed.
- TypeScript build/typecheck: passed.
- Regression corpus: 4/4 passed, including local `sample2.hwpx` and `sample3.hwpx`.
- `npm audit`: 0 vulnerabilities.
- Desktop smoke: passed.
- Windows ZIP and portable EXE packaging: passed.
- Artifact hygiene: passed.
- Windows sharp native runtime verification: passed.
- Manifest generation and verification: 2 release artifacts verified.
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
- Note: the extracted inner EXE is not listed in `release/SHA256SUMS.txt`; the checksum warning for `HWPX Optimizer.exe` is expected. The ZIP artifact itself is covered by `release/SHA256SUMS.txt`.

Additional portable EXE smoke:

- Portable EXE artifact was copied under the Windows local temp directory.
- `scripts/windows-portable-smoke.ps1` was run against `HWPX Optimizer-0.1.0-x64.exe`.
- SHA256 matched `release/SHA256SUMS.txt`.
- Real local sample: `sample2.hwpx`.
- Modes: `safe`, `balanced`, and `aggressive`.
- Result: all three modes passed.

## Code Signing Boundary

PE signature inspection after the release gate:

- `release/HWPX Optimizer-0.1.0-x64.exe`: no Authenticode security directory.
- `release/win-unpacked/HWPX Optimizer.exe`: no Authenticode security directory.

This record therefore confirms artifact integrity and automated release verification only. It does not claim code signing completion.

## Security and Policy Evidence

Current source evidence:

- Start-screen safety text exists in `apps/desktop/src/index.html`: "원본은 변경하지 않고, 보안 문서 우회 없이 내 PC에서만 처리됩니다."
- Help text states protected documents are not bypassed and files stay on the PC.
- Settings text states recent files, output folders, processing history, and internal logs are not stored.
- Desktop smoke checks that the local security policy text is present.
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
- Prohibit external redistribution and unapproved sharing.

Required user notice:

> This tool processes HWPX documents only on the user's PC. It does not modify the original file and creates optimized outputs separately. It does not optimize encrypted, DRM-protected, electronically signed, or permission-restricted documents, and it does not remove or bypass protection. The desktop app does not store recent files, processing history, output folder paths, or internal logs. JSON reports are created only when the user enables report saving.

Release notice template:

- Product: `HWPX Optimizer`
- Version: `0.1.0`
- Release date: `YYYY-MM-DD`
- Release owner: `TBD`
- Distribution location: `TBD approved internal location`
- Primary download: `HWPX Optimizer-0.1.0-x64.zip`
- Secondary download: `HWPX Optimizer-0.1.0-x64.exe`
- Signing status: unsigned; code signing is excluded from this release-preparation record.
- Primary SHA256: `d67058036af867dee3aa4502de7bac234663a6c3229d8e0534a704b3c648efd2`
- Secondary SHA256: `8e7e40adb503cfb02226f085d26d646803dd6f39dc42cdfd6d57fbacc35801a7`
- Redistribution: approved internal location only; do not share extracted working folders.

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
| Manifest and SHA256 files match artifacts | `release/release-manifest.json`, `release/SHA256SUMS.txt`, `release:verify-manifest` | Complete |
| ZIP artifact runtime smoke | Extracted ZIP under Windows local temp; `sample2.hwpx`; `safe`, `balanced`, `aggressive` | Complete |
| Portable EXE runtime smoke | Copied EXE under Windows local temp; SHA256 match; `sample2.hwpx`; `safe`, `balanced`, `aggressive` | Complete |
| Code signing excluded and not claimed | PE security directory check records no Authenticode signature block | Complete |
| Security and policy source evidence | Desktop policy text, settings storage text, protected-document reader policy, reader tests | Complete |
| Clean Windows manual QA | Must be run on a clean Windows 10/11 machine using the checklist above | Pending |
| Release owner/date/location | Template fields exist, but actual owner, release date, and approved distribution location are not filled | Pending |
| Distribution control record | Required controls are documented, but actual internal distribution path and approval evidence are not attached | Pending |

This release preparation record is therefore ready for the clean Windows QA and distribution-approval owner to fill the remaining pending items. It is not a final product-ready sign-off until every pending item above is complete.
