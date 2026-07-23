import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createReportLikeHwpxFixture } from "../../core/test/fixtures.js";

// This test spawns the REAL CLI as an actual child process, the same way
// `npm run cli -- batch ...` launches it: the tsx binary running
// packages/cli/src/index.ts with --conditions=development. That, in turn,
// spawns real worker_threads via WorkerPool (see resolveOptimizeWorkerUrl in
// packages/cli/src/index.ts), which in dev mode load
// packages/cli/src/optimizeWorkerEntry.mjs to register tsx inside the
// worker's own realm before importing optimizeWorker.ts. Unlike the rest of
// the suite (which runs in-process under vitest's own esbuild transform),
// this is the only test that proves the actual dev-mode worker bootstrap
// works end to end in a bare spawn, matching the real user-facing `npm run
// cli -- batch` path.
//
// We invoke the tsx CLI script via `process.execPath` (the same node binary
// currently running this test, guaranteed to be Node 20+ under the project's
// vitest setup) rather than relying on the tsx binary's `#!/usr/bin/env
// node` shebang resolving through PATH, so the child is deterministically
// run with the same Node major version as the test process.
//
// The tsx package location is resolved via Node's own module resolution
// (import.meta.resolve) rather than joined onto process.cwd(): this
// worktree's own node_modules/ does not carry installed dependencies (they
// live in an ancestor checkout), so a naive cwd-based path would miss it.
const tsxCli = fileURLToPath(import.meta.resolve("tsx/cli"));
const cliEntry = join(process.cwd(), "packages", "cli", "src", "index.ts");

let dir: string;
let outDir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cli-batch-child-"));
  outDir = join(dir, "out");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("batch via real child process (dev tsx + worker threads)", () => {
  it("optimizes a folder of two files with --jobs 2", async () => {
    await writeFile(join(dir, "a.hwpx"), await createReportLikeHwpxFixture());
    await writeFile(join(dir, "b.hwpx"), await createReportLikeHwpxFixture());

    const args = [
      tsxCli,
      "--conditions=development",
      cliEntry,
      "batch",
      dir,
      "--mode",
      "safe",
      "--out",
      outDir,
      "--jobs",
      "2"
    ];

    let stdout = "";
    let stderr = "";
    let exitCode = 0;
    try {
      const result = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        execFile(process.execPath, args, { cwd: process.cwd(), timeout: 55_000 }, (error, out, err) => {
          if (error) {
            reject(Object.assign(error, { stdout: out, stderr: err }));
            return;
          }
          resolve({ stdout: out, stderr: err });
        });
      });
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (error) {
      const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number };
      exitCode = typeof err.code === "number" ? err.code : 1;
      stdout = err.stdout ?? "";
      stderr = err.stderr ?? "";
      // Surface the child's real output so a genuine worker-bootstrap
      // failure is diagnosable from the test report, not just "exit 1".
      // eslint-disable-next-line no-console
      console.error("batch child process failed\nstdout:\n" + stdout + "\nstderr:\n" + stderr);
    }

    expect(exitCode, `child exited non-zero; stdout:\n${stdout}\nstderr:\n${stderr}`).toBe(0);

    const outFiles = await readdir(outDir);
    const optimizedFiles = outFiles.filter((f) => f.endsWith(".optimized.hwpx"));
    expect(optimizedFiles.length).toBe(2);

    const report = JSON.parse(await readFile(join(outDir, "batch-report.json"), "utf8"));
    expect(report.totals.optimized).toBe(2);
  }, 60_000);
});
