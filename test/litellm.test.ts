import assert from "node:assert/strict";
import test from "node:test";
import {
  buildIsolatedEnvironment,
  buildLiteLlmCodexConfig,
  normalizeLiteLlmEndpoint,
  resolveWorkspaceCertificatePath,
  resolveWorkspaceModelCatalogPath,
  validateLiteLlmConnection
} from "../src/litellm";

test("normalizes an HTTPS LiteLLM base URL ending in /v1", () => {
  assert.equal(normalizeLiteLlmEndpoint("https://gateway.example.com/v1/"), "https://gateway.example.com/v1");
  assert.equal(
    normalizeLiteLlmEndpoint("https://gateway.example.com/team/litellm/v1?ignored=true"),
    "https://gateway.example.com/team/litellm/v1"
  );
});

test("rejects invalid, insecure, credential-bearing, and response-specific URLs", () => {
  assert.throws(() => normalizeLiteLlmEndpoint("not-a-url"), /valid HTTPS URL/);
  assert.throws(() => normalizeLiteLlmEndpoint("http://gateway.example.com/v1"), /use HTTPS/);
  assert.throws(
    () => normalizeLiteLlmEndpoint("https://user:secret@gateway.example.com/v1"),
    /must not contain credentials/
  );
  assert.throws(
    () => normalizeLiteLlmEndpoint("https://gateway.example.com/v1/responses"),
    /must end at \/v1/
  );
});

test("builds a Responses-only LiteLLM provider with external integrations disabled", () => {
  const connection = validateLiteLlmConnection({
    endpoint: "https://gateway.example.com/v1",
    model: "company-coding-model",
    apiKey: "secret"
  });
  const config = buildLiteLlmCodexConfig(connection);
  assert.equal(config.model_provider, "litellm");
  assert.equal(config.model, "company-coding-model");
  assert.equal(config.web_search, "disabled");
  assert.equal(config.check_for_update_on_startup, false);
  assert.equal(config.analytics.enabled, false);
  assert.equal(config.feedback.enabled, false);
  assert.equal(config.otel.exporter, "none");
  assert.equal(config.otel.trace_exporter, "none");
  assert.equal(config.otel.metrics_exporter, "none");
  assert.equal(config.otel.log_user_prompt, false);
  assert.deepEqual(config.mcp_servers, {});
  assert.deepEqual(config.plugins, {});
  assert.equal(config.apps._default.enabled, false);
  assert.equal(config.apps._default.open_world_enabled, false);
  assert.equal(config.features.apps, false);
  assert.equal(config.features.plugins, false);
  assert.equal(config.features.remote_plugin, false);
  assert.equal(config.features.realtime_conversation, false);
  assert.equal(config.features.skill_mcp_dependency_install, false);
  assert.equal(config.features.workspace_dependencies, false);
  assert.equal(config.model_providers.litellm.env_key, "LITELLM_API_KEY");
  assert.equal(config.model_providers.litellm.wire_api, "responses");
  assert.equal(config.model_providers.litellm.requires_openai_auth, false);
  assert.equal("query_params" in config.model_providers.litellm, false);
  assert.equal("env_http_headers" in config.model_providers.litellm, false);
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

test("keeps a model catalog inside the workspace and passes it to Codex", () => {
  assert.equal(
    resolveWorkspaceModelCatalogPath("/workspace/project", ".codex/model-catalog.json"),
    "/workspace/project/.codex/model-catalog.json"
  );
  assert.throws(
    () => resolveWorkspaceModelCatalogPath("/workspace/project", "../model-catalog.json"),
    /inside the opened workspace/
  );
  assert.throws(
    () => resolveWorkspaceModelCatalogPath("/workspace/project", "model-catalog.toml"),
    /.json extension/
  );

  const connection = validateLiteLlmConnection({
    endpoint: "https://gateway.example.com/v1",
    model: "company-coding-model",
    apiKey: "secret"
  });
  const config = buildLiteLlmCodexConfig(connection, "/workspace/project/.codex/model-catalog.json");
  assert.equal(config.model_catalog_json, "/workspace/project/.codex/model-catalog.json");
});

test("passes only an allowlisted local environment, the LiteLLM key, and an explicit CA", () => {
  const environment = buildIsolatedEnvironment("litellm-secret", "/tmp/isolated-codex", {
    HOME: "/Users/developer",
    PATH: "/usr/bin:/bin",
    OPENAI_API_KEY: "must-not-pass",
    AZURE_OPENAI_API_KEY: "must-not-pass",
    CODEX_ACCESS_TOKEN: "must-not-pass",
    GITHUB_TOKEN: "must-not-pass",
    CODEX_CA_CERTIFICATE: "/must/not/pass.pem"
  }, "/workspace/project/corporate-root.pem");
  assert.equal(environment.HOME, "/Users/developer");
  assert.equal(environment.PATH, "/usr/bin:/bin");
  assert.equal(environment.LITELLM_API_KEY, "litellm-secret");
  assert.equal(environment.CODEX_HOME, "/tmp/isolated-codex");
  assert.equal(environment.CODEX_CA_CERTIFICATE, "/workspace/project/corporate-root.pem");
  assert.equal(environment.OPENAI_API_KEY, undefined);
  assert.equal(environment.AZURE_OPENAI_API_KEY, undefined);
  assert.equal(environment.CODEX_ACCESS_TOKEN, undefined);
  assert.equal(environment.GITHUB_TOKEN, undefined);
});
