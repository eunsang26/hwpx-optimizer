# Repository Guidelines

## Project Structure & Module Organization

This is a TypeScript npm workspaces monorepo for a local-only HWPX optimizer.

- `packages/core/`: shared HWPX analysis, planning, optimization, verification, and report logic. Keep this package free of filesystem, terminal, and Electron concerns.
- `packages/cli/`: thin CLI wrapper around core APIs. Commands include `analyze`, `report`, `verify`, `optimize`, and `batch`.
- `apps/desktop/`: Electron desktop app. `src/main.ts` owns Electron/IPC, `src/main/desktopService.ts` owns testable file operations, and `src/shared/` contains renderer view-model helpers.
- `docs/`: architecture, testing, release, QA, and limitation notes.
- `scripts/`: release, packaging, icon, and Windows runtime verification helpers.

## Build, Test, and Development Commands

- `npm install`: install workspace dependencies. Use Node.js 20+.
- `npm test`: run all Vitest tests.
- `npm test -- packages/core/test/optimizer.test.ts`: run one targeted test file first while developing.
- `npm run typecheck`: run `tsc -b` across core, CLI, and desktop projects.
- `npm run build`: build all workspaces and copy desktop assets.
- `npm run cli -- analyze input.hwpx`: run the CLI from source through `tsx`.
- `npm run desktop:start`: build and launch Electron locally.
- `npm run desktop:smoke`: run the Electron smoke test; use `xvfb-run -a` in headless Linux.

## Coding Style & Naming Conventions

Use ESM TypeScript with explicit `.js` import suffixes for local modules. Follow the existing style: two-space indentation, double quotes, named exports, and descriptive camelCase function names. Keep core APIs buffer-oriented and side-effect-light. Tests use `*.test.ts` filenames beside each package’s `test/` directory.

## Testing Guidelines

Vitest is the primary test framework. Add focused tests near the changed package: `packages/core/test`, `packages/cli/test`, or `apps/desktop/test`. For behavior changes, run targeted tests first, then `npm test`, `npm run typecheck`, and `npm run build` before committing. Real HWPX samples and generated reports can contain private data; do not commit root-level `sample*.hwpx`, `sample*.hwp`, `sample*.json`, `sample*.txt`, or `결과/`.

## Commit & Pull Request Guidelines

Git history uses Conventional Commit-style subjects such as `feat: ...`, `fix: ...`, `docs: ...`, and `chore: ...`. Keep commits separated by intent and run tests before committing. PRs should include a concise summary, test evidence, linked issue or context, and screenshots or release artifacts only when UI or packaging behavior changes. Push after each commit when working in an agent flow.

## Agent-Specific Instructions

Work on one task per execution. Prefer targeted verification before broad gates. Never overwrite original input documents, and preserve the local-only product constraints: no uploads, telemetry, accounts, or network-dependent optimization paths.
