#!/usr/bin/env node
/** Release gate: production dependencies plus the shipped Electron runtime. */
import { spawnSync } from "node:child_process";
import { blockingRuntimePackages, isCompleteAuditReport } from "./lib/auditPolicy.mjs";

const MAX_ATTEMPTS = 3;

const prodReport = runNpmAudit(["audit", "--omit=dev", "--audit-level=moderate", "--json"]);
const allReport = runNpmAudit(["audit", "--json"]);
const blocked = blockingRuntimePackages(prodReport, allReport);
if (blocked.length > 0) {
  console.error(`Release audit failed: shipped runtime vulnerabilities at moderate+: ${blocked.join(", ")}`);
  process.exit(1);
}
console.log("Release audit passed: production dependencies and shipped Electron have 0 vulnerabilities at moderate+.");
const allVulns = countVulns(allReport);
if (allVulns.total > 0) {
  console.log(`Full audit reports ${allVulns.total} advisories (high=${allVulns.high}, ` +
    `moderate=${allVulns.moderate}, low=${allVulns.low}). ` +
    "Remaining build-tool advisories are non-blocking; this is not a claim of zero total vulnerabilities.");
}

process.exit(0);

function runNpmAudit(args) {
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
      } else if (!isCompleteAuditReport(report)) {
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
