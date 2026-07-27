# CLI Portable Windows Packaging — Design (v2, post adversarial review)

- Date: 2026-07-24
- Status: v2 (finalized) — rewritten after adversarial review (Grok, repo-grounded). Assembly / output / verification contracts hardened; open decisions resolved (v1 = drag-drop + cmd; launcher reports → temp).
- Goal: ship the HWPX optimizer as a lightweight, offline, **Windows x64** tool that runs on office PCs with **no Node installed**, usable by non-technical staff — without Electron (~217 MB packaged / ~341 MB extracted).

## 1. Problem & Goal

The CLI ([packages/cli/src/index.ts](../../../packages/cli/src/index.ts)) is a
thin wrapper over the pure engine ([packages/core](../../../packages/core/src/));
`batch` is worker-thread parallel (merged). Package the built CLI + a bundled
portable Node + Windows `sharp` into a ZIP with a solid assembly contract and
launchers. Framing (per review): this is a **signed/controlled internal
lightweight CLI ZIP**, not an Electron-replacement GUI.

## 2. Confirmed requirements

- Target: **Windows 10+ x64, no Node installed** → bundle portable Node.
- Users include **non-technical office staff**. Entry points **(v1): drag-and-drop
  `.bat` + command-line `.cmd`**. An interactive numbered menu is **deferred (product follow-up)**
  (fragile `set /p` input; drag-drop + `사용법.txt` covers non-technical use).
- Default mode from launchers: **balanced**, passed explicitly (`--mode balanced`);
  the CLI's own default is `safe` ([index.ts:80,296](../../../packages/cli/src/index.ts)).
- Original files never touched (engine guarantee). Output contract in §6.
- Build (assembly) and runtime verification run on **Windows**.

## 3. Non-goals

- No change to `apps/desktop` or engine behavior/safety.
- Not a single self-contained `.exe`. **B — Node SEA / C — pkg** are rejected not
  merely because `sharp`'s native `.node` can't be embedded, but because ESM +
  `worker_threads` (the batch pool) + native addons make SEA/pkg brittle and
  complex; approach A is also not a single file.
- Runtime stays strictly local. A one-time **build-time** fetch of Node + npm deps
  is allowed, with closed-network overrides (§8).

## 4. Approach A: portable Node ZIP

Ship official `node.exe` + built CLI/core (dist) + a **fully-resolved** Windows
runtime `node_modules` + launchers, in a ZIP. `sharp` loads from a real
`node_modules`.

## 5. ZIP layout + **ESM / dependency contract** (was the #1 review gap)

```
hwpx-opt-win-x64/                          # ASCII folder name (ZIP-tool safe)
  node/node.exe                            # portable Node, pinned version
  app/
    package.json                           # { "type": "module" }  ← REQUIRED
    cli/dist/**  core/dist/**              # built JS only (no *.map, no *.d.ts)
    node_modules/                          # FULL resolved tree (see below)
      @img/sharp-win32-x64/lib/            # .node + libvips-*.dll (self-contained)
      sharp/ jszip/ fast-xml-parser/ + ALL transitive deps
      @hwpx-optimizer/{core,cli}           # workspace packages, each keeps its
                                           # own package.json ("type":"module";
                                           # core also has exports)
  drop-here.bat                            # v1: drag file/folder → optimize/batch
  hwpx-opt.cmd                             # v1: command-line passthrough
  사용법.txt                               # Korean usage (points at drop-here.bat)
  TERMS.txt
  # (interactive menu .bat deferred — product follow-up, not design-doc "v2")
```

Korean UX copy lives in `사용법.txt` and console messages, **not** in ZIP entry
names (avoids CP949/UTF-8 unzip breakage). The drag-drop launcher filename is
ASCII `drop-here.bat`.

**ESM contract (Critical):** every directory that runs `.js` ESM must have a
`package.json` with `"type":"module"`. Both packages are `"type":"module"`
([cli/package.json](../../../packages/cli/package.json),
[core/package.json](../../../packages/core/package.json)); **core** also declares
`exports` — copy these package.json files into the bundle (app root as needed and
`@hwpx-optimizer/*` workspace copies). Boot smoke is defined as **`node.exe
app\cli\dist\index.js optimize <sample> --mode balanced` exiting 0 with output**,
not "a file opened".

**Dependency contract (Critical):** do NOT hand-list packages. `packages/core`
declares no `dependencies` (relies on root hoisting), and the real runtime tree
includes `color`, `detect-libc`, `semver` (sharp), `pako`, `readable-stream`,
`lie` (jszip), `strnum`, `@nodable/entities`, `fast-xml-builder`,
`path-expression-matcher` (fast-xml-parser), etc. — all verified present in root
`node_modules`. Resolve the full tree by generating a staging `package.json` and
running `npm install --prefix <stage> --omit=dev`, then prune only the non-win32
sharp variants. Assert completeness (e.g. `npm ls --all` clean / smoke passes).

Size (measured lower bound, not a target): `node.exe` ~70–80 MB + win32 sharp
~19 MB already ≈ ~97 MB extracted; ZIP ~40–50 MB with no headroom. No UPX.

## 6. Output contract

- Single or multiple dropped **files** → `optimize` → `<name>.optimized.hwpx`
  **beside each original**.
- A dropped **folder** → `batch` → outputs to **`<folder>/optimized/`** (the CLI's
  default, [index.ts:300](../../../packages/cli/src/index.ts)) — documented as such;
  do NOT claim "beside" for folders.
- **Reports:** `optimize` accepts `--report` ([index.ts:91,139](../../../packages/cli/src/index.ts));
  **v1 `drop-here.bat`** passes a unique temp path per file (e.g.
  `%TEMP%\hwpx-opt-<pid>-<n>.report.json`) so user folders/shares are not cluttered.
  `batch` has **no** `--report` flag ([index.ts:140-141](../../../packages/cli/src/index.ts));
  per-file and `batch-report.json` stay inside `<folder>/optimized/` — contained,
  acceptable. `hwpx-opt.cmd` does not rewrite args (CLI defaults apply).

## 7. Launchers

All launchers: `chcp 65001` (scoped), anchor to `set "ROOT=%~dp0"`, quote every
path, clear `NODE_OPTIONS` (so no stray loader leaks into the batch worker),
invoke `"%ROOT%node\node.exe" "%ROOT%app\cli\dist\index.js" <args>`, print
before/after size + saved % (launcher responsibility if CLI summary is thin), and
`pause` at the end (skippable via `HWPX_OPT_NO_PAUSE`) — including `pause` on
error so the window never vanishes.

- **Drag-drop (`drop-here.bat`):** iterate arguments (`%~1` … `shift`),
  detect folder vs file with `if exist "%~1\"`. **Each dropped FILE →
  `optimize --mode balanced --report <temp>`** (output beside it). **Each dropped
  FOLDER → `batch --mode balanced`** (see §6). Multiple files/folders are looped;
  files are never passed to `batch` (the CLI `batch` takes a directory, not a
  file list).
- **Command line (`hwpx-opt.cmd`):** forwards all args unchanged.
- **Interactive menu — deferred** (product follow-up). Drag-drop + `사용법.txt`
  covers the non-technical path in v1.

## 8. Build / assembly (`scripts/build-win-portable.mjs`, on Linux)

1. **Node:** download pinned `node-v<pinned>-win-x64.zip` from nodejs.org **with
   SHASUMS verification**; extract `node.exe`. Closed-network override:
   `--node-zip <path>`.
2. **Build:** `npm run build` → `packages/{core,cli}/dist`.
3. **Runtime tree:** stage a `package.json`; `npm install --prefix <stage>
   --omit=dev` for the full locked tree; **win32 sharp via `npm install --force
   @img/sharp-win32-x64@<ver>`** (plain install fails `EBADPLATFORM` on Linux —
   the existing [prepare-win-sharp-runtime.mjs](../../../scripts/prepare-win-sharp-runtime.mjs)
   already uses `--force`). Copy `@hwpx-optimizer/*` dist + package.json. Prune all
   non-win32 sharp variants and `*.map`/`*.d.ts`. Closed-network: npm cache /
   mirror / vendored tarballs.
4. **Assert native:** `@img/sharp-win32-x64/lib/libvips-42.dll`,
   `libvips-cpp.dll`, and the `sharp-win32-x64.node` exist (reuse the
   [verify-win-native-runtime.mjs](../../../scripts/verify-win-native-runtime.mjs) idea).
5. **Launchers + `사용법.txt` + `TERMS.txt`**, then ZIP to `release/`, and emit a
   **SHA-256 manifest of the whole staged output** (not just Node).
- Add `package.json` script `build:win-portable`.

## 9. Verification (honest about limits)

- **On Linux (this repo, CI-able):** assert ZIP structure + per-file hashes;
  assert win32 sharp DLL/`.node` present and **no** linux sharp variant leaked; no
  `*.map`/`*.d.ts`; static-lint the `.bat`/`.cmd`. Separately, run the **dist JS in
  a host stage that uses the host's linux sharp** (NOT the bundle's win32-only
  `node_modules`, which cannot load on Linux —
  [sharp/lib/sharp.js](../../../node_modules/sharp/lib/sharp.js) requires
  `@img/sharp-${platform}`) to catch JS regressions.
- **On Windows (required to claim support):** a NEW `scripts/cli-portable-smoke.ps1`
  (separate from the Electron `windows-portable-smoke.ps1`) runs `node.exe` +
  each launcher end-to-end over sample HWPX, asserts outputs + `verify` passes
  (mimetype-first). Without this gate, the product is not marked "Windows
  supported." Also check PE imports show UCRT only (no `vcruntime140.dll`),
  consistent with Win10+.

## 10. Distribution & security (was missing)

Unsigned `.bat` + `node.exe` face SmartScreen / AV / group-policy friction (the
Electron path has self-signing + manifest, see docs/SECURITY_REVIEW.md). Plan:
deliver via internal share (not email), publish the SHA-256 manifest, document an
IT unblock/allowlist procedure and Mark-of-the-Web handling, and evaluate reusing
the repo's self-signing for `node.exe`/artifacts. Supported OS stated as
Windows 10+ x64.

## 11. Resolved decisions

1. **Interactive menu:** deferred (product follow-up). v1 ships `drop-here.bat` +
   `hwpx-opt.cmd` + `사용법.txt`.
2. **Launcher report JSON:** `drop-here.bat` `optimize` runs pass unique
   `--report %TEMP%\…`; `batch` reports stay inside `<folder>/optimized/`.
3. **Launcher filename:** ASCII `drop-here.bat`; Korean only in `사용법.txt`.
