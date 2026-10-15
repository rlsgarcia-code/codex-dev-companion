import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isSensitiveWorkspacePath } from "../src/sensitive-files";

test("recognizes common credential-bearing workspace files", () => {
  for (const file of [
    ".env", ".env.production", "certs/company.pem", "private/server.key",
    ".npmrc", ".aws/credentials", ".docker/config.json", "terraform/prod.tfvars",
    "google/application_default_credentials.json", "keys/id_ed25519",
    "config/secrets.yaml", "certificates/store.p12"
  ]) {
    assert.equal(isSensitiveWorkspacePath(file), true, `expected ${file} to be sensitive`);
  }
});

test("keeps templates and ordinary source/configuration files available", () => {
  for (const file of [
    ".env.example", ".env.sample", "src/auth.ts", "test/credentials.test.ts",
    "package.json", "certificates/README.md", "config/settings.yaml"
  ]) {
    assert.equal(isSensitiveWorkspacePath(file), false, `expected ${file} to remain available`);
  }
});

test("wires the sensitive-file policy into every automatic editor-context source", () => {
  const contextSource = readFileSync("src/context.ts", "utf8");
  const webviewSource = readFileSync("src/webview.ts", "utf8");
  assert.match(contextSource, /if \(!isSensitiveWorkspacePath\(candidateActiveFile\)\)/);
  assert.match(contextSource, /diagnostics = editor && includeAutomaticContext && activeFile/);
  assert.match(contextSource, /filter\(\(filename\) => !isSensitiveWorkspacePath\(filename\)\)/);
  assert.match(webviewSource, /activeFileSensitive: Boolean\(activeFile && isSensitiveWorkspacePath\(activeFile\)\)/);
});
