import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import {
  nativePackageName,
  nativeTarget,
  packageArguments,
  packageInvocation,
  verifyPackagedBrowserRuntime
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

test("invokes the local VSCE CLI through Node without a shell or npx shim", () => {
  const invocation = packageInvocation("0.11.0", "win32-x64", {
    nodeExecutable: "C:\\Program Files\\nodejs\\node.exe",
    vsceCli: "C:\\repo\\node_modules\\@vscode\\vsce\\vsce"
  });

  assert.equal(invocation.executable, "C:\\Program Files\\nodejs\\node.exe");
  assert.deepEqual(invocation.args, [
    "C:\\repo\\node_modules\\@vscode\\vsce\\vsce",
    "package",
    "--no-dependencies",
    "--target",
    "win32-x64",
    "--out",
    "codex-dev-companion-0.11.0-win32-x64.vsix"
  ]);
  assert.doesNotMatch(invocation.args.join(" "), /npx(?:\.cmd)?/i);
});

test("requires the browser controller to be copied into the distributable", async (context) => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "local-companion-package-"));
  context.after(() => rm(projectRoot, { recursive: true, force: true }));
  const runtimeRoot = path.join(projectRoot, "dist", "node_modules", "playwright-core");
  for (const relativePath of [
    "package.json",
    "index.js",
    "browsers.json",
    path.join("lib", "server", "browserType.js"),
    "LICENSE"
  ]) {
    const target = path.join(runtimeRoot, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "test", "utf8");
  }
  assert.equal(verifyPackagedBrowserRuntime(projectRoot), runtimeRoot);
  await rm(path.join(runtimeRoot, "browsers.json"));
  assert.throws(() => verifyPackagedBrowserRuntime(projectRoot), /runtime is incomplete: browsers\.json/);
});
