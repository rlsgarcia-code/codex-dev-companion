import * as path from "node:path";

export const LITELLM_API_KEY_SECRET = "codexDevCompanion.liteLlmApiKey";

export type LiteLlmAuthHeader = "authorization" | "api-key" | "ocp-apim-subscription-key";

export type LiteLlmReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type LiteLlmModelProfile = {
  reasoningEffort?: LiteLlmReasoningEffort;
  temperature?: number;
};

export type LiteLlmModelProfiles = Record<string, LiteLlmModelProfile>;

export type LiteLlmConnection = {
  endpoint: string;
  model: string;
  apiKey: string;
  authHeader?: LiteLlmAuthHeader;
};

export type ValidatedLiteLlmConnection = Required<LiteLlmConnection>;

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
  if (/\/responses$/i.test(pathname)) {
    throw new Error("LiteLLM endpoint must use the Chat Completions route, not /responses.");
  }
  if (url.search) {
    throw new Error("LiteLLM endpoint must not contain query parameters or secrets.");
  }
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function parseLiteLlmAuthHeader(value: unknown): LiteLlmAuthHeader {
  if (value === "api-key" || value === "ocp-apim-subscription-key") return value;
  return "authorization";
}

export function validateLiteLlmConnection(connection: LiteLlmConnection): ValidatedLiteLlmConnection {
  const model = connection.model.trim();
  const apiKey = connection.apiKey.trim();
  if (!model) {
    throw new Error("LiteLLM model alias is required.");
  }
  if (!apiKey) {
    throw new Error("Gateway API or subscription key is required.");
  }
  return {
    endpoint: normalizeLiteLlmEndpoint(connection.endpoint),
    model,
    apiKey,
    authHeader: parseLiteLlmAuthHeader(connection.authHeader)
  };
}

export function openAiClientAuthentication(
  connection: Pick<ValidatedLiteLlmConnection, "apiKey" | "authHeader">
): { apiKey: string; defaultHeaders?: Record<string, string | null>; stripAuthorization: boolean } {
  if (connection.authHeader === "api-key") {
    return {
      apiKey: "local-gateway-header",
      defaultHeaders: { "api-key": connection.apiKey },
      stripAuthorization: true
    };
  }
  if (connection.authHeader === "ocp-apim-subscription-key") {
    return {
      apiKey: "local-gateway-header",
      defaultHeaders: {
        "Ocp-Apim-Subscription-Key": connection.apiKey
      },
      stripAuthorization: true
    };
  }
  return { apiKey: connection.apiKey, stripAuthorization: false };
}

export function parseLiteLlmReasoningEffort(value: unknown): LiteLlmReasoningEffort | undefined {
  if (
    value === "none" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  ) {
    return value;
  }
  return undefined;
}

export function parseOptionalTemperature(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const normalized = typeof value === "string" ? value.trim() : value;
  if (normalized === "") return undefined;
  const temperature = typeof normalized === "number" ? normalized : Number(normalized);
  if (!Number.isFinite(temperature)) {
    throw new Error("Temperature must be a finite number or left blank so it is not sent.");
  }
  return temperature;
}

export function parseLiteLlmModelProfiles(value: unknown): LiteLlmModelProfiles {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const profiles: LiteLlmModelProfiles = {};
  for (const [model, rawProfile] of Object.entries(value)) {
    if (
      !model.trim() ||
      model === "__proto__" ||
      model === "constructor" ||
      model === "prototype" ||
      !rawProfile ||
      typeof rawProfile !== "object" ||
      Array.isArray(rawProfile)
    ) continue;
    const source = rawProfile as Record<string, unknown>;
    const reasoningEffort = parseLiteLlmReasoningEffort(source.reasoningEffort);
    let temperature: number | undefined;
    try {
      temperature = parseOptionalTemperature(source.temperature);
    } catch {
      continue;
    }
    profiles[model] = {
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(temperature !== undefined ? { temperature } : {})
    };
  }
  return profiles;
}

export function liteLlmModelProfile(value: unknown, model: string): LiteLlmModelProfile {
  return parseLiteLlmModelProfiles(value)[model.trim()] ?? {};
}

export function updateLiteLlmModelProfile(
  value: unknown,
  model: string,
  profile: LiteLlmModelProfile
): LiteLlmModelProfiles {
  const profiles = parseLiteLlmModelProfiles(value);
  const alias = model.trim();
  const normalized: LiteLlmModelProfile = {
    ...(parseLiteLlmReasoningEffort(profile.reasoningEffort) ? { reasoningEffort: profile.reasoningEffort } : {}),
    ...(profile.temperature !== undefined
      ? { temperature: parseOptionalTemperature(profile.temperature) }
      : {})
  };
  if (normalized.reasoningEffort === undefined && normalized.temperature === undefined) {
    delete profiles[alias];
  } else {
    profiles[alias] = normalized;
  }
  return profiles;
}

export function chatCompletionsModelOptions(profile: LiteLlmModelProfile): {
  temperature?: number;
  modelKwargs?: Record<string, unknown>;
} {
  return {
    ...(profile.temperature !== undefined ? { temperature: profile.temperature } : {}),
    ...(profile.reasoningEffort
      ? { modelKwargs: { reasoning_effort: profile.reasoningEffort } }
      : {})
  };
}

export function chatCompletionsUrl(connection: Pick<LiteLlmConnection, "endpoint">): string {
  const endpoint = connection.endpoint.replace(/\/$/, "");
  return /\/chat\/completions$/i.test(new URL(endpoint).pathname)
    ? endpoint
    : `${endpoint}/chat/completions`;
}

export function chatCompletionsBaseUrl(connection: Pick<LiteLlmConnection, "endpoint">): string {
  const url = new URL(connection.endpoint.replace(/\/$/, ""));
  url.pathname = url.pathname.replace(/\/chat\/completions$/i, "");
  return url.toString().replace(/\/$/, "");
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
