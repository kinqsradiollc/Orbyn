/**
 * Shared helpers for the MCP tests: people, teams, agent keys and one
 * JSON-RPC call in either protocol era. Import after ./setup.js.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";

export const MODERN = "2026-07-28";
export const META_KEYS = {
  version: "io.modelcontextprotocol/protocolVersion",
  client: "io.modelcontextprotocol/clientInfo",
  caps: "io.modelcontextprotocol/clientCapabilities",
};

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/**
 * Nothing on the MCP path may reach the network: every outbound request
 * (globalThis.fetch, and the guarded client feeds and webhooks use) is
 * refused and recorded. Call at the top of an MCP test file; check `calls`
 * is empty at the end and `restore()`.
 */
export async function trapNetwork() {
  const { outbound } = await import("../src/lib/netguard.js");
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  const realRequest = outbound.request;
  globalThis.fetch = (async (input: unknown) => {
    calls.push(`fetch ${String(input instanceof Request ? input.url : input)}`);
    throw new Error("The MCP tests never reach the network.");
  }) as typeof fetch;
  outbound.request = (async (checked: { url: URL }) => {
    calls.push(`outbound ${String(checked.url)}`);
    throw new Error("The MCP tests never reach the network.");
  }) as unknown as typeof outbound.request;
  return {
    calls,
    restore: () => {
      globalThis.fetch = realFetch;
      outbound.request = realRequest;
    },
  };
}

/**
 * Watches the database pools for queries made from inside a read-only
 * transaction's work (an R-tier call): they bypass its client, and with it
 * the read-only guarantee and the replica choice. Each lands in `stray`.
 */
export async function spyPool() {
  const { pool, readPool, insideReadTransaction } =
    await import("../src/db/pool.js");
  const stray: string[] = [];
  const pools = [...new Set([pool, readPool])];
  type Loose = Record<"query" | "connect", (...args: unknown[]) => unknown>;
  // pool.query() takes a client with pool.connect() as it starts: that one
  // is the same stray, not a second.
  let inQuery = false;
  for (const p of pools as unknown as Loose[]) {
    const query = p.query;
    const connect = p.connect;
    p.query = function (this: unknown, ...args: unknown[]) {
      if (insideReadTransaction.getStore()) {
        const text = args[0] as string | { text?: string };
        stray.push(
          String(typeof text === "string" ? text : text?.text).slice(0, 160),
        );
      }
      inQuery = true;
      try {
        return query.apply(this, args);
      } finally {
        inQuery = false;
      }
    };
    p.connect = function (this: unknown, ...args: unknown[]) {
      if (insideReadTransaction.getStore() && !inQuery)
        stray.push("pool.connect()");
      return connect.apply(this, args);
    };
  }
  return {
    stray,
    restore: () => {
      for (const p of pools as unknown as Record<string, unknown>[]) {
        delete p.query;
        delete p.connect;
      }
    },
  };
}

export type Person = { token: string; id: string; email: string; name: string };

export function helpers(app: FastifyInstance) {
  const call = (
    token: string | null,
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    url: string,
    payload?: unknown,
  ) =>
    app.inject({
      method,
      url,
      headers: token ? bearer(token) : {},
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  // Each sign-up from its own address, so the per-address sign-up limit
  // never decides how many people a test file can make.
  let signups = 0;
  const register = async (prefix: string, name = prefix): Promise<Person> => {
    const email = `${prefix}-${randomUUID()}@example.com`;
    signups++;
    const r = await app.inject({
      method: "POST",
      url: "/auth/register",
      remoteAddress: `10.66.${Math.floor(signups / 250) % 250}.${signups % 250}`,
      payload: { email, password: "a-long-test-password", name },
    });
    const body = r.json() as { token: string; user: { id: string } };
    return { token: body.token, id: body.user.id, email, name };
  };

  const team = async (
    owner: Person,
    name: string,
    members: [Person, string][] = [],
  ) => {
    const created = await call(owner.token, "POST", "/teams", { name });
    const id = created.json().id as string;
    for (const [who, role] of members)
      await call(owner.token, "POST", `/teams/${id}/members`, {
        email: who.email,
        role,
      });
    return id;
  };

  /**
   * An agent key made straight through the service (the route's own tests
   * use POST /me/agent-keys, which is rate limited per address).
   */
  const agentKey = async (
    who: Person,
    body: Record<string, unknown> = {},
  ): Promise<{ key: string; id: string }> => {
    const { createAgentKey } = await import("../src/modules/agents/service.js");
    const made = await createAgentKey(who.id, { name: "Test agent", ...body });
    return { key: made.key, id: made.grant.id };
  };

  const parse = (body: string) => {
    try {
      return body ? JSON.parse(body) : null;
    } catch {
      return body;
    }
  };

  /** One raw POST to /mcp. */
  const post = async (
    payload: unknown,
    headers: Record<string, string> = {},
  ) => {
    const r = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { "content-type": "application/json", ...headers },
      payload: typeof payload === "string" ? payload : JSON.stringify(payload),
    });
    return { status: r.statusCode, body: parse(r.body), headers: r.headers };
  };

  /** A 2025-era JSON-RPC request. */
  const legacy = (
    token: string,
    method: string,
    params?: unknown,
    extra: Record<string, string> = {},
  ) =>
    post(
      {
        jsonrpc: "2.0",
        id: 1,
        method,
        ...(params === undefined ? {} : { params }),
      },
      {
        ...bearer(token),
        accept: "application/json, text/event-stream",
        ...extra,
      },
    );

  /** A 2026-07-28 request, with its envelope and headers. */
  const modern = (
    token: string,
    method: string,
    params: Record<string, unknown> = {},
    extra: Record<string, string> = {},
  ) =>
    post(
      {
        jsonrpc: "2.0",
        id: 7,
        method,
        params: {
          ...params,
          _meta: {
            [META_KEYS.version]: MODERN,
            [META_KEYS.client]: { name: "test", version: "1" },
            [META_KEYS.caps]: {},
          },
        },
      },
      {
        ...bearer(token),
        "mcp-protocol-version": MODERN,
        "mcp-method": method,
        ...(typeof params.name === "string" && method === "tools/call"
          ? { "mcp-name": params.name }
          : {}),
        ...(typeof params.uri === "string" && method === "resources/read"
          ? { "mcp-name": params.uri }
          : {}),
        ...extra,
      },
    );

  /** tools/call (2025 era), returning the tool result. */
  const tool = async (
    token: string,
    name: string,
    args: Record<string, unknown> = {},
  ) => {
    const r = await legacy(token, "tools/call", { name, arguments: args });
    return r.body?.result as
      | {
          content: { type: string; text: string }[];
          structuredContent?: any;
          isError?: boolean;
        }
      | undefined;
  };

  return { call, register, team, agentKey, post, legacy, modern, tool };
}
