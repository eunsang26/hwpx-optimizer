import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const benchArgs = process.argv.slice(2);

function nodeMajor(version = process.versions.node) {
  return Number.parseInt(version.split(".")[0] ?? "0", 10);
}

function resolveNodeBin() {
  if (nodeMajor() > 22 || (nodeMajor() === 22 && Number(process.versions.node.split(".")[1]) >= 12)) {
    return process.execPath;
  }

  const home = process.env.HOME ?? "";
  const candidates = [
    process.env.HWPX_OPT_NODE,
    join(home, ".nvm/versions/node/v24.21.0/bin/node"),
    join(home, ".nvm/versions/node/v24.13.0/bin/node")
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

const nodeBin = resolveNodeBin();
if (!nodeBin) {
  console.error(
    `HWPX bench requires Node >= 22.12.0 (current: ${process.version}).\n` +
      "Fix: nvm use\n" +
      "Or: export HWPX_OPT_NODE=/path/to/node24/bin/node"
  );
  process.exit(1);
}

const tsxBin = join(repoRoot, "node_modules/.bin/tsx");
const runBench = join(repoRoot, "scripts/bench/src/runBench.ts");
const child = spawnSync(
  nodeBin,
  [tsxBin, "--conditions=development", runBench, ...benchArgs],
  { cwd: repoRoot, stdio: "inherit", env: process.env }
);

if (child.error) {
  console.error(child.error.message);
  process.exit(1);
}

process.exit(typeof child.status === "number" ? child.status : 1);
