const levels = ["info", "low", "moderate", "high", "critical", "total"];
const blockingLevels = new Set(["moderate", "high", "critical"]);

export function isCompleteAuditReport(report) {
  const counts = report?.metadata?.vulnerabilities;
  return Boolean(report && !report.error && counts &&
    levels.every((level) => Number.isSafeInteger(counts[level]) && counts[level] >= 0) &&
    report.vulnerabilities && typeof report.vulnerabilities === "object");
}

export function blockingRuntimePackages(productionReport, fullReport) {
  if (!isCompleteAuditReport(productionReport) || !isCompleteAuditReport(fullReport)) {
    throw new Error("Incomplete npm audit report");
  }
  const blocked = new Set(Object.entries(productionReport.vulnerabilities)
    .filter(([, entry]) => blockingLevels.has(entry.severity)).map(([name]) => name));
  const counts = productionReport.metadata.vulnerabilities;
  if (counts.moderate + counts.high + counts.critical > 0 && blocked.size === 0) {
    blocked.add("unidentified production dependency");
  }
  // Electron is declared as dev tooling but its binary ships with the desktop app.
  if (blockingLevels.has(fullReport.vulnerabilities.electron?.severity)) blocked.add("electron");
  return [...blocked].sort();
}
