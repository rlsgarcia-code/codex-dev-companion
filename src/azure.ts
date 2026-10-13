import * as path from "node:path";

export const AZURE_API_KEY_SECRET = "codexDevCompanion.azureOpenAIApiKey";

export type AzureConnection = {
  endpoint: string;
  deployment: string;
  apiVersion: string;
  apiKey: string;
};

const AZURE_HOST_SUFFIXES = [
  ".openai.azure.com",
  ".services.ai.azure.com",
  ".cognitiveservices.azure.com"
];

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

export function normalizeAzureEndpoint(value: string): string {
  const raw = value.trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Azure OpenAI endpoint must be a valid HTTPS URL.");
  }
  if (url.protocol !== "https:") {
    throw new Error("Azure OpenAI endpoint must use HTTPS.");
  }
  const hostname = url.hostname.toLowerCase();
  if (!AZURE_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new Error(
      "Endpoint must be an Azure OpenAI hostname (*.openai.azure.com, *.services.ai.azure.com, or *.cognitiveservices.azure.com)."
    );
  }
  if (!url.pathname || url.pathname === "/") {
    url.pathname = "/openai";
  }
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function validateAzureConnection(connection: AzureConnection): AzureConnection {
  const deployment = connection.deployment.trim();
  const apiVersion = connection.apiVersion.trim();
  const apiKey = connection.apiKey.trim();
  if (!deployment) {
    throw new Error("Azure OpenAI deployment name is required.");
  }
  if (!apiVersion) {
    throw new Error("Azure OpenAI API version is required.");
  }
  if (!apiKey) {
    throw new Error("Azure OpenAI API key is required.");
  }
  return {
    endpoint: normalizeAzureEndpoint(connection.endpoint),
    deployment,
    apiVersion,
    apiKey
  };
}

export function buildIsolatedEnvironment(
  apiKey: string,
  codexHome: string,
  source: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const key of SAFE_ENVIRONMENT_KEYS) {
    const value = source[key];
    if (value) {
      environment[key] = value;
    }
  }
  environment.CODEX_HOME = path.resolve(codexHome);
  environment.AZURE_OPENAI_API_KEY = apiKey;
  return environment;
}

export function buildAzureCodexConfig(connection: AzureConnection) {
  return {
    model: connection.deployment,
    model_provider: "azure",
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
      azure: {
        name: "Azure OpenAI",
        base_url: connection.endpoint,
        env_key: "AZURE_OPENAI_API_KEY",
        query_params: { "api-version": connection.apiVersion },
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
