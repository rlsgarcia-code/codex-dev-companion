import assert from "node:assert/strict";
import test from "node:test";
import {
  nativePackageName,
  nativeTarget,
  packageArguments
} from "../scripts/package-native.mjs";

test("maps every supported build host to an explicit VSIX target", () => {
  for (const target of ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-x64"]) {
    const separator = target.lastIndexOf("-");
    assert.equal(nativeTarget(target.slice(0, separator), target.slice(separator + 1)), target);
  }
});

test("refuses to label unsupported native hosts as universal packages", () => {
  assert.throws(() => nativeTarget("win32", "arm64"), /Unsupported packaging host/);
  assert.throws(() => nativeTarget("linux", "ppc64"), /Unsupported packaging host/);
});

test("builds a versioned target-specific package command", () => {
  assert.equal(
    nativePackageName("0.11.0", "darwin-arm64"),
    "codex-dev-companion-0.11.0-darwin-arm64.vsix"
  );
  assert.deepEqual(packageArguments("0.11.0", "win32-x64"), [
    "--no-install",
    "vsce",
    "package",
    "--no-dependencies",
    "--target",
    "win32-x64",
    "--out",
    "codex-dev-companion-0.11.0-win32-x64.vsix"
  ]);
  assert.throws(() => nativePackageName("latest", "linux-x64"), /Invalid package version/);
  assert.throws(() => nativePackageName("0.11.0", "universal"), /Unsupported VSIX target/);
});
