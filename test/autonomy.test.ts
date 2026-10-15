import assert from "node:assert/strict";
import test from "node:test";
import {
  isRunMode,
  parseRunMode,
  requiresLocalApproval,
  runModeLabel
} from "../src/autonomy";

test("parses the three explicit autonomy modes with a safe fallback", () => {
  assert.equal(isRunMode("review"), true);
  assert.equal(isRunMode("execute"), true);
  assert.equal(isRunMode("plan"), true);
  assert.equal(isRunMode("unknown"), false);
  assert.equal(parseRunMode("unknown"), "review");
  assert.equal(parseRunMode(undefined, "plan"), "plan");
  assert.equal(runModeLabel("review"), "Ask first");
  assert.equal(runModeLabel("execute"), "Auto edits");
  assert.equal(runModeLabel("plan"), "Plan only");
});

test("keeps destructive actions guarded in every executable mode", () => {
  for (const mode of ["review", "execute", "plan"] as const) {
    assert.equal(requiresLocalApproval(mode, "file-delete"), true);
    assert.equal(requiresLocalApproval(mode, "command", "destructive"), true);
  }
});

test("distinguishes review approvals from automatic local edits", () => {
  assert.equal(requiresLocalApproval("review", "file-write"), true);
  assert.equal(requiresLocalApproval("review", "command"), true);
  assert.equal(requiresLocalApproval("review", "memory"), true);
  assert.equal(requiresLocalApproval("execute", "file-write"), false);
  assert.equal(requiresLocalApproval("execute", "command"), true);
  assert.equal(requiresLocalApproval("execute", "memory"), false);
  assert.equal(requiresLocalApproval("plan", "file-write"), true);
});
