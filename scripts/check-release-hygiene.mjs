import { execFileSync } from "node:child_process";

const forbiddenPatterns = [
  /^sample.*\.(hwp|hwpx|json|txt)$/i,
  /^release\//,
  /^build\//,
  /^\.tmp\//,
  /^\.npm-cache\//,
  /^node_modules\//
];

const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split(/\r?\n/)
  .filter(Boolean);

const violations = tracked.filter((path) => forbiddenPatterns.some((pattern) => pattern.test(path)));

if (violations.length > 0) {
  console.error("Release hygiene check failed. Forbidden files are tracked:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log("Release hygiene check passed.");
