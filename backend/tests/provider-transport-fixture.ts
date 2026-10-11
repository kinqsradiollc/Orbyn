import { after } from "node:test";
import { outbound } from "../src/lib/netguard.js";

/** Explicit provider fixture bridge. Production continues using pinned sockets;
 * fixture files that already stub fetch never perform real DNS or network IO.
 */
export function mockProviderTransport() {
  const originalFetch = globalThis.fetch;
  const request = outbound.request,
    lookup = outbound.lookup;
  outbound.lookup = async () => [{ address: "127.0.0.1", family: 4 }];
  outbound.request = async (checked, init) => {
    if (globalThis.fetch === originalFetch)
      throw new Error(
        "Provider fixture requires a mocked fetch; real network refused.",
      );
    return globalThis.fetch(checked.url.href, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal: init.signal,
      redirect: "manual",
    });
  };
  after(() => {
    outbound.request = request;
    outbound.lookup = lookup;
  });
}
