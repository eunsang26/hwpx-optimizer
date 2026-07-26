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

const MAX_ATTEMPTS = 3;

const prodReport = runNpmAudit(["audit", "--omit=dev", "--audit-level=moderate", "--json"]);
const prodVulns = countVulns(prodReport);
const prodModeratePlus =
  prodVulns.moderate + prodVulns.high + prodVulns.critical;

if (prodModeratePlus > 0) {
  console.error("Release audit failed: production dependencies have vulnerabilities.");
  console.error(JSON.stringify(prodReport.metadata?.vulnerabilities ?? prodVulns, null, 2));
  const names = Object.keys(prodReport.vulnerabilities ?? {});
  if (names.length > 0) {
    console.error(`Packages: ${names.join(", ")}`);
  }
  process.exit(1);
}

console.log("Release audit passed: production dependencies have 0 vulnerabilities at moderate+.");

const allReport = runNpmAudit(["audit", "--json"], { optional: true });
const allVulns = countVulns(allReport);
if (allVulns.total > 0) {
  console.log(
    `Note: ${allVulns.total} packaging/dev advisory(ies) remain outside --omit=dev ` +
      `(high=${allVulns.high}, moderate=${allVulns.moderate}, low=${allVulns.low}). ` +
      "These are tracked in docs/KNOWN_LIMITATIONS.md and do not block the release gate."
  );
}

process.exit(0);

function runNpmAudit(args, { optional = false } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const result = spawnNpm(args);
    if (result.error) {
      lastError = `Failed to spawn npm: ${result.error.message}`;
    } else {
      const report = safeJson(result.stdout);
      if (isAuditEndpointError(report) || isAuditEndpointErrorText(result.stderr)) {
        lastError =
          report.error?.summary ||
          report.message ||
          result.stderr?.trim() ||
          "npm audit endpoint returned an error";
      } else if (!report.metadata?.vulnerabilities && result.status !== 0) {
        lastError =
          result.stderr?.trim() ||
          result.stdout?.trim() ||
          `npm audit exited with status ${result.status}`;
      } else {
        return report;
      }
    }

    if (attempt < MAX_ATTEMPTS) {
      console.warn(`npm audit attempt ${attempt}/${MAX_ATTEMPTS} failed (${lastError}); retrying...`);
    }
  }

  if (optional) {
    console.warn(`Skipping non-blocking full audit note: ${lastError}`);
    return {};
  }

  console.error(`Release audit failed: could not complete npm audit (${lastError}).`);
  process.exit(1);
}

function spawnNpm(args) {
  // On Windows, npm is a .cmd shim; Node cannot spawn it without a shell
  // (ENOENT / EINVAL after CVE-2024-27980 mitigations).
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  return spawnSync(command, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    env: process.env
  });
}

function safeJson(text) {
  try {
    return JSON.parse(text || "{}");
  } catch {
    return {};
  }
}

function isAuditEndpointError(report) {
  if (!report || typeof report !== "object") return false;
  if (report.error) return true;
  if (typeof report.message === "string" && /audit endpoint|request to .* failed/i.test(report.message)) {
    return true;
  }
  return false;
}

function isAuditEndpointErrorText(text) {
  return typeof text === "string" && /audit endpoint|request to .* failed/i.test(text);
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
