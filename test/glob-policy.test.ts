import assert from "node:assert/strict";
import test from "node:test";
import { isWorkspaceGlob, validateWorkspaceGlob } from "../src/glob-policy";

test("accepts ordinary bounded workspace globs", () => {
  for (const pattern of ["**/*", "src/**/*.ts", "*.md", "packages/*/src/**", "file?.[jt]s"]) {
    assert.equal(validateWorkspaceGlob(pattern), pattern);
    assert.equal(isWorkspaceGlob(pattern), true);
  }
});

test("rejects brace expansion before it reaches the filesystem matcher", () => {
  for (const pattern of ["**/*.{ts,tsx}", "src/{client,server}/**", `${"{".repeat(200)}x${"}".repeat(200)}`]) {
    assert.throws(() => validateWorkspaceGlob(pattern), /Brace expansion is disabled/);
    assert.equal(isWorkspaceGlob(pattern), false);
  }
});

test("bounds glob length, operators, segments, and control characters", () => {
  assert.throws(() => validateWorkspaceGlob("a".repeat(513)), /exceeds 512 characters/);
  assert.throws(() => validateWorkspaceGlob("*/".repeat(65)), /wildcard operators/);
  assert.throws(() => validateWorkspaceGlob("a/".repeat(65)), /path segments/);
  assert.throws(() => validateWorkspaceGlob("src/**\nsecret"), /control characters/);
  assert.throws(() => validateWorkspaceGlob("  "), /cannot be empty/);
});
