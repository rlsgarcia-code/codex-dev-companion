import assert from "node:assert/strict";
import test from "node:test";
import {
  composeContextWithinBudget,
  composeContextSourcesWithinBudget,
  estimateContextTokens
} from "../src/context-budget";

test("estimates tokens conservatively from bounded context characters", () => {
  assert.equal(estimateContextTokens(0), 0);
  assert.equal(estimateContextTokens(1), 1);
  assert.equal(estimateContextTokens(4_001), 1_001);
});

test("reserves context budget for explicit pinned content", () => {
  const result = composeContextWithinBudget("a".repeat(10_000), "p".repeat(10_000), 4_000);
  assert.equal(result.text.length, 4_000);
  assert.ok(result.budget.pinnedCharacters >= 2_990);
  assert.ok(result.budget.automaticCharacters <= 1_000);
  assert.equal(result.budget.utilizationPercent, 100);
  assert.equal(result.budget.truncated, true);
  assert.match(result.text, /p{100}/);
});

test("keeps pinned context when automatic context is disabled", () => {
  const result = composeContextWithinBudget("", "explicit file contents", 2_000);
  assert.equal(result.text, "explicit file contents");
  assert.equal(result.budget.automaticCharacters, 0);
  assert.equal(result.budget.pinnedCharacters, 22);
  assert.equal(result.budget.truncated, false);
});

test("returns unused pinned capacity to automatic context", () => {
  const result = composeContextWithinBudget("a".repeat(3_000), "pinned", 2_000);
  assert.equal(result.text.length, 2_000);
  assert.equal(result.budget.pinnedCharacters, 6);
  assert.ok(result.budget.automaticCharacters > 1_900);
});

test("gives project guidance priority without hiding all editor signals", () => {
  const result = composeContextSourcesWithinBudget(
    "a".repeat(10_000),
    "g".repeat(10_000),
    "",
    4_000
  );
  assert.equal(result.text.length, 4_000);
  assert.ok(result.budget.guidanceCharacters >= 2_790);
  assert.ok(result.budget.automaticCharacters >= 1_190);
  assert.equal(result.budget.pinnedCharacters, 0);
  assert.equal(result.budget.truncated, true);
});

test("keeps user-pinned context above guidance and automatic context", () => {
  const result = composeContextSourcesWithinBudget(
    "a".repeat(10_000),
    "g".repeat(10_000),
    "p".repeat(10_000),
    4_000
  );
  assert.equal(result.text.length, 4_000);
  assert.ok(result.budget.pinnedCharacters >= 2_980);
  assert.ok(result.budget.guidanceCharacters > result.budget.automaticCharacters);
});
