#!/usr/bin/env node
/**
 * Release audit gate for shipped product dependencies.
 *
 * Packaging/dev tooling (electron-builder, esbuild, nested @electron/asar)
 * may report high advisories that do not ship inside the optimized HWPX runtime.
 * This gate requires a clean production tree (`npm audit --omit=dev`).
 *
 * Residual packaging advisories are printed for awareness but do not fail the gate.
 */
import { spawnSync } from "node:child_process";

const prod = spawnSync(
  "npm",
  ["audit", "--omit=dev", "--audit-level=moderate", "--json"],
  { encoding: "utf8" }
);
const prodReport = safeJson(prod.stdout);
const prodVulns = countVulns(prodReport);
if (prod.status !== 0 || prodVulns.total > 0) {
  console.error("Release audit failed: production dependencies have vulnerabilities.");
  if (prod.stdout) process.stderr.write(prod.stdout);
  if (prod.stderr) process.stderr.write(prod.stderr);
  process.exit(prod.status && prod.status !== 0 ? prod.status : 1);
}

console.log("Release audit passed: production dependencies have 0 vulnerabilities at moderate+.");

const all = spawnSync("npm", ["audit", "--json"], { encoding: "utf8" });
const allReport = safeJson(all.stdout);
const allVulns = countVulns(allReport);
if (allVulns.total > 0) {
  console.log(
    `Note: ${allVulns.total} packaging/dev advisory(ies) remain outside --omit=dev ` +
      `(high=${allVulns.high}, moderate=${allVulns.moderate}, low=${allVulns.low}). ` +
      "These are tracked in docs/KNOWN_LIMITATIONS.md and do not block the release gate."
  );
}

process.exit(0);

function safeJson(text) {
  try {
    return JSON.parse(text || "{}");
  } catch {
    return {};
  }
}

function countVulns(report) {
  const metadata = report.metadata?.vulnerabilities ?? {};
  return {
    total: Number(metadata.total ?? 0),
    high: Number(metadata.high ?? 0),
    moderate: Number(metadata.moderate ?? 0),
    low: Number(metadata.low ?? 0),
    critical: Number(metadata.critical ?? 0)
  };
}
