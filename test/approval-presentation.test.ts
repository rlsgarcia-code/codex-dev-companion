import assert from "node:assert/strict";
import test from "node:test";
import { localApprovalPresentation } from "../src/approval-presentation";

test("builds consistent approval activity and modal copy", () => {
  const presentation = localApprovalPresentation({
    prompt: "Allow this command?",
    action: "Run command",
    target: "Working directory: .",
    explanation: "npm test",
    risk: "standard"
  });
  assert.equal(presentation.requestedTitle, "Approval required · Run command");
  assert.equal(presentation.approvedTitle, "Approved · Run command");
  assert.equal(presentation.declinedTitle, "Declined · Run command");
  assert.equal(presentation.modalDetail, "Working directory: .\n\nnpm test");
});

test("labels destructive and sensitive decisions explicitly", () => {
  assert.match(localApprovalPresentation({
    prompt: "Delete?",
    action: "Delete path",
    target: "dist",
    explanation: "Recursive removal",
    risk: "destructive"
  }).requestedTitle, /^Destructive required/);
  assert.match(localApprovalPresentation({
    prompt: "Share?",
    action: "Share redacted file once",
    target: ".env",
    explanation: "Detection is not guaranteed",
    risk: "sensitive"
  }).requestedTitle, /^Sensitive required/);
});

test("redacts secrets and bounds untrusted approval text", () => {
  const secret = "corporate-secret-value";
  const presentation = localApprovalPresentation({
    prompt: `Allow\n${secret}?`,
    action: "Run\tcommand",
    target: `target ${secret}`,
    explanation: `detail ${secret} ${"x".repeat(5_000)}`,
    risk: "standard",
    sensitiveValues: [secret]
  });
  const serialized = JSON.stringify(presentation);
  assert.equal(serialized.includes(secret), false);
  assert.equal(presentation.prompt.includes("\n"), false);
  assert.ok(presentation.modalDetail.length <= 3_802);
});
