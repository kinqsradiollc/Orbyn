/**
 * The scenario tests' agent (H9): a person's connection made the way a real
 * one is (signing in with Orbyn, or an agent key), and an MCP client that
 * speaks 2026-07-28 over the same /mcp address an outside agent uses,
 * answering the chat's forms when it declares them. No MCP client SDK is
 * installed here (only the server's), so this is the JSON-RPC a client
 * sends, one request per call. Import after ./setup.js.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  META_KEYS,
  MODERN,
  bearer,
  helpers,
  type Person,
} from "./mcp-helpers.js";

export type ToolResult = {
  content: { type: string; text: string }[];
  structuredContent?: any;
  isError?: boolean;
  _meta?: Record<string, any>;
};

/** What the person does with a form the chat shows. */
export type FormAnswer = {
  action: "accept" | "decline" | "cancel";
  content?: Record<string, unknown>;
};

/** One form the server asked the chat to show. */
export type Asked = {
  key: string;
  message: string;
  schema: Record<string, any>;
};

let addresses = 0;
/** A fresh address per sign-in step, so per-address limits never decide. */
const address = () =>
  `10.93.${Math.floor(addresses / 250) % 250}.${addresses++ % 250}`;

/** The error code a tool answered with, if any. */
export const codeOf = (r: ToolResult) =>
  r._meta?.["orbyn/error"]?.code as string | undefined;

/** The structured answer of a call that must have worked. */
export function ok(r: ToolResult, what = "call") {
  assert.ok(!r.isError, `${what}: ${r.content?.[0]?.text}`);
  return r.structuredContent;
}

/** A typed id's uuid: `task:<uuid>` → `<uuid>`. */
export const idOf = (typed: string) => typed.replace(/^\w+:/, "").slice(0, 36);

/**
 * An MCP client for one connection. `forms` declares form elicitation (an
 * app that can ask the person in the chat); without it, asking goes to the
 * Review inbox and a push, as for an app that can't.
 */
export class AgentClient {
  /** Every form the server asked this client to show, in order. */
  readonly asked: Asked[] = [];
  private id = 0;

  constructor(
    private readonly app: FastifyInstance,
    readonly token: string,
    readonly grant: string,
    private readonly options: { forms?: boolean; name?: string } = {},
  ) {}

  private caps() {
    return this.options.forms ? { elicitation: { form: {} } } : {};
  }

  /** One JSON-RPC request, answered with its HTTP status and headers. */
  async request(
    method: string,
    params: Record<string, unknown> = {},
    headers: Record<string, string> = {},
  ) {
    const r = await this.app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        "content-type": "application/json",
        ...bearer(this.token),
        "mcp-protocol-version": MODERN,
        "mcp-method": method,
        ...(method === "tools/call" && typeof params.name === "string"
          ? { "mcp-name": params.name }
          : {}),
        ...headers,
      },
      payload: JSON.stringify({
        jsonrpc: "2.0",
        id: ++this.id,
        method,
        params: {
          ...params,
          _meta: {
            [META_KEYS.version]: MODERN,
            [META_KEYS.client]: {
              name: this.options.name ?? "scenario",
              version: "1",
            },
            [META_KEYS.caps]: this.caps(),
          },
        },
      }),
    });
    return {
      status: r.statusCode,
      headers: r.headers,
      body: r.body ? (JSON.parse(r.body) as any) : null,
    };
  }

  /**
   * tools/call. When the server needs the person's answer first
   * (input_required), `answer` plays the person in the chat and the call is
   * sent again with the answers, as a client does.
   */
  async call(
    name: string,
    args: Record<string, unknown> = {},
    answer?: (asked: Asked) => FormAnswer,
  ): Promise<ToolResult> {
    const first = await this.request("tools/call", { name, arguments: args });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.ok(first.body.result, JSON.stringify(first.body));
    let result = first.body.result;
    if (result.resultType !== "input_required") return result as ToolResult;
    assert.ok(answer, `${name} asked the person, and no one answered`);
    const responses: Record<string, FormAnswer> = {};
    for (const [key, req] of Object.entries<any>(result.inputRequests)) {
      assert.equal(req.method, "elicitation/create");
      const asked = {
        key,
        message: req.params.message as string,
        schema: req.params.requestedSchema,
      };
      this.asked.push(asked);
      responses[key] = answer(asked);
    }
    const again = await this.request("tools/call", {
      name,
      arguments: args,
      requestState: result.requestState,
      inputResponses: responses,
    });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    result = again.body.result;
    assert.ok(result, JSON.stringify(again.body));
    return result as ToolResult;
  }

  /** A call that must work, returning its structured answer. */
  async ok(name: string, args: Record<string, unknown> = {}) {
    return ok(await this.call(name, args), name);
  }
}

/** Yes, in the chat. */
export const YES = (): FormAnswer => ({
  action: "accept",
  content: { confirm: true },
});

/**
 * Makes the MCP client for a person: `kind: "key"` makes an agent key (as
 * Settings → Connected agents does); `kind: "oauth"` signs in with Orbyn as
 * an app does (registering itself, the consent page, the code exchange with
 * PKCE), getting an oat_ access token.
 */
export async function connect(
  app: FastifyInstance,
  who: Person,
  body: {
    kind?: "key" | "oauth";
    access?: "read" | "suggest" | "write";
    trust?: "full" | "ask" | "suggest";
    team_ids?: string[];
    personal?: boolean;
    toolsets?: string[];
    bookings?: boolean;
    notify_teammates?: boolean;
    forms?: boolean;
    name?: string;
  } = {},
): Promise<AgentClient> {
  const { forms, kind = "key", name = "Scenario agent", ...grant } = body;
  if (kind === "key") {
    const { createAgentKey } = await import("../src/modules/agents/service.js");
    const { bookings, notify_teammates, toolsets, ...rest } = grant;
    const made = await createAgentKey(who.id, {
      name,
      access: "write",
      ...rest,
      // Core is always on; the rest as chosen.
      toolsets: [
        ...new Set([
          "core",
          ...(toolsets ?? []),
          ...(bookings ? ["booking"] : []),
        ]),
      ] as never,
    });
    if (notify_teammates) {
      // Settings → Connected agents' "Let it notify teammates".
      const { pool } = await import("../src/db/pool.js");
      await pool.query(
        `UPDATE agent_grants SET flags = flags || '{"notify_teammates": true}'
          WHERE id = $1`,
        [made.grant.id],
      );
    }
    return new AgentClient(app, made.key, made.grant.id, { forms, name });
  }
  const { env } = await import("../src/config/env.js");
  const { pool } = await import("../src/db/pool.js");
  const inject = (
    url: string,
    opts: {
      token?: string;
      json?: unknown;
      form?: Record<string, string>;
    },
  ) =>
    app.inject({
      method: "POST",
      url,
      remoteAddress: address(),
      headers: {
        ...(opts.token ? bearer(opts.token) : {}),
        ...(opts.form
          ? { "content-type": "application/x-www-form-urlencoded" }
          : {}),
      },
      ...(opts.form
        ? { payload: new URLSearchParams(opts.form).toString() }
        : { payload: opts.json as object }),
    });
  const callback = "http://127.0.0.1:33418/callback";
  const registered = await inject("/oauth/register", {
    json: { client_name: name, redirect_uris: [callback] },
  });
  assert.equal(registered.statusCode, 201, registered.body);
  const client = registered.json().client_id as string;
  const verifier = randomBytes(40).toString("base64url");
  const request = {
    response_type: "code",
    client_id: client,
    redirect_uri: callback,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state: `st-${randomBytes(6).toString("hex")}`,
    scope: "orbyn:write offline_access",
    resource: env.MCP_PUBLIC_URL,
  };
  // Signed in just now: the password counts as confirming it's them.
  const session = (
    await inject("/auth/login", {
      json: { email: who.email, password: "a-long-test-password" },
    })
  ).json().token as string;
  const allowed = await inject("/oauth/authorize", {
    token: session,
    json: {
      request,
      access: grant.access ?? "write",
      ...(grant.trust ? { trust: grant.trust } : {}),
      personal: grant.personal ?? true,
      team_ids: grant.team_ids ?? [],
      toolsets: (grant.toolsets ?? []).filter(
        (t) => t !== "core" && t !== "booking",
      ),
      bookings: !!grant.bookings,
      notify_teammates: !!grant.notify_teammates,
    },
  });
  assert.equal(allowed.statusCode, 200, allowed.body);
  const code = new URL(allowed.json().redirect_to).searchParams.get("code")!;
  const exchanged = await inject("/oauth/token", {
    form: {
      grant_type: "authorization_code",
      code,
      redirect_uri: callback,
      client_id: client,
      code_verifier: verifier,
      resource: env.MCP_PUBLIC_URL,
    },
  });
  assert.equal(exchanged.statusCode, 200, exchanged.body);
  const token = exchanged.json().access_token as string;
  assert.match(token, /^oat_/);
  const grantId = (
    await pool.query<{ grant_id: string }>(
      "SELECT grant_id FROM agent_tokens WHERE token_hash = $1",
      [createHash("sha256").update(token).digest("hex")],
    )
  ).rows[0].grant_id;
  return new AgentClient(app, token, grantId, { forms, name });
}

/** The people and helpers every scenario starts from. */
export function scenario(app: FastifyInstance) {
  const h = helpers(app);
  return { h, connect: (who: Person, body = {}) => connect(app, who, body) };
}
