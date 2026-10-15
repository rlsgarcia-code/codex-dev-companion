import { Agent as UndiciAgent, fetch as undiciFetch } from "undici";
import { combinedAbortSignal, type GatewayTransport } from "./gateway";

const MCP_METHODS = new Set(["POST", "GET", "DELETE"]);

export function mcpFetch(
  allowedUrl: string,
  dispatcher: UndiciAgent | undefined,
  runSignal?: AbortSignal,
  transport: GatewayTransport = undiciFetch as unknown as GatewayTransport
): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    validateMcpRequest(input, init, allowedUrl);
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
  allowedUrl: string
): void {
  const target = new URL(input instanceof Request ? input.url : input.toString());
  const allowed = new URL(allowedUrl);
  if (
    target.protocol !== "https:" ||
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    target.href !== allowed.href
  ) {
    throw new Error("Blocked an MCP request outside its configured corporate route.");
  }
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (!MCP_METHODS.has(method)) {
    throw new Error("Blocked an unsupported HTTP method for the configured MCP route.");
  }
}
