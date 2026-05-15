# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Local HWPX document size optimizer. Core engine, CLI, and Electron desktop app share the same TypeScript code in an npm workspaces monorepo. Strict local-only: no network upload, no telemetry, no account, never overwrites the original input.

## Commands

```bash
npm install                                  # Install (Node 20+)
npm test                                     # Run all vitest tests
npm test -- packages/core/test/optimizer.test.ts   # Single test file
npm run typecheck                            # tsc -b across workspaces
npm run build                                # Build core, cli, desktop, copy desktop assets
npm run cli -- <subcommand> ...              # Run CLI from source via tsx
npm run desktop:start                        # Build then launch Electron
npm run desktop:smoke                        # Headless smoke (use `xvfb-run -a` on Linux headless)
```

CLI subcommands (see [packages/cli/src/index.ts](packages/cli/src/index.ts)): `analyze`, `report`, `verify`, `optimize`, `batch`. `optimize --mode safe|balanced|aggressive`, `--actions a,b,c` to pick advanced ops, `--report path` for JSON output.

Desktop smoke test env: `HWPX_OPT_SMOKE_INPUT=path/to.hwpx` copies a real local file into `.tmp/electron-smoke`; `HWPX_OPT_SMOKE_MODE=safe|balanced|aggressive`.

Pre-commit gate: `npm test && npm run typecheck && npm run build`.

Release verification (no Windows machine needed for portable check): `npm run release:check:win-portable`. Full Windows installer gate (`release:check:win`) must run on a Windows runner.

## Architecture

Pipeline (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)):

```
input.hwpx
  → reader.ts (open ZIP, validate min HWPX structure, classify entries)
  → analyzer.ts (size/category/image inventory, BMP/dup/oversize detection)
  → imageDisplay.ts (manifest-derived display pixel budgets)
  → referenceGraph.ts (which BinData is actually referenced by XML)
  → planner.ts | opportunities.ts (mode-specific action plan)
  → optimizer.ts | balancedOptimizer.ts (mutate buffers, never input file)
  → writer.ts (repackage, DEFLATE 9)
  → verifier.ts (mode-aware structural + perceptual-hash gate)
  → report.ts (JSON report)
```

Three optimizer modes share infrastructure but differ in policy:
- **safe** ([optimizer.ts](packages/core/src/optimizer.ts)): XML minify, JPEG metadata strip, lossless PNG, drop unreferenced BinData. No resize, no quality loss, no format change.
- **balanced** / **aggressive** ([balancedOptimizer.ts](packages/core/src/balancedOptimizer.ts), [opportunities.ts](packages/core/src/opportunities.ts)): BMP/TIFF→PNG, oversized JPEG/PNG resize against display budget, JPEG metadata strip, JPEG quality (~88 / ~80), PNG palette, dup-image consolidation by manifest `href`/`media-type` rewrite.

Verifier ([verifier.ts](packages/core/src/verifier.ts)) enforces per-mode invariants and rejects advanced outputs whose preview PSNR falls below the mode threshold (balanced 18 dB, aggressive 14 dB) using [imagePreview.ts](packages/core/src/imagePreview.ts). It also enforces format transitions (BMP/TIFF→PNG, JPEG→JPEG, PNG→PNG) and rejects enlargement.

Reader ([reader.ts](packages/core/src/reader.ts)) hardens against zip-slip: rejects entries with `..`, `.`, drive letters, leading slash, or empty segments. It also rejects legacy binary HWP with a clear message.

### Boundaries

- [packages/core](packages/core/src/) is the single source of HWPX logic — no filesystem or terminal I/O lives here.
- [packages/cli/src/index.ts](packages/cli/src/index.ts) is a thin filesystem + stdout wrapper.
- [apps/desktop/src/main/desktopService.ts](apps/desktop/src/main/desktopService.ts) is the testable boundary for desktop file operations (analysis call, output path selection, no-overwrite naming, report saving).
- [apps/desktop/src/main.ts](apps/desktop/src/main.ts) owns Electron main + IPC. [apps/desktop/src/preload.cjs](apps/desktop/src/preload.cjs) is the runtime preload (ESM package, so a CJS preload is required); [apps/desktop/src/preload.ts](apps/desktop/src/preload.ts) defines the API shape.
- Analysis and optimization run in a persistent Node worker thread via [apps/desktop/src/main/documentWorker.ts](apps/desktop/src/main/documentWorker.ts) so the Electron main process stays responsive; main relays progress and can terminate the active document operation on cancel.

## Safety rules (do not violate)

- Never overwrite the original input file. Every path writes a new buffer/file.
- Do not delete a referenced resource. Verify the reference graph first.
- If verification fails, do not produce an output.
- Safe mode must remain free of: image resize, JPEG quality reduction, BMP conversion, font/OLE changes, layout recalculation. If a safe action is uncertain, skip it and record a warning instead.
- Advanced mode format changes are constrained to: BMP/TIFF→PNG only, JPEG stays JPEG, PNG stays PNG, and pixel dimensions never grow.

## Sample file policy

Real HWPX/HWP and their reports may contain private data. The repo ignores root-level `sample*.hwpx`, `sample*.hwp`, `sample*.json`, `sample*.txt`, and `결과/`. Do not commit them, even if accidentally staged.

## Windows packaging notes

`sharp` Windows native runtime must be unpacked outside `app.asar` — handled by [scripts/prepare-win-sharp-runtime.mjs](scripts/prepare-win-sharp-runtime.mjs) and verified by `release:verify-win-native`. Linux sharp variants are excluded from Windows packages. ZIP is the preferred Windows artifact for faster startup; single portable EXE self-extracts each launch.
