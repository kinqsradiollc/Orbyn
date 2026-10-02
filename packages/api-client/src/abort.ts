/** Check cancellation on browser, Node and React Native signals alike. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error("Request cancelled.");
}
