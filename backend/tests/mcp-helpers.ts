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

  const register = async (prefix: string, name = prefix): Promise<Person> => {
    const email = `${prefix}-${randomUUID()}@example.com`;
    const r = await app.inject({
      method: "POST",
      url: "/auth/register",
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
