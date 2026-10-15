# Desktop workflow regression evidence · 2026-10-15

OPT-018 replaces six renderer/window source-string tests with 11 executed Electron scenarios. Manifest, version, packaging, icon and private-placeholder configuration checks remain in `repoConfig.test.ts`. Windows locale behavior already has its own filesystem tests. The smaller Vitest count reflects these six removals, not six disabled runtime tests.

## Executed paths

`npm run desktop:smoke:built` loads the real sandboxed renderer/preload and invokes `runWorkflowRegressionSmoke` only in smoke mode. Native file selection is supplied by the existing smoke dialog adapter; the selected paths still pass through main's registration and authorization. Settings are loaded by a fresh renderer. Document analysis/optimization uses the production worker; filesystem saves and reports use the production IPC handlers and transactions.

| Scenario | Observable assertions |
| --- | --- |
| Cancel file chooser | Initial view and empty queue remain unchanged; IPC selection is consumed. |
| Select one file | Real quick analysis completes; the selected name and available optimize action match it. |
| Cancel detailed analysis, retry | Reset/clear/policy controls remain disabled during work; cancellation retains the plan and focus; a real detailed retry completes. |
| Cancel single optimization | No partial result appears; the whole directory tree is unchanged and retry remains available. |
| Retry single optimization, reset | Published HWPX is verified against the original; report bytes match the saved size; reset preserves exact output/report hashes. |
| Cancel batch analysis | Both the current and remaining queue items become cancelled; no files change and no completion panel appears. |
| Add, deduplicate, remove, clear | Visible controls add files, deduplicate paths, remove pending rows, promote the last row to single mode and clear selection without changing files. |
| Single report failure, retry | A real directory at the report target forces IPC save failure; no document is partially published, no residue remains and removing the obstacle allows retry. |
| Aggregate report failure | Completed document/report pairs survive; the aggregate-report error stays visible as a warning and its open action remains disabled. |
| Cancel batch optimization, retry | Cancellation before publication preserves previous outputs, writes correct cancelled counts and restores the analysis plan on retry. |
| Selected-only batch completion | Unchecked input produces no output; completed output, report items, done count and measured aggregate size agree. |

Every scenario compares SHA-256 hashes for four generated HWPX inputs and one unrelated sentinel. Cancellation/reset/failure snapshots include directory entries and every file hash, exposing leaked stages, reservations or backups. Completed HWPX pairs run cross-package preservation verification against their original buffer in safe mode, with the measured size checked against the JSON report. Renderer errors and unhandled rejections must remain empty. The final marker reports the number of scenarios actually completed.

The UI cancellation gate pauses **delivery after a real worker result**, before publication. It makes the UI/IPC race deterministic without timing a tiny fixture or substituting fake analysis/optimization results. `documentCancellation.test.ts` separately pauses real worker CPU phases and filesystem renames/publication, verifying termination, timeout, rollback, completion after commit and restart. This distinction matters: UI delivery cancellation alone does not prove CPU-phase termination.

## Defects exposed by execution

The new visible-control check failed because CSS hid the file toolbar in both selected and batch views. Pending row removal was also unavailable. The toolbar is now visible and pending/failed/cancelled items offer **목록에서 제거** while idle; removing a row does not delete its file.

The blocked aggregate-report scenario also failed before the renderer fix: the expected warning was overwritten by `일괄 처리가 끝났습니다. 완료 2, 실패 0.` The report-save result now returns either a path or the failure to its completion caller, which renders the warning once and keeps the report action disabled. `못했습니다` is classified as a warning before matching successful-save phrases. Completed document pairs remain usable.

## Local verification

- Linux / Node 24.13.0: targeted 5 files / 65 tests passed; final 87 files / **678 passed, 1 skipped** with two test workers; typecheck, build and synthetic corpus **2/2** passed.
- Real Electron smoke: **11/11**, five original/sentinel hashes verified after each scenario, no renderer errors; both `desktop-workflow-complete` and `desktop-smoke-complete` emitted, process exit 0. Expected cancellation and blocked-path IPC errors remain visible in the test logs.
- Local Playwright used real pointer clicks with separate synthetic documents and isolated settings. File addition and pending removal were visible, the report warning remained visible with its report action disabled, original hashes were unchanged and page errors were **0**. At content widths 800 and 720 the page widths were respectively 785 and 705, with no horizontal page overflow. Captures remain local in `.tmp/ui-audit/workflow-regressions-2026-10-15/` (`01-single-800.png`, `02-batch-720.png`, `03-batch-report-error-720.png`, ARIA snapshots and `checks.json`). No documents or captures were uploaded.

This is synthetic workflow and preservation evidence. It does not establish Hancom rendering fidelity or institutional-PC manual acceptance. Wider HCI error wording/recovery and visual hierarchy remain tracked by OPT-024/025; the visible report failure still includes the underlying filesystem detail.
