# Task 7 Report: Linux CLI Portable Verifier

## Status

Implemented `scripts/verify-cli-portable.mjs` and wired
`npm run release:verify-cli-portable`.

The verifier:

- accepts `--zip`, `--js-smoke`, and `--no-js-smoke`;
- defaults to `release/hwpx-opt-win-x64.zip` with JS smoke enabled;
- extracts the zip into `.tmp/cli-portable-verify/`;
- runs `verifyCliPortableStage` against the extracted portable root;
- creates an inline minimal HWPX fixture with JSZip; and
- runs the built CLI with the host Node process from the repository root, so
  module resolution uses the repository's Linux `node_modules` rather than the
  portable bundle's Windows dependencies.

## Verification

- `npm run release:verify-cli-portable` — passed, including balanced optimize,
  output creation, and JSON report creation.
- `npm run release:verify-cli-portable -- --no-js-smoke` — passed.
- `node --check scripts/verify-cli-portable.mjs` — passed.
- `npm test -- scripts/cli-portable/verifyStage.test.ts` — could not start
  because the current host is Node `v18.19.1`, while the repository requires
  Node 20+ and the installed Vitest/Rolldown stack imports
  `node:util.styleText`.
