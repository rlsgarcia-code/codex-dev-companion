import * as path from "node:path";

export const LITELLM_API_KEY_SECRET = "codexDevCompanion.liteLlmApiKey";

export type LiteLlmConnection = {
  endpoint: string;
  model: string;
  apiKey: string;
};

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
