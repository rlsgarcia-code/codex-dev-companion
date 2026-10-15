import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { evaluateAuditReport } from "../scripts/audit-production.mjs";

const report = {
  vulnerabilities: {
    braces: {
      severity: "high",
      via: [{
        name: "braces",
        severity: "high",
        url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm"
      }]
    },
    micromatch: { severity: "high", via: ["braces"] },
    deepagents: { severity: "high", via: ["micromatch"] }
  }
};

const exception = {
  advisory: "GHSA-vfj7-8cjw-p6xm",
  package: "braces",
  severity: "high",
  expires: "2027-01-31",
  rationale: "No patched release.",
  mitigation: "Reject brace expansion.",
  verification: "test/glob-policy.test.ts and test/change-tracker.test.ts"
};

test("accepts a current advisory exception only with checked mitigation evidence", () => {
  const result = evaluateAuditReport(report, { exceptions: [exception] }, new Date("2026-10-15T00:00:00Z"));
  assert.deepEqual(result.blocking, []);
  assert.deepEqual(result.accepted.map((entry) => entry.package), ["braces", "micromatch", "deepagents"]);
});

test("keeps the repository exception current and backed by existing tests", () => {
  const policy = JSON.parse(readFileSync("security-audit-exceptions.json", "utf8"));
  const result = evaluateAuditReport(report, policy, new Date());
  assert.deepEqual(result.blocking, []);
  assert.equal(policy.version, 1);
});

test("blocks missing, expired, mismatched, or unverifiable exceptions", () => {
  assert.equal(evaluateAuditReport(report, { exceptions: [] }).blocking.length, 3);
  assert.equal(evaluateAuditReport(report, { exceptions: [{ ...exception, expires: "2026-01-01" }] }, new Date("2026-10-15T00:00:00Z")).blocking.length, 3);
  assert.equal(evaluateAuditReport(report, { exceptions: [{ ...exception, package: "other" }] }).blocking.length, 3);
  assert.equal(evaluateAuditReport(report, { exceptions: [{ ...exception, verification: "test/missing.test.ts" }] }).blocking.length, 3);
});
