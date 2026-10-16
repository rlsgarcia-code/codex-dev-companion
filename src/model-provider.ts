import {
  LITELLM_API_KEY_SECRET,
  normalizeLiteLlmEndpoint,
  openAiClientAuthentication,
  parseLiteLlmAuthHeader,
  validateLiteLlmConnection,
  type LiteLlmAuthHeader,
  type LiteLlmConnection
} from "./litellm";

declare const __LOCAL_COMPANION_PROVIDER_VARIANT__: string | undefined;

export type ModelProvider = "litellm" | "ollama" | "openai";
export type ProviderVariant = "litellm" | "ollama" | "openai";

export const OPENAI_API_KEY_SECRET = "codexDevCompanion.openAiApiKey";
export const OPENAI_BASE_URL = "https://api.openai.com/v1";
export const OLLAMA_DEFAULT_BASE_URL = "http://127.0.0.1:11434/v1";

function parseProviderVariant(value: unknown): ProviderVariant {
  return value === "ollama" || value === "openai" ? value : "litellm";
}

export const PROVIDER_VARIANT = parseProviderVariant(
  typeof __LOCAL_COMPANION_PROVIDER_VARIANT__ === "string"
    ? __LOCAL_COMPANION_PROVIDER_VARIANT__
    : "litellm"
);

export function modelProvidersForVariant(variant: ProviderVariant): readonly ModelProvider[] {
  return variant === "litellm"
    ? ["litellm"]
    : variant === "ollama"
    ? ["litellm", "ollama"]
    : ["litellm", "openai"];
}

export const AVAILABLE_MODEL_PROVIDERS: readonly ModelProvider[] = modelProvidersForVariant(PROVIDER_VARIANT);

type ModelProviderConfiguration = {
  get<T>(section: string): T | undefined;
  inspect<T>(section: string): {
    globalValue?: T;
    workspaceValue?: T;
    workspaceFolderValue?: T;
  } | undefined;
};

export type ModelConnection = Required<LiteLlmConnection> & {
  provider: ModelProvider;
};

export function parseModelProvider(value: unknown): ModelProvider {
  return value === "ollama" || value === "openai" ? value : "litellm";
}

export function modelProviderSettingIsExplicit(configuration: ModelProviderConfiguration): boolean {
  const inspected = configuration.inspect<unknown>("modelProvider");
  return inspected?.globalValue !== undefined
    || inspected?.workspaceValue !== undefined
    || inspected?.workspaceFolderValue !== undefined;
}

export function configuredModelProvider(
  configuration: ModelProviderConfiguration,
  variant: ProviderVariant = PROVIDER_VARIANT
): ModelProvider {
  const configured = modelProviderSettingIsExplicit(configuration)
    ? parseModelProvider(configuration.get("modelProvider"))
    : variant;
  return modelProvidersForVariant(variant).includes(configured) ? configured : variant;
}

export function assertModelProviderAvailable(
  provider: ModelProvider,
  variant: ProviderVariant = PROVIDER_VARIANT
): void {
  if (!modelProvidersForVariant(variant).includes(provider)) {
    throw new Error(
      `${modelProviderLabel(provider)} is not included in this extension package. Install the explicit ${provider} VSIX variant first.`
    );
  }
}

export function modelProviderLabel(provider: ModelProvider): string {
  if (provider === "ollama") return "Ollama local";
  if (provider === "openai") return "OpenAI API";
  return "LiteLLM";
}

export function modelProviderSecret(provider: ModelProvider): string | undefined {
  if (provider === "openai") return OPENAI_API_KEY_SECRET;
  if (provider === "litellm") return LITELLM_API_KEY_SECRET;
  return undefined;
}

export function modelProviderRequiresKey(provider: ModelProvider): boolean {
  return provider !== "ollama";
}

export function modelProviderSupportsCatalog(provider: ModelProvider): boolean {
  return provider === "litellm";
}

export function modelProviderSupportsCorporateCa(provider: ModelProvider): boolean {
  return provider === "litellm";
}

export function modelProviderDefaultEndpoint(provider: ModelProvider): string {
  if (provider === "ollama") return OLLAMA_DEFAULT_BASE_URL;
  if (provider === "openai") return OPENAI_BASE_URL;
  return "";
}

export function normalizeOllamaEndpoint(value: string): string {
  const raw = value.trim() || OLLAMA_DEFAULT_BASE_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Ollama endpoint must be a valid loopback URL.");
  }
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (!loopbackHosts.has(url.hostname) || (url.protocol !== "http:" && url.protocol !== "https:")) {
    throw new Error("Ollama endpoint must use http(s) on localhost, 127.0.0.1, or [::1].");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Ollama endpoint must not contain credentials, query parameters, or fragments.");
  }
  let pathname = url.pathname.replace(/\/+$/, "");
  if (!pathname) pathname = "/v1";
  if (/\/responses$/i.test(pathname)) {
    throw new Error("Ollama endpoint must use its OpenAI-compatible Chat Completions route, not /responses.");
  }
  url.pathname = pathname;
  return url.toString().replace(/\/$/, "");
}

export function ollamaTagsUrl(value: string): string {
  const base = new URL(normalizeOllamaEndpoint(value));
  base.pathname = "/api/tags";
  base.search = "";
  base.hash = "";
  return base.toString();
}

export function validateModelConnection(
  input: LiteLlmConnection & { provider?: unknown },
  variant: ProviderVariant = PROVIDER_VARIANT
): ModelConnection {
  const provider = parseModelProvider(input.provider);
  assertModelProviderAvailable(provider, variant);
  const model = input.model.trim();
  if (!model) throw new Error(`${modelProviderLabel(provider)} model is required.`);

  if (provider === "litellm") {
    return { provider, ...validateLiteLlmConnection(input) };
  }
  if (provider === "openai") {
    const apiKey = input.apiKey.trim();
    if (!apiKey) throw new Error("OpenAI API key is required.");
    const suppliedEndpoint = input.endpoint.trim() || OPENAI_BASE_URL;
    if (normalizeLiteLlmEndpoint(suppliedEndpoint) !== OPENAI_BASE_URL) {
      throw new Error(`OpenAI API variant accepts only ${OPENAI_BASE_URL}.`);
    }
    return {
      provider,
      endpoint: OPENAI_BASE_URL,
      model,
      apiKey,
      authHeader: "authorization"
    };
  }
  return {
    provider,
    endpoint: normalizeOllamaEndpoint(input.endpoint),
    model,
    apiKey: "ollama",
    authHeader: "authorization"
  };
}

export function modelClientAuthentication(connection: ModelConnection): {
  apiKey: string;
  defaultHeaders?: Record<string, string | null>;
  stripAuthorization: boolean;
} {
  if (connection.provider === "ollama") {
    return { apiKey: "ollama", stripAuthorization: true };
  }
  if (connection.provider === "openai") {
    return { apiKey: connection.apiKey, stripAuthorization: false };
  }
  return openAiClientAuthentication(connection);
}

export function modelProviderAuthHeader(provider: ModelProvider, value: unknown): LiteLlmAuthHeader {
  return provider === "litellm" ? parseLiteLlmAuthHeader(value) : "authorization";
}
