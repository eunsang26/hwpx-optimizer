# Desktop settings contracts · 2026-10-15

OPT-020 validates persisted settings, publishes complete snapshots atomically, and exposes recovery/save results through a dedicated UI notice. Document processing remains local; settings contain no input/output paths, history or account data.

## Values and migration

- Custom limits are **integer bytes from 1 through 1TiB**. The existing UI MB unit is 1,048,576 bytes; decimal input such as 0.5 is supported and converted to the nearest byte within the supported range. Empty, non-finite, negative, sub-byte and oversized values are rejected. The API also rejects fractional byte values.
- Both custom-limit controls share validation, `aria-invalid`, associated error text and precise display. Invalid drafts disable optimization and leave the last valid limit on disk. Selecting custom mode starts with the preceding valid limit rather than an empty/unlimited target. Sub-MB chips display bytes/KiB rather than rounding to a misleading whole MB.
- `shared/desktopSettings.ts` defines the whitelist, defaults and version 3 schema. Unknown root/nested properties, paths and recovery metadata are never persisted. Known malformed fields are rejected on writes; valid fields from a partially damaged saved object are retained while invalid fields use defaults.
- Legacy recommended/safe defaults and `mb41` migrate to balanced and `mb40`. Recovery/migration loads do not write the file; the next explicit settings change publishes the normalized current snapshot. A newer numeric schema version is preserved and cannot be overwritten by this app version.
- A missing file means first-use defaults without a warning. Malformed JSON/root/values produce recovery guidance. Unreadable or non-regular/symbolic-link settings targets produce read-error guidance and block writes. Existing damaged bytes remain untouched until a valid explicit save succeeds.

## Storage and shutdown

`main/settingsStore.ts` queues reads and partial saves in order within this app instance. Every patch merges with the latest completed snapshot, including after a rejected earlier request. File-size preflight treats settings above 64KiB as damaged.

Publication creates an exclusive `.settings-<UUID>.tmp` in the target directory with mode 0600, writes the complete whitelisted JSON, syncs and closes the file, then renames it over `settings.json`. There is no unlink-and-retry fallback. Write/sync/promotion failures retain the previous target; cleanup removes only the owned temporary file. Atomic replacement also leaves an unrelated file hardlinked to the old settings inode unchanged.

The store exposes busy/close state. Normal app shutdown closes document operations, then waits for accepted settings requests before quitting. Further settings operations are rejected once the store is closing. The renderer catches failed saves, reloads the last available snapshot and keeps actionable guidance visible independently of normal progress messages; failure does not become an unhandled rejection.

The serialization scope is one running app instance. Independent processes may publish complete snapshots with last-writer-wins behavior; field-wise merging across processes is not guaranteed. File sync and rename are not a cross-platform power-loss transaction. A forcibly killed process can leave a private stage; startup ignores such stages rather than deleting another process's possible live file. These limits do not permit overwriting original HWPX inputs.

## Verification

Linux / Node 24.13.0: 39 settings tests and the final **90 files / 730 passed, 1 skipped**; typecheck, build, synthetic corpus 2/2, existing 11 document workflows and 4 new settings workflows passed. Tests inject partial writes, failed sync and failed promotion, compare exact previous bytes, inspect owned-stage cleanup, verify ordered concurrent patches/readers, shutdown draining, legacy/newer schemas, root/nested privacy filtering and hardlinked input preservation.

Real Electron settings scenarios verify corrupt/partially invalid startup guidance without automatic replacement, explicit repair, legacy migration, 0.5MB and 1-byte precision, invalid limits in both controls, blocked-path save failure and retry. Expected handled IPC errors appear in the smoke log; success requires `desktop-settings-complete` with four completed cases and the final desktop completion marker.

Local Playwright used real pointer/keyboard events with synthetic documents and isolated settings. It captured recovery at 800px and toolbar/modal/save errors at 720px without horizontal page overflow, verified zero page errors and an unchanged input hash, then paused an accepted settings save before writing. Closing the real app drained that save; a fresh process reopened with the saved preference. Captures/ARIA snapshots/checks remain local under `.tmp/ui-audit/settings-2026-10-15/`; no documents or images were uploaded. These are automated synthetic checks, distinct from institutional-PC/Hancom manual acceptance.
