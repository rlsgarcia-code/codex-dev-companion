import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCommandPolicy } from "../src/command-policy";

test("allows ordinary local development commands", () => {
  assert.deepEqual(evaluateCommandPolicy("npm", ["run", "build"]), { level: "standard" });
  assert.deepEqual(evaluateCommandPolicy("git", ["status", "--short"]), { level: "standard" });
  assert.deepEqual(evaluateCommandPolicy("vitest", ["--url", "http://127.0.0.1:8000"]), { level: "standard" });
});

test("blocks shell interpreters and command wrappers", () => {
  assert.throws(() => evaluateCommandPolicy("bash", ["-c", "npm test"]), /Shell interpreters are disabled/);
  assert.throws(() => evaluateCommandPolicy("powershell.exe", ["-Command", "npm test"]), /Shell interpreters are disabled/);
  assert.throws(() => evaluateCommandPolicy("env", ["npm", "test"]), /second, unreviewed command/);
});

test("blocks inline code execution", () => {
  assert.throws(() => evaluateCommandPolicy("python3", ["-c", "print('hello')"]), /Inline code execution is disabled/);
  assert.throws(() => evaluateCommandPolicy("node", ["--eval", "console.log('hello')"]), /Inline code execution is disabled/);
});

test("blocks direct and indirect network operations", () => {
  assert.throws(() => evaluateCommandPolicy("curl.exe", ["https://example.com"]), /Network client commands are disabled/);
  assert.throws(() => evaluateCommandPolicy("git", ["push", "origin", "main"]), /Networked Git commands are disabled/);
  assert.throws(() => evaluateCommandPolicy("npx", ["some-package"]), /may download and execute packages/);
  assert.throws(() => evaluateCommandPolicy("npm", ["install"]), /Package download and publish commands are disabled/);
  assert.throws(() => evaluateCommandPolicy("test-runner", ["https://example.com/spec"]), /Remote URLs are disabled/);
});

test("marks commands that may discard workspace data as destructive", () => {
  for (const [command, args] of [
    ["rm", ["-rf", "build"]],
    ["git", ["reset", "--hard", "HEAD"]],
    ["git", ["restore", "src/index.ts"]],
    ["find", [".", "-delete"]]
  ] as const) {
    const policy = evaluateCommandPolicy(command, [...args]);
    assert.equal(policy.level, "destructive");
    assert.match(policy.warning ?? "", /remove, replace, or discard/);
  }
});
