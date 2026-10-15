import assert from "node:assert/strict";
import test from "node:test";
import { redactSensitiveText, safeErrorMessage } from "../src/redaction";

test("redacts the exact configured secret everywhere it appears", () => {
  const secret = "corporate-subscription-key-123456";
  const redacted = redactSensitiveText(
    `Request failed for ${secret}; nested cause repeated ${secret}`,
    [secret]
  );

  assert.equal(redacted, "Request failed for [REDACTED]; nested cause repeated [REDACTED]");
  assert.doesNotMatch(redacted, /corporate-subscription/);
});

test("redacts authentication headers while preserving useful header names", () => {
  const redacted = redactSensitiveText([
    "Authorization: Bearer top-secret-bearer-value",
    'api-key="top-secret-api-key"',
    "x-api-key: another-secret",
    "Ocp-Apim-Subscription-Key=subscription-secret"
  ].join("\n"));

  assert.match(redacted, /Authorization: Bearer \[REDACTED\]/);
  assert.match(redacted, /api-key=\[REDACTED\]/);
  assert.match(redacted, /x-api-key: \[REDACTED\]/);
  assert.match(redacted, /Ocp-Apim-Subscription-Key=\[REDACTED\]/);
  assert.doesNotMatch(redacted, /top-secret|another-secret|subscription-secret/);
});

test("redacts structured credentials, URLs, token signatures, and private keys", () => {
  const redacted = redactSensitiveText([
    '{"api_key":"json-secret","password":"password-secret"}',
    "client_secret: yaml-secret",
    "https://alice:password123@gateway.example.com/v1?access_token=query-secret&mode=test",
    "sk-abcdefghijklmnopqrstuvwxyz123456",
    "ghp_1234567890abcdefghijklmnopqrstuvwxyz",
    "eyJabcdefghijk.abcdefghijklmnop.qrstuvwxyz12345",
    "-----BEGIN PRIVATE KEY-----",
    "private-key-body",
    "-----END PRIVATE KEY-----"
  ].join("\n"));

  for (const secret of [
    "json-secret", "password-secret", "yaml-secret", "password123", "query-secret",
    "abcdefghijklmnopqrstuvwxyz123456", "1234567890abcdefghijklmnopqrstuvwxyz",
    "private-key-body"
  ]) {
    assert.equal(redacted.includes(secret), false, `expected ${secret} to be redacted`);
  }
  assert.match(redacted, /mode=test/);
  assert.match(redacted, /https:\/\/\[REDACTED\]:\[REDACTED\]@gateway\.example\.com/);
});

test("keeps normal diagnostics and code-like text readable", () => {
  const message = "TypeError: temperature does not support zero at src/runtime.ts:42";
  assert.equal(redactSensitiveText(message), message);
  assert.equal(redactSensitiveText("const tokenCount = 42;"), "const tokenCount = 42;");
  assert.equal(safeErrorMessage(new Error(message)), message);
});
