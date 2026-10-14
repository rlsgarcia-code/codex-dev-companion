import assert from "node:assert/strict";
import test from "node:test";
import { agentRuntimeLabel, parseAgentRuntime } from "../src/runtime";

test("parseAgentRuntime accepts the two supported runtime choices", () => {
  assert.equal(parseAgentRuntime("standard"), "standard");
  assert.equal(parseAgentRuntime("deep"), "deep");
});

test("parseAgentRuntime safely falls back to the standard agent", () => {
  assert.equal(parseAgentRuntime(undefined), "standard");
  assert.equal(parseAgentRuntime("unknown"), "standard");
});

test("agentRuntimeLabel returns user-facing names", () => {
  assert.equal(agentRuntimeLabel("standard"), "LangChain Agent");
  assert.equal(agentRuntimeLabel("deep"), "Deep Agent");
});
