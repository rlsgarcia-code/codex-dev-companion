import { Agent as UndiciAgent, fetch as undiciFetch } from "undici";

export type GatewayTransport = (
  input: RequestInfo | URL,
  init?: RequestInit & { dispatcher?: UndiciAgent }
) => Promise<Response>;

export function combinedAbortSignal(
  requestSignal?: AbortSignal | null,
  runSignal?: AbortSignal
): AbortSignal | undefined {
  const signals = [requestSignal, runSignal]
    .filter((signal): signal is AbortSignal => Boolean(signal));
  if (!signals.length) return undefined;
  if (signals.length === 1 || signals[0] === signals[1]) return signals[0];
  return AbortSignal.any(signals);
}

export function gatewayFetch(
  allowedUrl: string,
  stripAuthorization: boolean,
  dispatcher: UndiciAgent | undefined,
  runSignal?: AbortSignal,
  transport: GatewayTransport = undiciFetch as unknown as GatewayTransport
): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    validateGatewayRequest(input, init, allowedUrl);
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    );
    const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const signal = combinedAbortSignal(requestSignal, runSignal);
    if (stripAuthorization) headers.delete("authorization");
    const response = await transport(input, {
      ...init,
      headers,
      redirect: "manual",
      ...(signal ? { signal } : {}),
      ...(dispatcher ? { dispatcher } : {})
    });
    if (response.status >= 300 && response.status < 400) {
      throw new Error("The configured model route returned a redirect. Configure its final URL; redirects are disabled.");
    }
    return response;
  }) as typeof globalThis.fetch;
}

export function validateGatewayRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  allowedUrl: string
): void {
  const target = new URL(input instanceof Request ? input.url : input.toString());
  const allowed = new URL(allowedUrl);
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  const allowedProtocol = allowed.protocol === "https:"
    || (allowed.protocol === "http:" && loopbackHosts.has(allowed.hostname));
  if (
    !allowedProtocol ||
    target.protocol !== allowed.protocol ||
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    target.href !== allowed.href
  ) {
    throw new Error("Blocked a provider request outside the exact configured model route.");
  }
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (method !== "POST") {
    throw new Error("Blocked a non-POST request to the configured model route.");
  }
}
