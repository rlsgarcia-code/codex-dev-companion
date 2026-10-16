import { Agent as UndiciAgent, fetch as undiciFetch } from "undici";
import { combinedAbortSignal, type GatewayTransport } from "./gateway";

const MCP_METHODS = new Set(["POST", "GET", "DELETE"]);

export function mcpFetch(
  allowedUrl: string,
  dispatcher: UndiciAgent | undefined,
  runSignal?: AbortSignal,
  transport: GatewayTransport = undiciFetch as unknown as GatewayTransport,
  options: { allowOAuthEndpoints?: boolean } = {}
): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (options.allowOAuthEndpoints) {
      validateMcpRequest(input, init, allowedUrl, true);
    } else {
      validateMcpRequest(input, init, allowedUrl);
    }
    const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const signal = combinedAbortSignal(requestSignal, runSignal);
    const response = await transport(input, {
      ...init,
      redirect: "manual",
      ...(signal ? { signal } : {}),
      ...(dispatcher ? { dispatcher } : {})
    });
    if (response.status >= 300 && response.status < 400) {
      throw new Error("The configured MCP route returned a redirect. Configure its final HTTPS URL; redirects are disabled.");
    }
    return response;
  }) as typeof globalThis.fetch;
}

export function validateMcpRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  allowedUrl: string,
  allowOAuthEndpoints = false
): void {
  const target = new URL(input instanceof Request ? input.url : input.toString());
  const allowed = new URL(allowedUrl);
  const isExactMcpRoute = target.href === allowed.href;
  const exactRouteViolation = target.href !== allowed.href;
  const isApprovedOAuthEndpoint = allowOAuthEndpoints
    && target.protocol === "https:"
    && !target.username
    && !target.password
    && !target.hash;
  if ((exactRouteViolation && !isApprovedOAuthEndpoint) || (!isExactMcpRoute && !isApprovedOAuthEndpoint)) {
    throw new Error("Blocked an MCP request outside its configured corporate route.");
  }
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (!MCP_METHODS.has(method)) {
    throw new Error("Blocked an unsupported HTTP method for the configured MCP route.");
  }
}
