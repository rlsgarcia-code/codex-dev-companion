import assert from "node:assert/strict";
import test from "node:test";
import {
  chatCompletionsBaseUrl,
  chatCompletionsUrl,
  normalizeLiteLlmEndpoint,
  resolveWorkspaceCertificatePath,
  validateLiteLlmConnection
} from "../src/litellm";

test("normalizes HTTPS LiteLLM base and full Chat Completions URLs", () => {
  assert.equal(normalizeLiteLlmEndpoint("https://gateway.example.com/v1/"), "https://gateway.example.com/v1");
  assert.equal(normalizeLiteLlmEndpoint("https://gateway.example.com/team/litellm"), "https://gateway.example.com/team/litellm");
  assert.equal(
    normalizeLiteLlmEndpoint("https://gateway.example.com/team/litellm/chat/completions/"),
    "https://gateway.example.com/team/litellm/chat/completions"
  );
});

test("rejects invalid, insecure, credential-bearing, and route-specific URLs", () => {
  assert.throws(() => normalizeLiteLlmEndpoint("not-a-url"), /valid HTTPS URL/);
  assert.throws(() => normalizeLiteLlmEndpoint("http://gateway.example.com/v1"), /use HTTPS/);
  assert.throws(
    () => normalizeLiteLlmEndpoint("https://user:secret@gateway.example.com/v1"),
    /must not contain credentials/
  );
  assert.throws(() => normalizeLiteLlmEndpoint("https://gateway.example.com/v1/responses"), /not \/responses/);
  assert.throws(() => normalizeLiteLlmEndpoint("https://gateway.example.com/v1?api_key=secret"), /must not contain query/);
});

test("validates the Chat Completions connection and constructs its route", () => {
  const connection = validateLiteLlmConnection({
    endpoint: "https://gateway.example.com/v1/",
    model: " company-coding-model ",
    apiKey: " secret "
  });
  assert.deepEqual(connection, {
    endpoint: "https://gateway.example.com/v1",
    model: "company-coding-model",
    apiKey: "secret"
  });
  assert.equal(chatCompletionsUrl(connection), "https://gateway.example.com/v1/chat/completions");
  assert.equal(chatCompletionsBaseUrl(connection), "https://gateway.example.com/v1");
  assert.equal(
    chatCompletionsUrl({ endpoint: "https://gateway.example.com/proxy/chat/completions" }),
    "https://gateway.example.com/proxy/chat/completions"
  );
  assert.equal(
    chatCompletionsBaseUrl({ endpoint: "https://gateway.example.com/proxy/chat/completions" }),
    "https://gateway.example.com/proxy"
  );
  assert.throws(
    () => validateLiteLlmConnection({ endpoint: "https://gateway.example.com/v1", model: "", apiKey: "secret" }),
    /model alias is required/
  );
  assert.throws(
    () => validateLiteLlmConnection({ endpoint: "https://gateway.example.com/v1", model: "model", apiKey: "" }),
    /virtual key is required/
  );
});

test("keeps the gateway CA certificate inside the workspace", () => {
  assert.equal(
    resolveWorkspaceCertificatePath("/workspace/project", "corporate-root.pem"),
    "/workspace/project/corporate-root.pem"
  );
  assert.throws(
    () => resolveWorkspaceCertificatePath("/workspace/project", "../outside.pem"),
    /inside the opened workspace/
  );
  assert.throws(
    () => resolveWorkspaceCertificatePath("/workspace/project", "certificate.crt"),
    /.pem extension/
  );
});
