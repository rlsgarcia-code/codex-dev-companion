import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAzureCodexConfig,
  buildIsolatedEnvironment,
  isRecognizedAzureOpenAIHost,
  normalizeAzureEndpoint,
  resolveWorkspaceCertificatePath,
  resolveWorkspaceModelCatalogPath,
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
  assert.equal(
    normalizeAzureEndpoint("https://example.openai.azure.com/openai/"),
    "https://example.openai.azure.com/openai"
  );
});

test("rejects non-Azure, non-HTTPS, and deployment-specific API bases", () => {
  assert.throws(() => normalizeAzureEndpoint("https://api.openai.com/v1"), /recognized Azure OpenAI host/);
  assert.throws(() => normalizeAzureEndpoint("http://example.openai.azure.com"), /HTTPS/);
  assert.throws(
    () => normalizeAzureEndpoint("https://example.openai.azure.com/openai/deployments/coding"),
    /must not include \/deployments/
  );
});

test("allows an explicitly approved HTTPS corporate gateway and preserves its path", () => {
  const gateway = "https://gateway.example.com/ia/openai-azure/openai/";
  assert.equal(isRecognizedAzureOpenAIHost(gateway), false);
  assert.throws(() => normalizeAzureEndpoint(gateway), /corporate gateway/);
  assert.equal(
    normalizeAzureEndpoint(gateway, true),
    "https://gateway.example.com/ia/openai-azure/openai"
  );
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
  assert.equal(
    "env_key" in config.model_providers.azure
      ? config.model_providers.azure.env_key
      : undefined,
    "AZURE_OPENAI_API_KEY"
  );
});

test("uses the Azure api-key header for a corporate gateway", () => {
  const connection = validateAzureConnection({
    endpoint: "https://gateway.example.com/ia/openai-azure/openai",
    deployment: "coding-deployment",
    apiVersion: "2025-04-01-preview",
    apiKey: "secret",
    allowCorporateGateway: true
  });
  const config = buildAzureCodexConfig(connection);
  const headers = "env_http_headers" in config.model_providers.azure
    ? config.model_providers.azure.env_http_headers
    : undefined;
  assert.deepEqual(headers, {
    "api-key": "AZURE_OPENAI_API_KEY"
  });
  assert.equal("env_key" in config.model_providers.azure, false);
});

test("keeps the corporate CA certificate inside the workspace", () => {
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

  const connection = validateAzureConnection({
    endpoint: "https://gateway.example.com/ia/openai-azure/openai",
    deployment: "corporate-codex-alias",
    apiVersion: "2025-04-01-preview",
    apiKey: "secret",
    allowCorporateGateway: true
  });
  const config = buildAzureCodexConfig(connection, "/workspace/project/.codex/model-catalog.json");
  assert.equal(config.model_catalog_json, "/workspace/project/.codex/model-catalog.json");
});

test("passes only an allowlisted local environment, the Azure credential, and an explicit CA", () => {
  const environment = buildIsolatedEnvironment("azure-secret", "/tmp/isolated-codex", {
    HOME: "/Users/developer",
    PATH: "/usr/bin:/bin",
    OPENAI_API_KEY: "must-not-pass",
    CODEX_ACCESS_TOKEN: "must-not-pass",
    GITHUB_TOKEN: "must-not-pass",
    CODEX_CA_CERTIFICATE: "/must/not/pass.pem"
  }, "/workspace/project/corporate-root.pem");
  assert.equal(environment.HOME, "/Users/developer");
  assert.equal(environment.PATH, "/usr/bin:/bin");
  assert.equal(environment.AZURE_OPENAI_API_KEY, "azure-secret");
  assert.equal(environment.CODEX_HOME, "/tmp/isolated-codex");
  assert.equal(environment.CODEX_CA_CERTIFICATE, "/workspace/project/corporate-root.pem");
  assert.equal(environment.OPENAI_API_KEY, undefined);
  assert.equal(environment.CODEX_ACCESS_TOKEN, undefined);
  assert.equal(environment.GITHUB_TOKEN, undefined);
});
