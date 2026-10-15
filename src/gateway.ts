import { Agent as UndiciAgent, fetch as undiciFetch } from "undici";

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
  stripAuthorization: boolean,
  dispatcher: UndiciAgent | undefined,
  runSignal?: AbortSignal
): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    );
    const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const signal = combinedAbortSignal(requestSignal, runSignal);
    if (stripAuthorization) headers.delete("authorization");
    return await undiciFetch(input as never, {
      ...init,
      headers,
      ...(signal ? { signal } : {}),
      ...(dispatcher ? { dispatcher } : {})
    } as never) as unknown as Response;
  }) as typeof globalThis.fetch;
}
