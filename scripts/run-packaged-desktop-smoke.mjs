import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";

if (process.platform !== "win32") throw new Error("Packaged desktop smoke requires Windows; it cannot be skipped as a passing test.");
const executable = resolve(process.argv[2] ?? "release/win-unpacked/HWPX Optimizer.exe");
if (!(await stat(executable)).isFile()) throw new Error(`Packaged desktop executable is missing: ${executable}`);
if (!(await stat(join(dirname(executable), "resources/app.asar"))).isFile()) throw new Error("Expected an unpacked app directory containing resources/app.asar.");

const preflight = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
  resolve("scripts/assert-no-system-pretendard.ps1")], { encoding: "utf8", timeout: 30_000 });
process.stdout.write(preflight.stdout ?? ""); process.stderr.write(preflight.stderr ?? "");
if (preflight.error) throw preflight.error;
if (preflight.status !== 0) throw new Error(`Clean font preflight failed (${preflight.status}).`);

// Copy outside the checkout so missing dependencies cannot resolve from its node_modules.
// Fresh cwd also creates a fresh userData/cache; the source app directory is unchanged.
// Resolve Windows 8.3 TEMP aliases before launching Chromium/ASAR file loading.
const workspace = await realpath(await mkdtemp(join(tmpdir(), "hwpx-packaged-smoke-")));
const isolatedApp = join(workspace, "app");
await cp(dirname(executable), isolatedApp, { recursive: true, force: false, errorOnExist: true });
const isolatedExecutable = join(isolatedApp, basename(executable));
const sourceAsar = await readFile(join(dirname(executable), "resources/app.asar"));
const copiedAsar = await readFile(join(isolatedApp, "resources/app.asar"));
if (!copiedAsar.equals(sourceAsar)) throw new Error("Copied app.asar differs from the built package.");
console.log(JSON.stringify({ check: "copied-packaged-asar", bytes: copiedAsar.length,
  sha256: createHash("sha256").update(copiedAsar).digest("hex"), identical: true }));
const env = { ...process.env, HWPX_OPT_SMOKE_TEST: "1", HWPX_OPT_EXPECT_PACKAGED: "1", ELECTRON_ENABLE_LOGGING: "1" };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_PATH;
delete env.NODE_OPTIONS;
delete env.HWPX_OPT_SMOKE_INPUT;
delete env.HWPX_OPT_SMOKE_SCREENSHOT;
const result = spawnSync(isolatedExecutable, [], { cwd: workspace, env, encoding: "utf8", timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });
process.stdout.write(result.stdout ?? ""); process.stderr.write(result.stderr ?? "");
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`Packaged desktop smoke failed (${result.status ?? result.signal}); workspace: ${workspace}`);
// Reject an accidental dev executable or an early exit without the font proof.
const proofs = (result.stdout ?? "").split(/\r?\n/).flatMap(line => {
  try { return [JSON.parse(line)]; }
  catch { return []; }
});
if (!proofs.some(proof => proof.check === "offline-bundled-font" && proof.packaged === true && proof.externalNetworkBlocked === true && proof.networkEmulation === true &&
    /\/resources\/app\.asar\/apps\/desktop\/dist\/fonts\/PretendardVariable\.woff2$/i.test(proof.fontUrl) && proof.rendered?.length === 2)) {
  throw new Error("Packaged desktop exited without the required offline custom-font proof.");
}
if (!proofs.some(proof => proof.check === "external-network-block" && proof.packaged === true && proof.blocked === true)) {
  throw new Error("Packaged desktop did not prove the external request was cancelled by its network policy.");
}
if (!proofs.some(proof => proof.check === "desktop-smoke-complete" && proof.packaged === true)) {
  throw new Error("Packaged desktop exited before the complete synthetic workflow was verified.");
}
console.log("Packaged Windows desktop smoke passed: actual ASAR runtime, fresh profile, no system Pretendard, offline custom glyphs and full synthetic document workflow.");
