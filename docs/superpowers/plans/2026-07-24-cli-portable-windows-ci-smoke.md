# CLI Portable Windows CI Smoke Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GitHub Actions `windows-latest` job that smokes the **Linux-built** `hwpx-opt-win-x64.zip` with a **synthetic minimal HWPX**, so Windows runtime support is CI-enforced without committing private samples.

**Architecture:** Keep Linux assembly in `cli-portable-linux`. Always upload the ZIP artifact from that job. Add `cli-portable-windows-smoke` with `needs: cli-portable-linux` that downloads the ZIP into `release/`, writes a synthetic sample via a shared helper extracted from `verify-cli-portable.mjs`, then runs `npm run release:verify-cli-portable-smoke`.

**Tech Stack:** GitHub Actions (`ubuntu-latest` + `windows-latest`), Node 20.20.2, existing `scripts/cli-portable-smoke.ps1` / `run-cli-portable-smoke.mjs`, JSZip-based minimal HWPX writer.

**Spec:** [docs/superpowers/specs/2026-07-24-cli-portable-windows-ci-smoke-design.md](../specs/2026-07-24-cli-portable-windows-ci-smoke-design.md)

**Prerequisite (recommended):** [sharp 0.35 upgrade plan](./2026-07-24-sharp-0.35-upgrade.md) so CI exercises patched natives. Not a hard blocker.

## Global Constraints

- Triggers remain **`workflow_dispatch` + `v*` tags** only (no push-to-main).
- Smoke the **Linux-built** ZIP (download artifact); do not make Windows-built ZIP the primary CI path.
- CI sample is **synthetic only**; never commit or upload private HWPX.
- Reuse existing smoke scripts; extend them only if needed for path/env on Actions.
- Local-only product rules unchanged (no network optimize, no overwrite originals).
- Conventional Commits; Node 20 for local verification.

## File Structure

| Path | Responsibility |
| --- | --- |
| `scripts/cli-portable/createMinimalHwpx.mjs` | Shared minimal HWPX writer (buffer or file) |
| `scripts/cli-portable/writeMinimalHwpx.mjs` | Tiny CLI: `node ... <outPath>` for CI/local |
| `scripts/verify-cli-portable.mjs` | Import shared helper (delete duplicated inline writer) |
| `.github/workflows/cli-portable-release.yml` | Linux upload always for ZIP; Windows smoke job |
| `scripts/cli-portable/smokeScripts.test.ts` | Assert workflow / helper wiring strings |
| `docs/RELEASE.md`, `docs/INTERNAL_DISTRIBUTION.md` | Document CI Windows smoke |

---

### Task 1: Extract shared `createMinimalHwpx` helper

**Files:**
- Create: `scripts/cli-portable/createMinimalHwpx.mjs`
- Create: `scripts/cli-portable/writeMinimalHwpx.mjs`
- Modify: `scripts/verify-cli-portable.mjs`
- Create/Modify: `scripts/cli-portable/createMinimalHwpx.test.ts`

**Interfaces:**
- Produces: `export async function createMinimalHwpxBuffer(): Promise<Buffer>`
- Produces: `export async function writeMinimalHwpxFile(path: string): Promise<void>`
- Consumes: same ZIP entry structure currently used in `verify-cli-portable.mjs` `createMinimalHwpx`

- [ ] **Step 1: Copy current minimal HWPX construction** from `scripts/verify-cli-portable.mjs` into `createMinimalHwpx.mjs` as a pure buffer builder + file writer.

- [ ] **Step 2: Add a focused test** that writes to a temp path and asserts the file starts with ZIP magic `PK` and is > 100 bytes:

```ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeMinimalHwpxFile } from "./createMinimalHwpx.mjs";

it("writes a zip-shaped minimal hwpx", async () => {
  const dir = await mkdtemp(join(tmpdir(), "min-hwpx-"));
  const out = join(dir, "minimal.hwpx");
  await writeMinimalHwpxFile(out);
  const bytes = await readFile(out);
  expect(bytes.subarray(0, 2).toString("utf8")).toBe("PK");
  expect(bytes.length).toBeGreaterThan(100);
});
```

Run: `npm test -- scripts/cli-portable/createMinimalHwpx.test.ts`  
Expected: FAIL until module exists, then PASS.

- [ ] **Step 3: Add `writeMinimalHwpx.mjs` CLI**

```js
import { writeMinimalHwpxFile } from "./createMinimalHwpx.mjs";
const out = process.argv[2];
if (!out) {
  console.error("Usage: node scripts/cli-portable/writeMinimalHwpx.mjs <out.hwpx>");
  process.exit(1);
}
await writeMinimalHwpxFile(out);
console.log(`Wrote ${out}`);
```

- [ ] **Step 4: Point `verify-cli-portable.mjs` at the shared helper**; delete the local duplicate.

- [ ] **Step 5: Regression**

```bash
npm run build:win-portable
npm run release:verify-cli-portable
```

Expected: PASS (host JS smoke still works).

- [ ] **Step 6: Commit**

```bash
git add scripts/cli-portable/createMinimalHwpx.mjs scripts/cli-portable/writeMinimalHwpx.mjs scripts/cli-portable/createMinimalHwpx.test.ts scripts/verify-cli-portable.mjs
git commit -m "$(cat <<'EOF'
refactor: share minimal HWPX helper for CLI portable smoke

EOF
)"
```

---

### Task 2: Workflow — always upload ZIP + Windows smoke job

**Files:**
- Modify: `.github/workflows/cli-portable-release.yml`
- Modify: `scripts/cli-portable/smokeScripts.test.ts` (and/or `repoConfig.test.ts`) to assert job name / key steps exist in the YAML

- [ ] **Step 1: Update Linux upload step** so `release/hwpx-opt-win-x64.zip` (and `.SHA256SUMS.txt`) upload **whenever the Linux job succeeds** (remove the `if:` gate for the ZIP used by smoke). Optional: keep a second upload of full manifest bundle behind `upload_artifact` / tag.

Minimal shape:

```yaml
jobs:
  cli-portable-linux:
    runs-on: ubuntu-latest
    steps:
      # ... existing checkout, setup-node 20.20.2, npm ci, release:check:cli-portable:ci ...
      - name: Upload CLI portable ZIP for Windows smoke
        uses: actions/upload-artifact@v4
        with:
          name: hwpx-opt-win-x64
          path: |
            release/hwpx-opt-win-x64.zip
            release/hwpx-opt-win-x64.SHA256SUMS.txt
          if-no-files-found: error

      - name: Upload full release metadata
        if: github.event_name == 'push' || inputs.upload_artifact == true
        uses: actions/upload-artifact@v4
        with:
          name: hwpx-opt-win-x64-metadata
          path: |
            release/release-manifest.json
            release/SHA256SUMS.txt
            release/RELEASE_NOTICE_*.txt
          if-no-files-found: error

  cli-portable-windows-smoke:
    needs: cli-portable-linux
    runs-on: windows-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: "20.20.2"
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Download CLI portable ZIP
        uses: actions/download-artifact@v4
        with:
          name: hwpx-opt-win-x64
          path: release

      - name: Write synthetic smoke sample
        shell: bash
        run: |
          mkdir -p .tmp/ci-smoke
          node scripts/cli-portable/writeMinimalHwpx.mjs .tmp/ci-smoke/minimal.hwpx

      - name: Run Windows CLI portable smoke
        shell: bash
        env:
          HWPX_OPT_SMOKE_INPUT: .tmp/ci-smoke/minimal.hwpx
          HWPX_OPT_SMOKE_MODE: balanced
        run: npm run release:verify-cli-portable-smoke
```

Note: On `windows-latest`, `bash` is available via GitHub’s Git bash; if PowerShell discovery in `run-cli-portable-smoke.mjs` fails under bash, switch the smoke step to `shell: pwsh` and set env vars accordingly — verify on first CI run.

- [ ] **Step 2: Add YAML string assertions** in `smokeScripts.test.ts`:

```ts
const workflow = await readFile(".github/workflows/cli-portable-release.yml", "utf8");
expect(workflow).toContain("cli-portable-windows-smoke");
expect(workflow).toContain("needs: cli-portable-linux");
expect(workflow).toContain("writeMinimalHwpx.mjs");
expect(workflow).toContain("release:verify-cli-portable-smoke");
```

Run: `npm test -- scripts/cli-portable/smokeScripts.test.ts`  
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/cli-portable-release.yml scripts/cli-portable/smokeScripts.test.ts
git commit -m "$(cat <<'EOF'
ci: add Windows CLI portable smoke against Linux ZIP

EOF
)"
```

---

### Task 3: Docs

**Files:**
- Modify: `docs/RELEASE.md`
- Modify: `docs/INTERNAL_DISTRIBUTION.md`

- [ ] **Step 1: Document** that CI Windows smoke uses a synthetic HWPX; real-document QA remains `HWPX_OPT_SMOKE_INPUT=sample*.hwpx` locally; Linux gate alone is insufficient for Windows support claims once this lands.

- [ ] **Step 2: Commit**

```bash
git add docs/RELEASE.md docs/INTERNAL_DISTRIBUTION.md
git commit -m "$(cat <<'EOF'
docs: document CLI portable Windows CI smoke

EOF
)"
```

---

### Task 4: Manual workflow_dispatch verification

- [ ] **Step 1: Push branch / main and run** Actions → **CLI Portable Windows ZIP** → `workflow_dispatch`.

- [ ] **Step 2: Confirm**
  - `cli-portable-linux` green
  - artifact `hwpx-opt-win-x64` present
  - `cli-portable-windows-smoke` green
  - logs show optimize/verify/`drop-here.bat` (sample path present)

- [ ] **Step 3:** If PowerShell not found under bash shell, fix runner step to `pwsh` in a follow-up commit on the same branch.

- [ ] **Step 4: Stop** after green dispatch (no auto tag release unless user asks).

## Spec coverage checklist

| Spec item | Task |
| --- | --- |
| Shared synthetic HWPX | Task 1 |
| Linux ZIP → Windows smoke | Task 2 |
| Always upload ZIP for smoke | Task 2 |
| Docs / claim language | Task 3 |
| Dispatch verification | Task 4 |
| No private samples | Global Constraints |

## Placeholder scan

None. Shell choice (`bash` vs `pwsh`) is an explicit Task 4 contingency with a concrete fix path.
