import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const AUDIT_ARGUMENTS = ["audit", "--omit=dev", "--ignore-scripts", "--json"];

export function npmAuditInvocation({
  npmExecutable = process.env.npm_execpath,
  nodeExecutable = process.execPath,
  platform = process.platform,
  commandInterpreter = process.env.ComSpec
} = {}) {
  if (typeof npmExecutable === "string" && npmExecutable.trim()) {
    return { command: nodeExecutable, args: [npmExecutable.trim(), ...AUDIT_ARGUMENTS] };
  }
  if (platform === "win32") {
    return {
      command: commandInterpreter?.trim() || "cmd.exe",
      args: ["/d", "/s", "/c", "npm.cmd", ...AUDIT_ARGUMENTS]
    };
  }
  return { command: "npm", args: AUDIT_ARGUMENTS };
}

export function evaluateAuditReport(report, policy, now = new Date()) {
  const vulnerabilities = isRecord(report?.vulnerabilities) ? report.vulnerabilities : {};
  const exceptions = Array.isArray(policy?.exceptions) ? policy.exceptions : [];
  const exceptionByAdvisory = new Map(exceptions.map((entry) => [entry.advisory, entry]));
  const blocking = [];
  const accepted = [];

  for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
    if (!isRecord(vulnerability) || !["high", "critical"].includes(String(vulnerability.severity))) continue;
    const advisories = collectAdvisories(name, vulnerabilities);
    if (!advisories.length) {
      blocking.push({ package: name, reason: "No reviewed advisory identifier was available." });
      continue;
    }
    const rejected = advisories.find((advisory) => {
      const exception = exceptionByAdvisory.get(advisory.id);
      return !validException(exception, advisory, now);
    });
    if (rejected) {
      blocking.push({ package: name, advisory: rejected.id, reason: "No current verified exception." });
      continue;
    }
    accepted.push({ package: name, advisories: advisories.map((advisory) => advisory.id) });
  }
  return { blocking, accepted };
}

function collectAdvisories(name, vulnerabilities, seen = new Set()) {
  if (seen.has(name)) return [];
  seen.add(name);
  const vulnerability = vulnerabilities[name];
  if (!isRecord(vulnerability) || !Array.isArray(vulnerability.via)) return [];
  const collected = [];
  for (const item of vulnerability.via) {
    if (typeof item === "string") {
      collected.push(...collectAdvisories(item, vulnerabilities, seen));
    } else if (isRecord(item) && typeof item.url === "string") {
      const match = /GHSA-[0-9a-z-]+/i.exec(item.url);
      if (match) collected.push({ id: match[0], package: String(item.name ?? name), severity: String(item.severity ?? "") });
    }
  }
  return [...new Map(collected.map((entry) => [entry.id, entry])).values()];
}

function validException(exception, advisory, now) {
  if (!isRecord(exception)) return false;
  if (exception.package !== advisory.package || exception.severity !== advisory.severity) return false;
  if (![exception.rationale, exception.mitigation, exception.verification].every((value) => typeof value === "string" && value.trim())) {
    return false;
  }
  for (const file of exception.verification.split(/\s+and\s+/)) {
    if (!existsSync(file.trim())) return false;
  }
  const expiry = new Date(`${exception.expires}T23:59:59.999Z`);
  return Number.isFinite(expiry.getTime()) && expiry >= now;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const invocation = npmAuditInvocation();
  const result = spawnSync(invocation.command, invocation.args, {
    encoding: "utf8",
    maxBuffer: 10_000_000
  });
  if (!result.stdout?.trim()) {
    const detail = result.error?.message || result.stderr || "npm audit returned no JSON report.";
    process.stderr.write(`${detail.trim()}\n`);
    process.exit(1);
  }
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    process.stderr.write("npm audit returned invalid JSON.\n");
    process.exit(1);
  }
  const policy = JSON.parse(readFileSync("security-audit-exceptions.json", "utf8"));
  const evaluation = evaluateAuditReport(report, policy);
  if (evaluation.blocking.length) {
    process.stderr.write(`Unaccepted production vulnerabilities:\n${JSON.stringify(evaluation.blocking, null, 2)}\n`);
    process.exit(1);
  }
  process.stdout.write(`PRODUCTION_AUDIT_ACCEPTED ${evaluation.accepted.length} dependency findings covered by current verified mitigations.\n`);
}
