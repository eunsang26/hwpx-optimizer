# CLI Portable Windows CI Smoke — Design

- Date: 2026-07-24
- Status: draft (ready for implementation planning)
- Depends on: Linux CLI portable gate already shipped (`.github/workflows/cli-portable-release.yml`). Prefer running **after** sharp 0.35 upgrade so CI exercises patched natives, but not a hard blocker.

## 1. Problem & Goal

Linux CI (`release:check:cli-portable:ci`) proves ZIP **structure**, host JS smoke (Linux sharp), and manifest hygiene. It does **not** execute bundled `node.exe` or win32 `sharp` on Windows.

Product claim “Windows 10+ x64 supported” currently requires a **manual** `release:verify-cli-portable-smoke` (WSL PowerShell or Windows PC), ideally with a private real HWPX.

**Goal:** Add a **GitHub Actions Windows job** that runs the existing CLI portable smoke against a **Linux-built** `hwpx-opt-win-x64.zip`, using a **synthetic minimal HWPX** generated in CI (never commit private samples). Real-sample smoke remains a local/QA optional path.

## 2. Confirmed requirements

- Smoke must run against the **same artifact shape** users get: extract `hwpx-opt-win-x64.zip`, run `node.exe`, `hwpx-opt.cmd`, and when a sample is present `drop-here.bat` file + folder paths (existing `scripts/cli-portable-smoke.ps1`).
- Prefer artifact provenance: **Linux job builds ZIP → Windows job downloads artifact → smoke**. Do not redefine “Linux-assembled” as Windows-built for the primary path.
- CI must **not** require private `sample*.hwpx` or repository secrets for the default green path.
- Synthetic HWPX must be valid enough for `optimize` + `verify` in **balanced** mode (reuse / extract logic from `scripts/verify-cli-portable.mjs` `createMinimalHwpx`).
- Triggers: `workflow_dispatch` (always available) and `v*` tags (same as current CLI portable workflow). Optional: path filters not required for v1.
- Failure of Windows smoke **fails the workflow** on tag builds (product-ready signal). Manual dispatch may use the same strictness.
- Keep sample policy: never commit real HWPX; never upload sample contents as artifacts.

## 3. Non-goals

- Not an Electron portable smoke (`windows-portable-smoke.ps1`).
- Not a full `release:check:win` / installer gate.
- Not MotW / SmartScreen / allowlist automation (document-only; IT process).
- Not requiring Actions secrets for private samples in v1 (optional later enhancement).
- Not interactive menu `.bat` (still deferred product follow-up).

## 4. Approaches considered

| Approach | Description | Trade-off |
| --- | --- | --- |
| **A — Linux build + Windows smoke job (recommended)** | Extend `cli-portable-release.yml`: linux job uploads ZIP; windows job `needs: cli-portable-linux`, downloads artifact, generates synthetic HWPX, runs `release:verify-cli-portable-smoke` | Matches assembly contract; true win32 native load |
| B — Build portable ZIP on `windows-latest` then smoke | Simpler single job | Diverges from “Linux-assembled” primary path; can hide Linux packaging bugs |
| C — Manual-only forever | Status quo | Windows claim stays unenforced in CI |

**Recommendation: A.**

## 5. Workflow shape

```yaml
# conceptual — exact YAML in implementation plan
jobs:
  cli-portable-linux:
    runs-on: ubuntu-latest
    # existing gate; always upload ZIP for downstream smoke (or upload when smoke job will run)
  cli-portable-windows-smoke:
    needs: cli-portable-linux
    runs-on: windows-latest
    steps:
      - checkout (for scripts only)
      - setup Node 20.20.2
      - download artifact hwpx-opt-win-x64 → release/
      - generate synthetic sample → .tmp/ci-smoke/minimal.hwpx
      - HWPX_OPT_SMOKE_INPUT=... npm run release:verify-cli-portable-smoke
```

### Artifact upload policy change

Today Linux upload is gated by tag / `upload_artifact` input. For Approach A, the Windows job **must** receive the ZIP. Options:

1. **Always upload** the ZIP (and checksums) from Linux when the Windows smoke job is enabled (recommended for simplicity; storage cost ~36 MB per run).
2. Or use `actions/upload-artifact` unconditionally for the ZIP used by `needs`, and keep the broader manifest upload behind the existing upload flag.

**Decision:** Always upload at least `release/hwpx-opt-win-x64.zip` (+ zip SHA file) so the Windows job can run on every workflow run. Keep optional upload of full manifest bundle behind `upload_artifact` / tag if desired — but simplest v1 is: upload the same artifact set whenever the Linux job succeeds.

## 6. Synthetic sample contract

- Generator lives in a small shared module, e.g. `scripts/cli-portable/createMinimalHwpx.mjs`, extracted from `verify-cli-portable.mjs`.
- Produces a minimal valid HWPX buffer/file (mimetype + required structure) suitable for optimize/verify.
- Windows smoke sets `HWPX_OPT_SMOKE_INPUT` to that path and `HWPX_OPT_SMOKE_MODE=balanced` (default).
- Without sample, existing smoke only checks launchers — **CI must always pass a sample** so optimize/verify/drop-here paths run.

## 7. Local parity

Document:

```bash
npm run build:win-portable   # or use existing release ZIP
node scripts/cli-portable/writeMinimalHwpx.mjs .tmp/ci-smoke/minimal.hwpx
HWPX_OPT_SMOKE_INPUT=.tmp/ci-smoke/minimal.hwpx npm run release:verify-cli-portable-smoke
```

Real samples remain preferred for QA size/quality confidence.

## 8. Permissions & cost

- `permissions: contents: read` stays sufficient (artifact upload/download within the same workflow).
- Extra ~5–15 minutes on `windows-latest` per run; acceptable for tag + manual dispatch.
- Do not enable on every push to `main` in v1 (too expensive); stick to `workflow_dispatch` + `v*` unless later requested.

## 9. Success criteria

- Tag / dispatch workflow shows green **Linux gate** and green **Windows smoke** with synthetic HWPX.
- Smoke exercises packaged `node.exe`, `hwpx-opt.cmd`, optimize/verify, and `drop-here.bat` paths (script already branches when sample present).
- No private samples in git or Actions artifacts.
- Docs (`RELEASE.md`, `INTERNAL_DISTRIBUTION.md`) state CI Windows smoke ≠ substitute for real-document QA, but is required for “CI-verified Windows runtime” language.

## 10. Risks

- Expand-Archive / path length on Windows runners — use short temp roots (smoke script already uses temp).
- Artifact name/path mismatch between Linux upload and Windows download — pin exact names `hwpx-opt-win-x64.zip`.
- Synthetic doc too trivial to catch sharp failures — still loads win32 sharp on optimize; real samples stay QA.
- Quota: always-upload ZIP increases Actions storage — prefer retention defaults; delete old artifacts via GitHub settings if needed.

## 11. Open decisions (resolved for plan)

1. **Triggers:** `workflow_dispatch` + `v*` only (no push-to-main).
2. **Artifact:** Always upload ZIP from Linux job when Windows smoke job exists.
3. **Sample:** Synthetic only in CI; optional later `repository_dispatch` / secret path out of scope.
