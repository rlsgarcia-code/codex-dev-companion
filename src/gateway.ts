import { Agent as UndiciAgent, fetch as undiciFetch } from "undici";

export function gatewayFetch(
  stripAuthorization: boolean,
  dispatcher: UndiciAgent | undefined
): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    );
    if (stripAuthorization) headers.delete("authorization");
    return await undiciFetch(input as never, {
      ...init,
      headers,
      ...(dispatcher ? { dispatcher } : {})
    } as never) as unknown as Response;
  }) as typeof globalThis.fetch;
}
