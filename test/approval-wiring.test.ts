import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const tools = readFileSync("src/tools.ts", "utf8");
const agent = readFileSync("src/agent.ts", "utf8");
const presenter = readFileSync("src/local-approval.ts", "utf8");

test("routes every runtime approval through one observable local presenter", () => {
  assert.match(tools, /requestLocalApproval\(this\.onEvent/);
  assert.match(agent, /requestLocalApproval\(onEvent/);
  assert.doesNotMatch(tools, /showWarningMessage/);
  assert.doesNotMatch(agent, /showWarningMessage/);
  assert.match(presenter, /label: "Waiting for your approval"/);
  assert.match(presenter, /kind: "approval"/);
  assert.match(presenter, /presentation\.approvedTitle/);
  assert.match(presenter, /presentation\.declinedTitle/);
  assert.match(presenter, /modal: true/);
});

test("keeps commands, destructive changes, and sensitive reads explicitly classified", () => {
  assert.match(tools, /risk: policy\.level/);
  assert.match(tools, /risk: "sensitive"/);
  assert.match(agent, /risk: deleting \? "destructive" : "standard"/);
  assert.match(agent, /risk: "sensitive"/);
});
