import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAzureCodexConfig,
  buildIsolatedEnvironment,
  normalizeAzureEndpoint,
  validateAzureConnection
} from "../src/azure";

test("normalizes a recognized Azure OpenAI endpoint", () => {
  assert.equal(
    normalizeAzureEndpoint("https://example.openai.azure.com/"),
    "https://example.openai.azure.com/openai"
  );
  assert.equal(
    normalizeAzureEndpoint("https://example.openai.azure.com/openai?ignored=true"),
    "https://example.openai.azure.com/openai"
  );
});

test("rejects non-Azure and non-HTTPS endpoints", () => {
  assert.throws(() => normalizeAzureEndpoint("https://api.openai.com/v1"), /Azure OpenAI hostname/);
  assert.throws(() => normalizeAzureEndpoint("http://example.openai.azure.com"), /HTTPS/);
});

test("builds a Responses-only Azure provider with every external integration disabled", () => {
  const connection = validateAzureConnection({
    endpoint: "https://example.openai.azure.com/openai",
    deployment: "coding-deployment",
    apiVersion: "2025-04-01-preview",
    apiKey: "secret"
  });
  const config = buildAzureCodexConfig(connection);
  assert.equal(config.model_provider, "azure");
  assert.equal(config.model, "coding-deployment");
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
  assert.deepEqual(config.model_providers.azure.query_params, {
    "api-version": "2025-04-01-preview"
  });
  assert.equal(config.model_providers.azure.wire_api, "responses");
  assert.equal(config.model_providers.azure.requires_openai_auth, false);
});

test("passes only an allowlisted local environment plus the Azure credential", () => {
  const environment = buildIsolatedEnvironment("azure-secret", "/tmp/isolated-codex", {
    HOME: "/Users/developer",
    PATH: "/usr/bin:/bin",
    OPENAI_API_KEY: "must-not-pass",
    CODEX_ACCESS_TOKEN: "must-not-pass",
    GITHUB_TOKEN: "must-not-pass"
  });
  assert.equal(environment.HOME, "/Users/developer");
  assert.equal(environment.PATH, "/usr/bin:/bin");
  assert.equal(environment.AZURE_OPENAI_API_KEY, "azure-secret");
  assert.equal(environment.CODEX_HOME, "/tmp/isolated-codex");
  assert.equal(environment.OPENAI_API_KEY, undefined);
  assert.equal(environment.CODEX_ACCESS_TOKEN, undefined);
  assert.equal(environment.GITHUB_TOKEN, undefined);
});
