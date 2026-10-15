import assert from "node:assert/strict";
import test from "node:test";
import { connectionDiagnosticFixes } from "../src/connection-remediation";

test("offers an explicit reasoning correction for Chat Completions tool failures", () => {
  assert.deepEqual(
    connectionDiagnosticFixes("Function tools with reasoning_effort are not supported by this model."),
    [{ kind: "set-reasoning", label: "Use reasoning none and retest", value: "none" }]
  );
});

test("offers precise sampling corrections without changing unrelated parameters", () => {
  assert.deepEqual(
    connectionDiagnosticFixes("Temperature does not support zero; leave temperature blank."),
    [{ kind: "clear-sampling", label: "Omit Temperature and retest", target: "temperature" }]
  );
  assert.deepEqual(
    connectionDiagnosticFixes("This model does not accept Temperature or Top P. Leave both blank."),
    [{ kind: "clear-sampling", label: "Omit sampling and retest", target: "both" }]
  );
});

test("lets the user choose the corporate gateway subscription header", () => {
  assert.deepEqual(
    connectionDiagnosticFixes("Missing subscription key", { authHeader: "authorization", surface: "chat" }),
    [
      { kind: "set-auth-header", label: "Use api-key and retest", value: "api-key" },
      {
        kind: "set-auth-header",
        label: "Use APIM subscription header and retest",
        value: "ocp-apim-subscription-key"
      }
    ]
  );
  assert.deepEqual(
    connectionDiagnosticFixes("Missing subscription key", { surface: "catalog" }),
    [{ kind: "focus-field", label: "Check gateway key", field: "api-key" }]
  );
});

test("routes certificate, authentication, endpoint, and incompatible-model failures", () => {
  assert.deepEqual(connectionDiagnosticFixes("self-signed certificate in certificate chain"), [
    { kind: "open-ca-setup", label: "Import or change corporate CA" }
  ]);
  assert.deepEqual(connectionDiagnosticFixes("HTTP 401 Unauthorized"), [
    { kind: "focus-field", label: "Review key and authentication", field: "api-key" }
  ]);
  assert.deepEqual(connectionDiagnosticFixes("HTTP 404 Not Found"), [
    { kind: "focus-field", label: "Review gateway route", field: "endpoint" }
  ]);
  assert.deepEqual(connectionDiagnosticFixes("This alias requires the Responses API for function tools."), [
    { kind: "focus-field", label: "Choose a Chat Completions model", field: "model" }
  ]);
  assert.deepEqual(connectionDiagnosticFixes("Gateway API or subscription key is required."), [
    { kind: "focus-field", label: "Add the gateway key", field: "api-key" }
  ]);
  assert.deepEqual(connectionDiagnosticFixes("LiteLLM model alias is required."), [
    { kind: "focus-field", label: "Choose a model alias", field: "model" }
  ]);
  assert.deepEqual(connectionDiagnosticFixes("LiteLLM endpoint must be a valid HTTPS URL."), [
    { kind: "focus-field", label: "Review gateway URL", field: "endpoint" }
  ]);
});

test("does not suggest a speculative change for an unknown provider error", () => {
  assert.deepEqual(connectionDiagnosticFixes("The upstream service returned an opaque failure."), []);
});
