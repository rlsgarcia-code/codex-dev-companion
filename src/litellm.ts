import * as path from "node:path";

export const LITELLM_API_KEY_SECRET = "codexDevCompanion.liteLlmApiKey";

export type LiteLlmConnection = {
  endpoint: string;
  model: string;
  apiKey: string;
};

const SAFE_ENVIRONMENT_KEYS = [
  "HOME",
  "USER",
  "LOGNAME",
  "PATH",
  "SHELL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "TERM",
  "COLORTERM",
  "SystemRoot",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "COMSPEC",
  "PATHEXT"
] as const;

export function normalizeLiteLlmEndpoint(value: string): string {
  const raw = value.trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("LiteLLM endpoint must be a valid HTTPS URL.");
  }
  if (url.protocol !== "https:") {
    throw new Error("LiteLLM endpoint must use HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("LiteLLM base URL must not contain credentials.");
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  if (!pathname.endsWith("/v1")) {
    throw new Error("LiteLLM base URL must end at /v1 and must not include /responses.");
  }
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function validateLiteLlmConnection(connection: LiteLlmConnection): LiteLlmConnection {
  const model = connection.model.trim();
  const apiKey = connection.apiKey.trim();
  if (!model) {
    throw new Error("LiteLLM model alias is required.");
  }
  if (!apiKey) {
    throw new Error("LiteLLM virtual key is required.");
  }
  return {
    endpoint: normalizeLiteLlmEndpoint(connection.endpoint),
    model,
    apiKey
  };
}

export function buildIsolatedEnvironment(
  apiKey: string,
  codexHome: string,
  source: NodeJS.ProcessEnv = process.env,
  caCertificatePath?: string
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const key of SAFE_ENVIRONMENT_KEYS) {
    const value = source[key];
    if (value) {
      environment[key] = value;
    }
  }
  environment.CODEX_HOME = path.resolve(codexHome);
  environment.LITELLM_API_KEY = apiKey;
  if (caCertificatePath) {
    environment.CODEX_CA_CERTIFICATE = path.resolve(caCertificatePath);
  }
  return environment;
}

export function resolveWorkspaceCertificatePath(
  workspaceRoot: string,
  configuredPath: string
): string {
  const root = path.resolve(workspaceRoot);
  const certificate = path.resolve(root, configuredPath.trim());
  const relative = path.relative(root, certificate);
  if (!configuredPath.trim() || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Gateway CA certificate must be a .pem file inside the opened workspace.");
  }
  if (path.extname(certificate).toLowerCase() !== ".pem") {
    throw new Error("Gateway CA certificate must use the .pem extension.");
  }
  return certificate;
}

export function resolveWorkspaceModelCatalogPath(
  workspaceRoot: string,
  configuredPath: string
): string {
  const root = path.resolve(workspaceRoot);
  const catalog = path.resolve(root, configuredPath.trim());
  const relative = path.relative(root, catalog);
  if (!configuredPath.trim() || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Model catalog must be a JSON file inside the opened workspace.");
  }
  if (path.extname(catalog).toLowerCase() !== ".json") {
    throw new Error("Model catalog must use the .json extension.");
  }
  return catalog;
}

export function buildLiteLlmCodexConfig(connection: LiteLlmConnection, modelCatalogPath?: string) {
  return {
    model: connection.model,
    model_provider: "litellm",
    ...(modelCatalogPath ? { model_catalog_json: modelCatalogPath } : {}),
    web_search: "disabled",
    check_for_update_on_startup: false,
    analytics: {
      enabled: false
    },
    feedback: {
      enabled: false
    },
    otel: {
      exporter: "none",
      trace_exporter: "none",
      metrics_exporter: "none",
      log_user_prompt: false
    },
    apps: {
      _default: {
        enabled: false,
        open_world_enabled: false,
        destructive_enabled: false
      }
    },
    mcp_servers: {},
    plugins: {},
    features: {
      api_key_model_discovery: false,
      apps: false,
      browser_use: false,
      browser_use_external: false,
      image_generation: false,
      in_app_updates: false,
      plugin_sharing: false,
      plugins: false,
      realtime_conversation: false,
      recommended_plugins: false,
      remote_plugin: false,
      skill_mcp_dependency_install: false,
      system_proxy_fallback: false,
      workspace_dependencies: false
    },
    model_providers: {
      litellm: {
        name: "LiteLLM Gateway",
        base_url: connection.endpoint,
        env_key: "LITELLM_API_KEY",
        wire_api: "responses",
        requires_openai_auth: false,
        supports_websockets: false,
        request_max_retries: 4,
        stream_max_retries: 10,
        stream_idle_timeout_ms: 300_000
      }
    }
  };
}
