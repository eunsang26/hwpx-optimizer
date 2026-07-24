# CLI Portable Windows Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `release/hwpx-opt-win-x64.zip` — a Linux-assembled, offline Windows x64 portable CLI (bundled `node.exe` + built CLI/core + win32 sharp + `drop-here.bat` / `hwpx-opt.cmd`) that office PCs can run without installing Node.

**Architecture:** A Linux build script stages an ASCII-named tree (`hwpx-opt-win-x64/`), downloads a pinned official Node win-x64 zip (SHASUMS-verified) and extracts only `node.exe`, installs a full runtime dependency tree into `app/node_modules` (win32 sharp via `npm install --force`), copies built `@hwpx-optimizer/{cli,core}` dists with their `package.json` (`"type":"module"`), writes launchers that always use `%~dp0` and `--mode balanced`, zips the stage, and emits SHA-256. Linux CI verifies structure + host-sharp JS smoke; Windows claims support only after a separate CLI portable smoke (not the Electron one).

**Tech Stack:** Node 20.20.2 (pin), npm, TypeScript dist of `@hwpx-optimizer/cli` + `core`, `sharp@0.33.5` / `@img/sharp-win32-x64@0.33.5`, Vitest, PowerShell (Windows smoke only).

**Spec:** [docs/superpowers/specs/2026-07-24-cli-portable-packaging-design.md](../specs/2026-07-24-cli-portable-packaging-design.md)

## Global Constraints

- Node ≥ 20.20.0; pin portable runtime to **20.20.2** (match `.node-version`).
- Target OS: **Windows 10+ x64**. No Linux/macOS portable ZIP in this plan.
- Never overwrite original HWPX inputs (engine/CLI already enforce this).
- No engine behavior changes (`packages/core`, optimize modes, verifier). Packaging + launchers + docs/scripts only.
- ZIP entry names for tools: **ASCII** (`drop-here.bat`, `hwpx-opt-win-x64/`). Korean only in `사용법.txt` / console.
- Launchers: `ROOT=%~dp0`, clear `NODE_OPTIONS`, `--mode balanced`, pause-on-error (unless `HWPX_OPT_NO_PAUSE=1`).
- Output: files → beside original via `optimize`; folders → `<folder>/optimized/` via `batch`.
- `drop-here.bat` optimize reports → unique `%TEMP%` paths; batch reports stay under `optimized/`.
- Do not extend `scripts/windows-portable-smoke.ps1` (Electron). New CLI smoke only.
- No UPX / binary packing. Size is a lower-bound observation, not a gate.
- Sample HWPX files are private — never commit `sample*.hwpx`.
- Every task: failing test → fail → implement → pass → commit (Conventional Commits).
- Run tests with Node 20 when available: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20` then `npm test -- <path>`.

## File Structure

| Path | Responsibility |
| --- | --- |
| `scripts/cli-portable/constants.mjs` | Pinned versions, layout names, required native files |
| `scripts/cli-portable/fetchNode.mjs` | Download/verify/extract `node.exe` (or `--node-zip`) |
| `scripts/cli-portable/assembleApp.mjs` | Stage `app/`, npm install tree, `--force` win32 sharp, copy workspace packages, prune |
| `scripts/cli-portable/launchers.mjs` | Generate `drop-here.bat`, `hwpx-opt.cmd`, `사용법.txt` bodies |
| `scripts/cli-portable/verifyStage.mjs` | Assert stage layout / native files / no linux sharp / no maps |
| `scripts/cli-portable/hashTree.mjs` | SHA-256 for files + write `SHA256SUMS.txt` |
| `scripts/build-win-portable.mjs` | Orchestrator: build → stage → zip → `release/` |
| `scripts/verify-cli-portable.mjs` | Post-zip Linux verifier (structure + optional host JS smoke) |
| `scripts/cli-portable-smoke.ps1` | Windows E2E smoke for CLI ZIP (not Electron) |
| `scripts/run-cli-portable-smoke.mjs` | Locate PowerShell / invoke smoke (WSL-aware like Electron runner) |
| `scripts/cli-portable/*.test.ts` | Unit tests for pure helpers (vitest include extended) |
| `package.json` | `build:win-portable`, `release:verify-cli-portable`, `release:verify-cli-portable-smoke` |
| `vitest.config.ts` | Include `scripts/cli-portable/**/*.test.ts` |
| `docs/RELEASE.md`, `docs/INTERNAL_DISTRIBUTION.md`, `docs/KNOWN_LIMITATIONS.md` | Document the new artifact + Windows gate |

---

### Task 1: Constants + vitest include for script unit tests

**Files:**
- Create: `scripts/cli-portable/constants.mjs`
- Create: `scripts/cli-portable/constants.test.ts`
- Modify: `vitest.config.ts`

**Interfaces:**
- Produces: exported constants  
  `NODE_VERSION = "20.20.2"`,  
  `SHARP_VERSION = "0.33.5"`,  
  `SHARP_WIN32_PACKAGE = "@img/sharp-win32-x64@0.33.5"`,  
  `STAGE_DIR_NAME = "hwpx-opt-win-x64"`,  
  `ZIP_NAME = "hwpx-opt-win-x64.zip"`,  
  `REQUIRED_WIN_SHARP_FILES = ["sharp-win32-x64.node","libvips-42.dll","libvips-cpp.dll"]`,  
  `FORBIDDEN_SHARP_DIR_SUBSTRINGS = ["sharp-linux","sharp-libvips-linux","sharp-darwin","sharp-wasm"]`

- [ ] **Step 1: Extend vitest include and write failing test**

`vitest.config.ts`:

```typescript
include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "scripts/cli-portable/**/*.test.ts"],
```

`scripts/cli-portable/constants.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  NODE_VERSION,
  SHARP_VERSION,
  SHARP_WIN32_PACKAGE,
  STAGE_DIR_NAME,
  ZIP_NAME,
  REQUIRED_WIN_SHARP_FILES
} from "./constants.mjs";

describe("cli-portable constants", () => {
  it("pins Node and sharp to the design floors", () => {
    expect(NODE_VERSION).toBe("20.20.2");
    expect(SHARP_VERSION).toBe("0.33.5");
    expect(SHARP_WIN32_PACKAGE).toBe("@img/sharp-win32-x64@0.33.5");
    expect(STAGE_DIR_NAME).toBe("hwpx-opt-win-x64");
    expect(ZIP_NAME).toBe("hwpx-opt-win-x64.zip");
    expect(REQUIRED_WIN_SHARP_FILES).toEqual(
      expect.arrayContaining(["sharp-win32-x64.node", "libvips-42.dll", "libvips-cpp.dll"])
    );
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm test -- scripts/cli-portable/constants.test.ts
```

Expected: FAIL (module not found / export missing).

- [ ] **Step 3: Implement `constants.mjs`**

```javascript
export const NODE_VERSION = "20.20.2";
export const SHARP_VERSION = "0.33.5";
export const SHARP_WIN32_PACKAGE = `@img/sharp-win32-x64@${SHARP_VERSION}`;
export const STAGE_DIR_NAME = "hwpx-opt-win-x64";
export const ZIP_NAME = "hwpx-opt-win-x64.zip";
export const REQUIRED_WIN_SHARP_FILES = [
  "sharp-win32-x64.node",
  "libvips-42.dll",
  "libvips-cpp.dll"
];
export const FORBIDDEN_SHARP_DIR_SUBSTRINGS = [
  "sharp-linux",
  "sharp-libvips-linux",
  "sharp-darwin",
  "sharp-wasm"
];
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npm test -- scripts/cli-portable/constants.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts scripts/cli-portable/constants.mjs scripts/cli-portable/constants.test.ts
git commit -m "$(cat <<'EOF'
chore: add cli-portable pin constants and vitest include

EOF
)"
```

---

### Task 2: Launcher text generators (bat/cmd/사용법)

**Files:**
- Create: `scripts/cli-portable/launchers.mjs`
- Create: `scripts/cli-portable/launchers.test.ts`

**Interfaces:**
- Produces:  
  `renderDropHereBat(): string`  
  `renderHwpxOptCmd(): string`  
  `renderUsageTxt(): string`  
- Contracts encoded in strings (tests assert substrings): `%~dp0`, `NODE_OPTIONS=`, `--mode balanced`, `--report`, `optimize`, `batch`, `drop-here.bat`, `pause`, `HWPX_OPT_NO_PAUSE`, no Korean in bat/cmd filenames referenced as ZIP entries (bat body may print Korean).

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from "vitest";
import { renderDropHereBat, renderHwpxOptCmd, renderUsageTxt } from "./launchers.mjs";

describe("cli-portable launchers", () => {
  it("drop-here.bat anchors to %~dp0, clears NODE_OPTIONS, uses balanced + temp report", () => {
    const bat = renderDropHereBat();
    expect(bat).toContain('set "ROOT=%~dp0"');
    expect(bat).toMatch(/set\s+"?NODE_OPTIONS=/i);
    expect(bat).toContain("--mode balanced");
    expect(bat).toContain("optimize");
    expect(bat).toContain("batch");
    expect(bat).toContain("--report");
    expect(bat).toContain("%TEMP%");
    expect(bat).toContain("pause");
    expect(bat).toContain("HWPX_OPT_NO_PAUSE");
    expect(bat).toContain('if exist "%~1\\"');
    expect(bat).toContain("node\\node.exe");
    expect(bat).toContain("app\\cli\\dist\\index.js");
    // Must not shell out via relative node without ROOT
    expect(bat).not.toMatch(/(?<!%)node\\node\.exe/);
  });

  it("hwpx-opt.cmd forwards args via ROOT node", () => {
    const cmd = renderHwpxOptCmd();
    expect(cmd).toContain('set "ROOT=%~dp0"');
    expect(cmd).toContain("%*");
    expect(cmd).toContain("app\\cli\\dist\\index.js");
  });

  it("사용법.txt documents drop-here.bat, modes, and output locations", () => {
    const txt = renderUsageTxt();
    expect(txt).toContain("drop-here.bat");
    expect(txt).toContain("hwpx-opt.cmd");
    expect(txt).toContain("balanced");
    expect(txt).toContain("optimized");
    expect(txt).toContain(".optimized.hwpx");
  });
});
```

Note: if the negative lookbehind regex is awkward in the test runner, replace the last expect with: every `node\node.exe` occurrence is preceded by `%ROOT%`.

- [ ] **Step 2: Run — expect FAIL**

```bash
npm test -- scripts/cli-portable/launchers.test.ts
```

- [ ] **Step 3: Implement `launchers.mjs`**

`renderDropHereBat()` must implement (exact control flow; CRLF line endings `\r\n`):

```bat
@echo off
setlocal EnableExtensions
chcp 65001 >nul
set "ROOT=%~dp0"
set "NODE_OPTIONS="
set "CLI=%ROOT%app\cli\dist\index.js"
set "NODE=%ROOT%node\node.exe"
if not exist "%NODE%" (
  echo [오류] node.exe 가 없습니다: %NODE%
  goto :end
)
if not exist "%CLI%" (
  echo [오류] CLI 가 없습니다: %CLI%
  goto :end
)
if "%~1"=="" (
  echo 사용법: HWPX 파일 또는 폴더를 이 배치 파일에 끌어다 놓으세요.
  goto :end
)
set /a N=0
:loop
if "%~1"=="" goto :done
set /a N+=1
if exist "%~1\" (
  echo.
  echo === 폴더 배치: %~1 ===
  "%NODE%" "%CLI%" batch "%~1" --mode balanced
  if errorlevel 1 set "FAILED=1"
) else (
  echo.
  echo === 파일 최적화: %~1 ===
  set "RPT=%TEMP%\hwpx-opt-%RANDOM%-%N%.report.json"
  "%NODE%" "%CLI%" optimize "%~1" --mode balanced --report "%RPT%"
  if errorlevel 1 set "FAILED=1"
)
shift
goto :loop
:done
if defined FAILED exit /b 1
:end
if /i "%HWPX_OPT_NO_PAUSE%"=="1" goto :eof
echo.
pause
```

`renderHwpxOptCmd()`:

```bat
@echo off
setlocal EnableExtensions
chcp 65001 >nul
set "ROOT=%~dp0"
set "NODE_OPTIONS="
"%ROOT%node\node.exe" "%ROOT%app\cli\dist\index.js" %*
set "EC=%ERRORLEVEL%"
if /i "%HWPX_OPT_NO_PAUSE%"=="1" exit /b %EC%
if not "%EC%"=="0" pause
exit /b %EC%
```

`renderUsageTxt()` — Korean paragraphs covering: double-click/drag onto `drop-here.bat`; file → beside original; folder → `optimized\`; default balanced; `hwpx-opt.cmd` needs explicit `--mode` (CLI default is safe); original never overwritten; Windows 10+ x64; no network; SmartScreen/IT allowlist tip; point at `TERMS.txt`.

Export all three functions from `launchers.mjs`.

- [ ] **Step 4: Run — expect PASS**

```bash
npm test -- scripts/cli-portable/launchers.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add scripts/cli-portable/launchers.mjs scripts/cli-portable/launchers.test.ts
git commit -m "$(cat <<'EOF'
feat: add cli-portable launcher and usage text generators

EOF
)"
```

---

### Task 3: Stage verifier (structure / native / prune rules)

**Files:**
- Create: `scripts/cli-portable/verifyStage.mjs`
- Create: `scripts/cli-portable/verifyStage.test.ts`

**Interfaces:**
- Produces: `export async function verifyCliPortableStage(stageRoot: string): Promise<void>`  
  Throws `Error` with actionable message on any failure.
- Checks (all required):
  1. `stageRoot/node/node.exe` exists, size > 1_000_000
  2. `stageRoot/app/package.json` parses and `type === "module"`
  3. `stageRoot/app/cli/dist/index.js` and `optimizeWorker.js` exist
  4. `stageRoot/app/core/dist` has at least one `.js`
  5. `stageRoot/app/node_modules/@hwpx-optimizer/core/package.json` has `type === "module"`
  6. `stageRoot/app/node_modules/@hwpx-optimizer/cli/package.json` has `type === "module"`
  7. Each of `REQUIRED_WIN_SHARP_FILES` exists under `app/node_modules/@img/sharp-win32-x64/lib/`
  8. Walk `app/node_modules/@img`: no directory name containing any `FORBIDDEN_SHARP_DIR_SUBSTRINGS`
  9. No `*.map` / `*.d.ts` under `app/cli/dist` or `app/core/dist`
  10. `drop-here.bat`, `hwpx-opt.cmd`, `사용법.txt`, `TERMS.txt` exist at stage root
  11. Bat contains `set "ROOT=%~dp0"` and `--mode balanced`

- [ ] **Step 1: Write failing test** that builds a minimal fake stage under `os.tmpdir()`, calls `verifyCliPortableStage`, expects throw; then a second case with all required stubs expects resolve.

Use `mkdtemp` + write minimal files (empty `node.exe` of 1_000_001 zero bytes, stub package.json files, stub dll/node names as empty files, write bat from `renderDropHereBat()`).

- [ ] **Step 2: Run — expect FAIL** (module missing)

```bash
npm test -- scripts/cli-portable/verifyStage.test.ts
```

- [ ] **Step 3: Implement `verifyStage.mjs`** with `fs/promises` + recursive `@img` walk.

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add scripts/cli-portable/verifyStage.mjs scripts/cli-portable/verifyStage.test.ts
git commit -m "$(cat <<'EOF'
feat: add cli-portable stage layout verifier

EOF
)"
```

---

### Task 4: Fetch pinned Node win-x64 (`node.exe` only)

**Files:**
- Create: `scripts/cli-portable/fetchNode.mjs`
- Create: `scripts/cli-portable/fetchNode.test.ts`

**Interfaces:**
- Produces:  
  `export function nodeDistUrls(version: string): { zipUrl: string; shasumsUrl: string }`  
  `export function parseSha256Sums(text: string, zipFileName: string): string`  
  `export async function ensureNodeExe(options: { version: string; cacheDir: string; outExePath: string; nodeZipPath?: string; fetchImpl?: typeof fetch }): Promise<void>`
- Behavior:
  - If `nodeZipPath` set: use that zip (closed-network); still verify against SHASUMS if `cacheDir/SHASUMS256.txt` present OR download SHASUMS when online; if neither available, hash the local zip into a sidecar and warn via `console.warn` once — **prefer**: require SHASUMS file beside local zip named `SHASUMS256.txt` or fail. Spec: integrity required → **fail if no SHASUMS for local zip**.
  - Else: download `https://nodejs.org/dist/v{ver}/node-v{ver}-win-x64.zip` and `SHASUMS256.txt`, verify lowercase hex sha256 of zip bytes, extract **only** `node.exe` (path inside zip is `node-v{ver}-win-x64/node.exe`) to `outExePath`.
  - Use `node:crypto createHash("sha256")`, `node:fs`, and `yauzl`/`extract-zip`/`jszip` — **prefer JSZip already in repo** to read the zip buffer and write `node.exe`.

- [ ] **Step 1: Unit tests (no network)**

```typescript
import { describe, expect, it } from "vitest";
import { nodeDistUrls, parseSha256Sums } from "./fetchNode.mjs";

describe("fetchNode helpers", () => {
  it("builds official dist URLs", () => {
    const u = nodeDistUrls("20.20.2");
    expect(u.zipUrl).toBe("https://nodejs.org/dist/v20.20.2/node-v20.20.2-win-x64.zip");
    expect(u.shasumsUrl).toBe("https://nodejs.org/dist/v20.20.2/SHASUMS256.txt");
  });

  it("parses SHASUMS256 lines", () => {
    const text = [
      "aaaa node-v20.20.2-linux-x64.tar.gz",
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb  node-v20.20.2-win-x64.zip",
      ""
    ].join("\n");
    expect(parseSha256Sums(text, "node-v20.20.2-win-x64.zip")).toBe(
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    );
  });
});
```

Add a test for `ensureNodeExe` with a tiny hand-built zip (JSZip: file `node-v20.20.2-win-x64/node.exe` with contents `MZ-fake` padded — note verifyStage wants >1MB for real builds; for unit test of ensureNodeExe only check file written). Mock `fetchImpl` to return SHASUMS + zip bytes; compute expected hash with crypto.

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `fetchNode.mjs`**

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add scripts/cli-portable/fetchNode.mjs scripts/cli-portable/fetchNode.test.ts
git commit -m "$(cat <<'EOF'
feat: add pinned Node win-x64 fetch with SHASUMS verify

EOF
)"
```

---

### Task 5: Assemble `app/` runtime tree (deps + win32 sharp + workspace packages)

**Files:**
- Create: `scripts/cli-portable/assembleApp.mjs`
- Create: `scripts/cli-portable/assembleApp.test.ts`
- Reuse pattern from: `scripts/prepare-win-sharp-runtime.mjs`

**Interfaces:**
- Produces:  
  `export function buildStagingPackageJson(versions: { sharp: string; jszip: string; fastXmlParser: string }): object`  
  `export async function assembleApp(options: { repoRoot: string; appRoot: string; npmCacheDir: string }): Promise<void>`
- `assembleApp` steps:
  1. `rm` + `mkdir` `appRoot`
  2. Write `appRoot/package.json` = `{ name: "hwpx-opt-portable-app", private: true, type: "module", dependencies: { sharp, jszip, "fast-xml-parser" } }` with **exact versions read from root `package-lock.json`** (or `package.json` resolved); helper `readRootRuntimeVersions(repoRoot)` returns pinned strings.
  3. `npm install --prefix appRoot --omit=dev --ignore-scripts --no-audit --no-fund --cache npmCacheDir` (do **not** use `--force` here).
  4. `npm install --prefix appRoot --force --omit=dev --ignore-scripts --no-audit --no-fund --no-package-lock --cache npmCacheDir @img/sharp-win32-x64@0.33.5` (same flags spirit as prepare-win-sharp-runtime).
  5. Copy `packages/cli/dist` → `appRoot/cli/dist` (js only: skip `.map`/`.d.ts` while copying).
  6. Copy `packages/cli/package.json` → `appRoot/cli/package.json` and also to `appRoot/node_modules/@hwpx-optimizer/cli/package.json` with `main`/`bin` pointing at reachable dist; simplest layout matching the spec:

     ```
     app/
       package.json
       cli/dist/**  cli/package.json
       core/dist/**  core/package.json
       node_modules/
         @hwpx-optimizer/cli/  → package.json whose "main" is ../../cli/dist/index.js
                                OR copy dist into node_modules package
         @hwpx-optimizer/core/ → same
     ```

     **Preferred (resolution-safe):** copy full package contents into `node_modules/@hwpx-optimizer/{cli,core}/` (`package.json` + `dist/**/*.js` only), **and** also keep `app/cli/dist` + `app/core/dist` as the launcher entry (`app\cli\dist\index.js`) so launcher path matches the spec. Duplicate dist is OK for v1 (simpler than symlinks on Windows).

  7. Prune: delete any `appRoot/node_modules/@img/*` dir whose name matches forbidden substrings; delete `**/*.map` / `**/*.d.ts` under `appRoot/cli` and `appRoot/core` and under `@hwpx-optimizer/*`.
  8. Do not leave `tsx` or `vitest` in the stage.

- [ ] **Step 1: Unit-test `buildStagingPackageJson` + `readRootRuntimeVersions`** (read from a fixture package.json / lock snippet in the test temp dir). Do **not** run full `npm install` in unit tests (slow/network). Optionally mark an integration test `it.skip` or gate with `process.env.HWPX_OPT_PORTABLE_INTEGRATION=1`.

- [ ] **Step 2: Run unit tests — FAIL then implement helpers — PASS**

- [ ] **Step 3: Implement full `assembleApp`**

- [ ] **Step 4: Manual integration once (implementer machine with network)**

```bash
npm run build
node -e "import { assembleApp } from './scripts/cli-portable/assembleApp.mjs'; ..."
# or invoke via partial orchestrator later
```

Verify `app/node_modules/@img/sharp-win32-x64/lib/libvips-42.dll` exists and no `sharp-linux-x64` under `@img`.

- [ ] **Step 5: Commit**

```bash
git add scripts/cli-portable/assembleApp.mjs scripts/cli-portable/assembleApp.test.ts
git commit -m "$(cat <<'EOF'
feat: assemble cli-portable app tree with win32 sharp

EOF
)"
```

---

### Task 6: Hash helper + orchestrator `build-win-portable.mjs`

**Files:**
- Create: `scripts/cli-portable/hashTree.mjs`
- Create: `scripts/cli-portable/hashTree.test.ts`
- Create: `scripts/build-win-portable.mjs`
- Modify: `package.json` (scripts)
- Copy: root `TERMS.txt` into stage

**Interfaces:**
- `export async function writeSha256Sums(rootDir: string, outFile: string): Promise<void>` — relative posix paths, `sha256  filename` lines sorted.
- `build-win-portable.mjs` CLI:
  - Args: `--node-zip <path>` optional; `--skip-build` optional (use existing dist); `--out-dir` default `release`.
  - Env: `HWPX_OPT_NODE_ZIP` same as `--node-zip`.
  - Flow:
    1. Unless `--skip-build`: `npm run build` via `spawnSync` (stdio inherit).
    2. `stage = .tmp/cli-portable-stage/hwpx-opt-win-x64` — wipe and recreate.
    3. `ensureNodeExe` → `stage/node/node.exe`.
    4. `assembleApp({ repoRoot, appRoot: stage/app, npmCacheDir: .npm-cache/cli-portable })`.
    5. Write launchers + `사용법.txt` via `launchers.mjs`; copy `TERMS.txt`.
    6. `verifyCliPortableStage(stage)`.
    7. Zip `stage` so archive root is `hwpx-opt-win-x64/` (use JSZip or `spawnSync("zip", ...)` — prefer pure JSZip walking files for portability).
    8. Write `release/hwpx-opt-win-x64.zip` + `release/hwpx-opt-win-x64.SHA256SUMS.txt` (sums for zip + optional staged file list).

`package.json` scripts:

```json
"build:win-portable": "node scripts/build-win-portable.mjs",
"release:verify-cli-portable": "node scripts/verify-cli-portable.mjs"
```

- [ ] **Step 1: Test `writeSha256Sums`** with a temp dir of two small files — assert output format and sort order.

- [ ] **Step 2: Implement hashTree + orchestrator**

- [ ] **Step 3: Run unit tests PASS; run full assemble once**

```bash
npm run build:win-portable
ls -la release/hwpx-opt-win-x64.zip
```

Expected: zip exists; unzip -l shows `hwpx-opt-win-x64/node/node.exe`, `drop-here.bat`, `app/cli/dist/index.js`, win32 sharp libs.

- [ ] **Step 4: Commit**

```bash
git add scripts/cli-portable/hashTree.mjs scripts/cli-portable/hashTree.test.ts scripts/build-win-portable.mjs package.json
git commit -m "$(cat <<'EOF'
feat: add build:win-portable orchestrator and SHA256 sums

EOF
)"
```

---

### Task 7: Linux post-build verifier + host-sharp JS smoke

**Files:**
- Create: `scripts/verify-cli-portable.mjs`

**Interfaces:**
- CLI: `node scripts/verify-cli-portable.mjs [--zip release/hwpx-opt-win-x64.zip] [--js-smoke]`
- Always: unzip to `.tmp/cli-portable-verify/`, run `verifyCliPortableStage` on extracted root.
- With `--js-smoke` (default **on** for local; can `--no-js-smoke`): **do not** use the zip’s win32 `node_modules`. Instead run host:

```bash
node packages/cli/dist/index.js optimize <fixture> --mode balanced --out <tmpdir>/out.hwpx --report <tmpdir>/r.json
```

Use `packages/core/test` fixture via a tiny generated HWPX written by the script (reuse `createHwpxFixture` from a small inline buffer, or call existing test helper through a one-off import — if importing TS fixtures is hard from mjs, shell out to `npm test -- packages/cli/test/cli.test.ts -t "..."` is **wrong**. Prefer: write a minimal valid HWPX with JSZip inside `verify-cli-portable.mjs` mirroring `createHwpxFixture` fields, or invoke:

```bash
npx tsx -e 'import { createHwpxFixture } from "./packages/core/test/fixtures.ts"; ...'
```

Simplest robust approach: `--js-smoke` runs `npm test -- packages/cli/test/cli.test.ts` only if already green area — **better:** spawn `node --import tsx` script that imports `optimizeByMode` + fixture. Keep smoke inside `verify-cli-portable.mjs` using dynamic `import` of built `packages/cli/dist` + built core against **host** `node_modules/sharp` (cwd = repo root).

Concrete js-smoke:

```javascript
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
// Use host resolution from repo root:
const { runCli } = await import(pathToFileURL(join(repoRoot, "packages/cli/dist/index.js")).href);
// Build minimal hwpx with JSZip (copy minimal structure from fixtures — inline 1x1 png)
const code = await runCli(["optimize", inputPath, "--mode", "balanced", "--out", outPath, "--report", reportPath]);
if (code !== 0) throw new Error("js-smoke optimize failed");
```

- [ ] **Step 1: Implement verifier script**

- [ ] **Step 2: Run after a built zip**

```bash
npm run build:win-portable
npm run release:verify-cli-portable
```

Expected: prints OK; js-smoke optimize exit 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-cli-portable.mjs package.json
git commit -m "$(cat <<'EOF'
feat: add Linux cli-portable zip verifier and host JS smoke

EOF
)"
```

---

### Task 8: Windows CLI portable smoke (separate from Electron)

**Files:**
- Create: `scripts/cli-portable-smoke.ps1`
- Create: `scripts/run-cli-portable-smoke.mjs`
- Modify: `package.json` — add `"release:verify-cli-portable-smoke": "node scripts/run-cli-portable-smoke.mjs"`

**Interfaces:**
- `cli-portable-smoke.ps1` params: `-ZipPath`, `-Sample` (optional HWPX), `-Mode` default `balanced`
- Steps:
  1. Expand zip to a temp dir under `%TEMP%\hwpx-cli-portable-smoke-*`
  2. Set `HWPX_OPT_NO_PAUSE=1`
  3. Copy sample into temp (or generate — if no sample, skip file optimize and only run `hwpx-opt.cmd list-actions` + expect exit 0; if sample provided, run full path)
  4. Run: `& "$root\node\node.exe" "$root\app\cli\dist\index.js" optimize $sample --mode balanced --report $env:TEMP\smoke.report.json`
  5. Assert `*.optimized.hwpx` exists beside sample copy; run `verify` on it
  6. Run `hwpx-opt.cmd list-actions` (or optimize) via cmd.exe
  7. If sample dir test desired: create folder with one hwpx, run batch, assert `optimized\` output
  8. Exit non-zero on failure
- `run-cli-portable-smoke.mjs`: mirror `run-windows-portable-smoke.mjs` PowerShell discovery / WSL `wslpath`, but point at `release/hwpx-opt-win-x64.zip` and `cli-portable-smoke.ps1`. If PowerShell missing, exit with clear message: `Windows PowerShell required; CLI portable Windows support not verified.`

- [ ] **Step 1: Implement ps1 + runner**

- [ ] **Step 2: On Linux/WSL without Windows, runner should fail gracefully** (non-zero + message) — document that this is expected; do not wire into Linux-only CI gate yet.

- [ ] **Step 3: On a Windows host (or WSL→Windows PowerShell), run**

```powershell
npm run build:win-portable
npm run release:verify-cli-portable-smoke
# with sample:
$env:HWPX_OPT_SMOKE_INPUT="C:\path\to\sample.hwpx"
npm run release:verify-cli-portable-smoke
```

- [ ] **Step 4: Commit**

```bash
git add scripts/cli-portable-smoke.ps1 scripts/run-cli-portable-smoke.mjs package.json
git commit -m "$(cat <<'EOF'
feat: add Windows cli-portable smoke scripts

EOF
)"
```

---

### Task 9: Docs — release / distribution / limitations

**Files:**
- Modify: `docs/RELEASE.md`
- Modify: `docs/INTERNAL_DISTRIBUTION.md`
- Modify: `docs/KNOWN_LIMITATIONS.md`
- Modify: `docs/superpowers/specs/2026-07-24-cli-portable-packaging-design.md` §2 line “deferred to v2” → “deferred (product follow-up)” for consistency with §11 (one-line fix)

**Content to add (concise):**

`RELEASE.md`:
- Section “CLI portable Windows ZIP”: `npm run build:win-portable` → `release/hwpx-opt-win-x64.zip`
- Verify: `npm run release:verify-cli-portable`
- Windows support claim requires: `npm run release:verify-cli-portable-smoke`
- Closed-network: `--node-zip` / `HWPX_OPT_NODE_ZIP` + npm cache

`INTERNAL_DISTRIBUTION.md`:
- Prefer internal share (not email)
- Publish SHA256 from `hwpx-opt-win-x64.SHA256SUMS.txt`
- MotW / SmartScreen / IT allowlist note for unsigned `node.exe` + `.bat`
- Win10+ x64 only

`KNOWN_LIMITATIONS.md`:
- CLI portable is not a single EXE; requires extracted folder
- Windows smoke is separate from Electron portable smoke
- Folder batch outputs to `optimized\` subfolder
- Interactive menu not included

- [ ] **Step 1: Edit the three docs + one-line spec consistency fix**

- [ ] **Step 2: Commit**

```bash
git add docs/RELEASE.md docs/INTERNAL_DISTRIBUTION.md docs/KNOWN_LIMITATIONS.md docs/superpowers/specs/2026-07-24-cli-portable-packaging-design.md
git commit -m "$(cat <<'EOF'
docs: document cli-portable Windows ZIP build and gates

EOF
)"
```

---

### Task 10: End-to-end gate dry-run (Linux) + checklist

**Files:** none new (runbook)

- [ ] **Step 1: Full Linux path**

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20
npm test -- scripts/cli-portable
npm run build:win-portable
npm run release:verify-cli-portable
```

Expected: all pass; zip in `release/`.

- [ ] **Step 2: Record artifact stats in the commit message or a local note (do not commit samples)**

```bash
ls -lh release/hwpx-opt-win-x64.zip
unzip -l release/hwpx-opt-win-x64.zip | head
```

- [ ] **Step 3: Spec coverage checklist (implementer ticks)**

| Spec item | Task |
| --- | --- |
| Portable Node pin + SHASUMS / `--node-zip` | 4, 6 |
| Full deps tree + `--force` win32 sharp | 5 |
| ESM package.json in stage | 5, 3 |
| `drop-here.bat` / `hwpx-opt.cmd` / `사용법.txt` / `TERMS.txt` | 2, 6 |
| Output contract file vs folder | 2 (launcher), engine unchanged |
| Temp reports for optimize | 2 |
| Linux verify ≠ win32 load | 7 |
| Windows CLI smoke ≠ Electron | 8 |
| Distribution / MotW docs | 9 |
| No SEA/pkg/Tauri / no menu | n/a (non-goals) |

- [ ] **Step 4: Final commit only if docs/scripts tweaks remained; else stop**

---

## Spec coverage (plan self-review)

| Spec section | Covered by |
| --- | --- |
| §2 Win10+ / balanced launchers / Linux assemble | Tasks 2, 4–6, 9 |
| §3 non-goals (no engine/desktop/tauri/SEA) | Global constraints |
| §5 layout + ESM + deps + ASCII names | Tasks 1–3, 5–6 |
| §6 output + reports | Task 2 |
| §7 launchers | Task 2 |
| §8 build script | Tasks 4–6 |
| §9 verification | Tasks 3, 7, 8 |
| §10 distribution | Task 9 |
| §11 decisions | Tasks 2, 9 |

**Placeholders:** none intended. Windows smoke cannot be fully executed on Linux — Task 8 documents graceful failure; support claim waits for a Windows run.

**Type consistency:** `verifyCliPortableStage(stageRoot)`, `ensureNodeExe(...)`, `assembleApp(...)`, `renderDropHereBat()` names are stable across tasks.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-24-cli-portable-packaging.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — execute tasks in this session with executing-plans checkpoints  

Which approach?
