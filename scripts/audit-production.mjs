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
  const usedExceptions = new Set();
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
    for (const advisory of advisories) usedExceptions.add(advisory.id);
    accepted.push({ package: name, advisories: advisories.map((advisory) => advisory.id) });
  }
  const staleExceptions = exceptions
    .filter((entry) => isRecord(entry) && typeof entry.advisory === "string" && !usedExceptions.has(entry.advisory))
    .map((entry) => entry.advisory);
  return { blocking, accepted, staleExceptions };
}

export function validateAuditReport(report) {
  if (!isRecord(report)) return "npm audit did not return a JSON object.";
  if ("error" in report || typeof report.message === "string") {
    const summary = isRecord(report.error) && typeof report.error.summary === "string"
      ? report.error.summary.trim()
      : "";
    return summary || String(report.message || "npm audit reported an error.");
  }
  if (!isRecord(report.vulnerabilities)) {
    return "npm audit report is missing the vulnerabilities object.";
  }
  if (!isRecord(report.metadata) || !isRecord(report.metadata.vulnerabilities)) {
    return "npm audit report is missing vulnerability metadata.";
  }
  return undefined;
}

export function validateAuditPolicy(policy, now = new Date()) {
  if (!isRecord(policy) || policy.version !== 1 || !Array.isArray(policy.exceptions)) {
    return "Security audit policy must use version 1 with an exceptions array.";
  }
  const seen = new Set();
  const allowedFields = new Set([
    "advisory", "package", "severity", "expires", "rationale", "mitigation", "verification"
  ]);
  for (const [index, entry] of policy.exceptions.entries()) {
    if (!isRecord(entry)) return `Security audit exception ${index + 1} must be an object.`;
    const unknownField = Object.keys(entry).find((field) => !allowedFields.has(field));
    if (unknownField) return `Security audit exception ${index + 1} contains unknown field ${unknownField}.`;
    if (typeof entry.advisory !== "string" || !/^GHSA-[0-9a-z-]+$/i.test(entry.advisory)) {
      return `Security audit exception ${index + 1} has an invalid advisory identifier.`;
    }
    if (seen.has(entry.advisory)) return `Security audit policy contains duplicate exception ${entry.advisory}.`;
    seen.add(entry.advisory);
    if (typeof entry.package !== "string" || !entry.package.trim()) {
      return `Security audit exception ${entry.advisory} has no package.`;
    }
    if (!['high', 'critical'].includes(entry.severity)) {
      return `Security audit exception ${entry.advisory} must be high or critical.`;
    }
    if (![entry.rationale, entry.mitigation, entry.verification].every((value) => typeof value === "string" && value.trim())) {
      return `Security audit exception ${entry.advisory} is missing rationale, mitigation, or verification.`;
    }
    const expiry = new Date(`${entry.expires}T23:59:59.999Z`);
    if (typeof entry.expires !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(entry.expires) || !Number.isFinite(expiry.getTime())) {
      return `Security audit exception ${entry.advisory} has an invalid expiry date.`;
    }
    if (expiry < now) return `Security audit exception ${entry.advisory} expired on ${entry.expires}.`;
    for (const file of entry.verification.split(/\s+and\s+/)) {
      if (!existsSync(file.trim())) return `Security audit exception ${entry.advisory} references missing verification ${file.trim()}.`;
    }
  }
  return undefined;
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
  const reportError = validateAuditReport(report);
  if (result.error || result.signal || reportError) {
    const detail = result.error?.message || reportError || `npm audit terminated with signal ${result.signal}.`;
    process.stderr.write(`Production dependency audit could not be completed: ${detail}\n`);
    process.exit(1);
  }
  let policy;
  try {
    policy = JSON.parse(readFileSync("security-audit-exceptions.json", "utf8"));
  } catch (error) {
    process.stderr.write(`Cannot read security audit policy: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
  const policyError = validateAuditPolicy(policy);
  if (policyError) {
    process.stderr.write(`${policyError}\n`);
    process.exit(1);
  }
  const evaluation = evaluateAuditReport(report, policy);
  if (evaluation.blocking.length) {
    process.stderr.write(`Unaccepted production vulnerabilities:\n${JSON.stringify(evaluation.blocking, null, 2)}\n`);
    process.exit(1);
  }
  if (evaluation.staleExceptions.length) {
    process.stderr.write(`Stale production audit exceptions must be removed:\n${JSON.stringify(evaluation.staleExceptions, null, 2)}\n`);
    process.exit(1);
  }
  process.stdout.write(`PRODUCTION_AUDIT_ACCEPTED ${evaluation.accepted.length} dependency findings covered by current verified mitigations.\n`);
}
