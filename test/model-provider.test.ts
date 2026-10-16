import assert from "node:assert/strict";
import test from "node:test";
import {
  AVAILABLE_MODEL_PROVIDERS,
  configuredModelProvider,
  modelProvidersForVariant,
  normalizeOllamaEndpoint,
  OPENAI_BASE_URL,
  validateModelConnection
} from "../src/model-provider";

function providerConfiguration(value?: unknown) {
  return {
    get: <T>(_section: string) => value as T | undefined,
    inspect: <T>(_section: string) => value === undefined ? undefined : { globalValue: value as T }
  };
}

test("keeps optional providers out of the default test and production variant", () => {
  assert.deepEqual(AVAILABLE_MODEL_PROVIDERS, ["litellm"]);
  assert.deepEqual(modelProvidersForVariant("ollama"), ["litellm", "ollama"]);
  assert.deepEqual(modelProvidersForVariant("openai"), ["litellm", "openai"]);
  assert.throws(() => validateModelConnection({
    provider: "openai",
    endpoint: OPENAI_BASE_URL,
    model: "gpt-4o",
    apiKey: "secret"
  }), /not included in this extension package/);
});

test("defaults an optional package to its named provider until the user explicitly chooses", () => {
  assert.equal(configuredModelProvider(providerConfiguration(), "ollama"), "ollama");
  assert.equal(configuredModelProvider(providerConfiguration(), "openai"), "openai");
  assert.equal(configuredModelProvider(providerConfiguration("litellm"), "ollama"), "litellm");
  assert.equal(configuredModelProvider(providerConfiguration("openai"), "ollama"), "ollama");
});

test("restricts Ollama endpoints to credential-free loopback URLs", () => {
  assert.equal(normalizeOllamaEndpoint(""), "http://127.0.0.1:11434/v1");
  assert.equal(normalizeOllamaEndpoint("http://localhost:11434"), "http://localhost:11434/v1");
  assert.equal(
    normalizeOllamaEndpoint("http://[::1]:11434/v1/chat/completions"),
    "http://[::1]:11434/v1/chat/completions"
  );
  assert.throws(() => normalizeOllamaEndpoint("http://192.168.1.10:11434/v1"), /must use http\(s\) on localhost/);
  assert.throws(() => normalizeOllamaEndpoint("https://ollama.example.com/v1"), /must use http\(s\) on localhost/);
  assert.throws(() => normalizeOllamaEndpoint("http://user:secret@localhost:11434/v1"), /must not contain credentials/);
  const connection = validateModelConnection({
    provider: "ollama",
    endpoint: "http://127.0.0.1:11434/v1",
    model: "qwen3-coder",
    apiKey: ""
  }, "ollama");
  assert.equal(connection.apiKey, "ollama");
});

test("pins direct OpenAI access to the official base and requires its own key", () => {
  assert.deepEqual(validateModelConnection({
    provider: "openai",
    endpoint: OPENAI_BASE_URL,
    model: "gpt-4o",
    apiKey: " openai-secret "
  }, "openai"), {
    provider: "openai",
    endpoint: OPENAI_BASE_URL,
    model: "gpt-4o",
    apiKey: "openai-secret",
    authHeader: "authorization"
  });
  assert.throws(() => validateModelConnection({
    provider: "openai",
    endpoint: "https://proxy.example.com/v1",
    model: "gpt-4o",
    apiKey: "secret"
  }, "openai"), /accepts only https:\/\/api\.openai\.com\/v1/);
  assert.throws(() => validateModelConnection({
    provider: "openai",
    endpoint: OPENAI_BASE_URL,
    model: "gpt-4o",
    apiKey: ""
  }, "openai"), /OpenAI API key is required/);
});
