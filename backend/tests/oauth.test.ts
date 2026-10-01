import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  createHash,
  createHmac,
  generateKeyPairSync,
  randomBytes,
  type KeyObject,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { z } from "zod";
import { SignJWT } from "jose";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";
import { helpers, type Person } from "./mcp-helpers.js";

/**
 * Signing in with Orbyn (phase A2): the authorization server (metadata,
 * CIMD through netguard, DCR, PKCE codes, rotating refresh tokens, RFC 7009
 * revocation), the consent API and re-authentication, the MCP side (PRM,
 * the 401 challenge, step-up, securitySchemes), team caps and first use,
 * and every revocation trigger. No real network: netguard's outbound calls
 * are stood in for.
 */

const { buildApp } = await import("../src/app.js");
const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { invalidateSettings } = await import("../src/lib/settings.js");
const { outbound } = await import("../src/lib/netguard.js");
const { env, oauthIssuer } = await import("../src/config/env.js");
const { registry } = await import("../src/capabilities/index.js");
const { defineCapability } = await import("../src/capabilities/registry.js");
const { issueToken } = await import("../src/modules/auth/tokens.js");
const { addressHash, DCR_LIMITS } =
  await import("../src/modules/oauth/clients.js");
const { onAuthChange } = await import("../src/lib/auth-events.js");
const totp = await import("../src/lib/totp.js");

const app = await buildApp();
const h = helpers(app);
const PASSWORD = "a-long-test-password";

// ---- the network, stood in for ----

/** Public addresses for the made-up hosts; anything else doesn't resolve. */
const HOSTS: Record<string, string> = {
  "agent.example.com": "93.184.215.14",
  "chatgpt.com": "93.184.215.15",
  "slow.example.com": "93.184.215.16",
  "rebind.example.com": "127.0.0.1",
  "hop.example.com": "93.184.215.17",
  "keys.example.com": "93.184.215.18",
};
type Doc = { status: number; body?: string; headers?: Record<string, string> };
const docs = new Map<string, Doc>();
const fetched: { url: string; headers: Record<string, string> }[] = [];
const realLookup = outbound.lookup;
const realRequest = outbound.request;

const CLIENT = "https://agent.example.com/oauth/client.json";
const CALLBACK = "https://agent.example.com/callback";
const GPT = "https://chatgpt.com/oauth/orbyn-client.json";
const GPT_CALLBACK = "https://chatgpt.com/connector_platform_oauth_redirect";

const cimd = (id: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    client_id: id,
    client_name: "Claude",
    redirect_uris: [CALLBACK, "http://localhost/callback"],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    ...extra,
  });

// ---- helpers ----

let n = 0;
/** A fresh address for each call, so per-address limits never decide a test. */
const address = () => `10.91.${Math.floor(n / 250) % 250}.${n++ % 250}`;

const inject = (
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  opts: {
    token?: string | null;
    json?: unknown;
    form?: Record<string, string>;
    headers?: Record<string, string>;
    from?: string;
  } = {},
) =>
  app.inject({
    method,
    url,
    remoteAddress: opts.from ?? address(),
    headers: {
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.form
        ? { "content-type": "application/x-www-form-urlencoded" }
        : {}),
      ...opts.headers,
    },
    ...(opts.form
      ? { payload: new URLSearchParams(opts.form).toString() }
      : opts.json !== undefined
        ? { payload: opts.json as object }
        : {}),
  });

const pkce = () => {
  const verifier = randomBytes(40).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
};

type Req = Record<string, string>;
const request = (over: Partial<Req> = {}) => {
  const p = pkce();
  const req: Req = {
    response_type: "code",
    client_id: CLIENT,
    redirect_uri: CALLBACK,
    code_challenge: p.challenge,
    code_challenge_method: "S256",
    state: `st-${randomBytes(6).toString("hex")}`,
    scope: "orbyn:read offline_access",
    resource: env.MCP_PUBLIC_URL,
    ...over,
  };
  return { req, verifier: p.verifier };
};

const check = (req: Req, token?: string | null) =>
  inject("GET", `/oauth/authorize/check?${new URLSearchParams(req)}`, {
    token,
  });

const consent = (token: string | null, req: Req, choices = {}) =>
  inject("POST", "/oauth/authorize", {
    token,
    json: { request: req, access: "read", ...choices },
  });

/** Signs in fresh (a password sign-in counts as re-authenticated). */
const login = async (who: Person) =>
  (
    await inject("POST", "/auth/login", {
      json: { email: who.email, password: PASSWORD },
    })
  ).json().token as string;

const codeOf = (redirect: string) =>
  new URL(redirect).searchParams.get("code")!;

const exchange = (code: string, verifier: string, over: Req = {}) =>
  inject("POST", "/oauth/token", {
    form: {
      grant_type: "authorization_code",
      code,
      redirect_uri: CALLBACK,
      client_id: CLIENT,
      code_verifier: verifier,
      resource: env.MCP_PUBLIC_URL,
      ...over,
    },
  });

const refresh = (token: string, client = CLIENT, over: Req = {}) =>
  inject("POST", "/oauth/token", {
    form: {
      grant_type: "refresh_token",
      refresh_token: token,
      client_id: client,
      ...over,
    },
  });

/** The whole sign-in for `who`, returning the tokens and the grant. */
async function connect(
  who: Person,
  choices: Record<string, unknown> = {},
  over: Partial<Req> = {},
) {
  const { req, verifier } = request(over);
  const session = await login(who);
  const allowed = await consent(session, req, choices);
  assert.equal(allowed.statusCode, 200, allowed.body);
  const back = new URL(allowed.json().redirect_to);
  const exchanged = await exchange(codeOf(back.toString()), verifier, {
    redirect_uri: req.redirect_uri,
    client_id: req.client_id,
  });
  assert.equal(exchanged.statusCode, 200, exchanged.body);
  const tokens = exchanged.json() as {
    access_token: string;
    refresh_token: string;
    scope: string;
    expires_in: number;
  };
  const grant = (
    await pool.query<{ grant_id: string }>(
      "SELECT grant_id FROM agent_tokens WHERE token_hash = $1",
      [createHash("sha256").update(tokens.access_token).digest("hex")],
    )
  ).rows[0].grant_id;
  return { ...tokens, grant, session };
}

const setting = async (key: string, value: unknown) => {
  await pool.query(
    `INSERT INTO system_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
  invalidateSettings();
};
const clear = async (...keys: string[]) => {
  await pool.query("DELETE FROM system_settings WHERE key = ANY ($1)", [keys]);
  invalidateSettings();
};

/** Listens on orbyn_auth like every copy of the mcp service does. */
const heard: { reason: string; grants?: string[]; users?: string[] }[] = [];
let listener: pg.Client;
const settle = () => new Promise((r) => setTimeout(r, 150));

let me: Person;
let teammate: Person;
let admin: Person;
let teamId = "";
let offTeam = "";

before(async () => {
  await migrate();
  outbound.lookup = async (host: string) => {
    const ip = HOSTS[host];
    if (!ip) throw new Error("ENOTFOUND");
    return [{ address: ip, family: 4 }];
  };
  outbound.request = (async (
    checked: { url: URL },
    init: { headers?: Record<string, string> } = {},
  ) => {
    const url = String(checked.url);
    fetched.push({ url, headers: init.headers ?? {} });
    const d = docs.get(url);
    if (!d) return new Response("missing", { status: 404 });
    return new Response(d.body ?? null, {
      status: d.status,
      headers: d.headers,
    });
  }) as typeof outbound.request;
  docs.set(CLIENT, {
    status: 200,
    body: cimd(CLIENT),
    headers: {
      "content-type": "application/json",
      etag: '"v1"',
      "cache-control": "max-age=600",
    },
  });
  docs.set(GPT, {
    status: 200,
    body: cimd(GPT, { client_name: "ChatGPT", redirect_uris: [GPT_CALLBACK] }),
    headers: { "content-type": "application/json" },
  });
  me = await h.register("oauth-me", "Kim");
  teammate = await h.register("oauth-mate", "Ari");
  admin = await h.register("oauth-admin", "Root");
  await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [admin.id]);
  // On an empty database the first account becomes an admin: not these.
  await pool.query(
    "UPDATE users SET role = 'member' WHERE id = ANY ($1::uuid[])",
    [[me.id, teammate.id]],
  );
  teamId = await h.team(teammate, "Design team", [[me, "member"]]);
  offTeam = await h.team(teammate, "Quiet team", [[me, "member"]]);
  await pool.query("UPDATE teams SET agent_access = 'off' WHERE id = $1", [
    offTeam,
  ]);
  listener = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await listener.connect();
  listener.on("notification", (m) => {
    if (m.channel === "orbyn_auth" && m.payload)
      heard.push(JSON.parse(m.payload));
  });
  await listener.query("LISTEN orbyn_auth");
});
after(async () => {
  outbound.lookup = realLookup;
  outbound.request = realRequest;
  await listener.end();
  await app.close();
  await pool.end();
});

// ---- metadata and the resource server ----

test("metadata: RFC 8414 at the issuer, PKCE for all, none or private_key_jwt, CIMD and iss advertised, open CORS", async () => {
  const r = await inject("GET", "/.well-known/oauth-authorization-server", {
    headers: { origin: "https://claude.ai" },
  });
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers["access-control-allow-origin"], "*");
  const m = r.json();
  const issuer = oauthIssuer();
  assert.equal(m.issuer, issuer);
  assert.equal(m.authorization_endpoint, `${issuer}/oauth/authorize`);
  assert.equal(m.token_endpoint, `${issuer}/api/oauth/token`);
  assert.equal(m.revocation_endpoint, `${issuer}/api/oauth/revoke`);
  assert.equal(m.registration_endpoint, `${issuer}/api/oauth/register`);
  assert.deepEqual(m.code_challenge_methods_supported, ["S256"]);
  assert.deepEqual(m.token_endpoint_auth_methods_supported, [
    "none",
    "private_key_jwt",
  ]);
  assert.deepEqual(m.token_endpoint_auth_signing_alg_values_supported, [
    "RS256",
    "PS256",
    "ES256",
  ]);
  assert.equal(m.client_id_metadata_document_supported, true);
  assert.equal(m.authorization_response_iss_parameter_supported, true);
  assert.ok(m.scopes_supported.includes("offline_access"));
  assert.ok(m.scopes_supported.includes("orbyn:write"));

  // DCR switched off: no registration endpoint is advertised.
  await setting("dcr_enabled", false);
  try {
    const off = await inject("GET", "/.well-known/oauth-authorization-server");
    assert.equal(off.json().registration_endpoint, undefined);
  } finally {
    await clear("dcr_enabled");
  }

  // The token endpoint answers any page's preflight too.
  const pre = await app.inject({
    method: "OPTIONS",
    url: "/oauth/token",
    headers: {
      origin: "https://inspector.example",
      "access-control-request-method": "POST",
    },
  });
  assert.equal(pre.headers["access-control-allow-origin"], "*");
});

test("the MCP resource: PRM names MCP_PUBLIC_URL exactly, 401 challenge before any JSON-RPC", async () => {
  const prm = await inject("GET", "/.well-known/oauth-protected-resource/mcp");
  assert.equal(prm.statusCode, 200);
  assert.equal(prm.json().resource, env.MCP_PUBLIC_URL);
  assert.equal(prm.json().authorization_servers[0], oauthIssuer());
  assert.ok(!prm.json().scopes_supported.includes("offline_access"));

  const r = await h.post({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.equal(r.status, 401);
  const challenge = String(r.headers["www-authenticate"]);
  assert.match(
    challenge,
    /^Bearer resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource\/mcp", scope="orbyn:read"$/,
  );
});

// ---- the whole sign-in ----

test("full sign-in with PKCE: check, consent, code with state and iss, tokens, MCP", async () => {
  const { req, verifier } = request();
  // Signed out, the page can still say who's asking.
  const out = await check(req);
  assert.equal(out.statusCode, 200, out.body);
  assert.equal(out.json().client.name, "Claude");
  assert.equal(out.json().client.host, "agent.example.com");
  assert.equal(out.json().client.verified, true);
  assert.equal(out.json().client.redirect_host, "agent.example.com");
  assert.equal(out.json().account, null);

  const session = await login(me);
  const signedIn = await check(req, session);
  const account = signedIn.json().account;
  assert.equal(account.email, me.email);
  assert.ok(account.reauth_until, "a fresh sign-in counts as re-authenticated");
  const teams = account.teams as {
    id: string;
    agent_access: string;
    role: string;
  }[];
  assert.equal(teams.find((t) => t.id === offTeam)?.agent_access, "off");
  assert.equal(teams.find((t) => t.id === teamId)?.role, "member");

  const allowed = await consent(session, req, {
    access: "write",
    team_ids: [teamId],
    toolsets: ["planner"],
    notify_teammates: true,
    expires_in_days: 30,
  });
  assert.equal(allowed.statusCode, 200, allowed.body);
  assert.equal(allowed.headers["cache-control"], "no-store");
  const back = new URL(allowed.json().redirect_to);
  assert.equal(`${back.origin}${back.pathname}`, CALLBACK);
  assert.equal(back.searchParams.get("state"), req.state);
  assert.equal(back.searchParams.get("iss"), oauthIssuer());
  const code = back.searchParams.get("code")!;
  assert.match(code, /^oac_/);

  // Not listed until the app finishes signing in.
  const before = await inject("GET", "/me/agents", { token: session });
  assert.ok(
    !before.json().grants.some((g: { kind: string }) => g.kind === "oauth"),
  );

  const tokens = await exchange(code, verifier);
  assert.equal(tokens.statusCode, 200, tokens.body);
  assert.equal(tokens.headers["cache-control"], "no-store");
  const t = tokens.json();
  assert.match(t.access_token, /^oat_/);
  assert.match(t.refresh_token, /^ort_/);
  assert.equal(t.token_type, "Bearer");
  assert.ok(t.expires_in > 0 && t.expires_in <= env.OAUTH_ACCESS_TTL);
  assert.equal(t.scope, "orbyn:read orbyn:propose orbyn:write offline_access");

  // Stored only as hashes, bound to the MCP address.
  const stored = await pool.query(
    "SELECT kind, resource FROM agent_tokens WHERE token_hash = ANY ($1)",
    [
      [t.access_token, t.refresh_token].map((x: string) =>
        createHash("sha256").update(x).digest("hex"),
      ),
    ],
  );
  assert.equal(stored.rowCount, 2);
  assert.ok(stored.rows.every((x) => x.resource === env.MCP_PUBLIC_URL));

  // The code is spent.
  const again = await exchange(code, verifier);
  assert.equal(again.statusCode, 400);
  assert.equal(again.json().error, "invalid_grant");

  // The access token works on MCP, as the connection chose.
  const listed = await h.legacy(t.access_token, "tools/call", {
    name: "get_context",
    arguments: {},
  });
  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  const ctx = listed.body.result.structuredContent;
  assert.equal(ctx.connection?.access ?? "write", "write");

  // Listed now, with the app's host, and audited with a notice to the person.
  const list = await inject("GET", "/me/agents", { token: session });
  const g = list
    .json()
    .grants.find((x: { kind: string }) => x.kind === "oauth");
  assert.equal(g.client_name, "Claude");
  assert.equal(g.client_host, "agent.example.com");
  assert.deepEqual(g.team_ids, [teamId]);
  assert.ok(g.toolsets.includes("planner"));
  const audits = await pool.query(
    "SELECT action FROM audit_log WHERE target_type = 'agent_grant' AND target_id = $1",
    [g.id],
  );
  assert.ok(audits.rows.some((a) => a.action === "agent_grant.authorized"));
  const notices = await pool.query(
    "SELECT title FROM notifications WHERE user_id = $1 AND kind = 'agent' AND ref = $2",
    [me.id, `grant:${g.id}`],
  );
  assert.match(notices.rows[0].title, /Claude was connected/);

  // Signing in again from the same app updates that connection.
  const second = await connect(me, { access: "read" });
  assert.equal(second.grant, g.id);
  assert.equal(second.scope, "orbyn:read offline_access");
});

test("token endpoint: RFC 6749 errors for every broken exchange, and the code burns on failure", async () => {
  const session = await login(me);
  const mk = async () => {
    const { req, verifier } = request();
    const r = await consent(session, req);
    return { code: codeOf(r.json().redirect_to), verifier };
  };
  const a = await mk();
  const wrong = await exchange(a.code, pkce().verifier);
  assert.equal(wrong.json().error, "invalid_grant");
  // A failed exchange spends the code: the right verifier is too late.
  assert.equal(
    (await exchange(a.code, a.verifier)).json().error,
    "invalid_grant",
  );

  const b = await mk();
  const elsewhere = await exchange(b.code, b.verifier, {
    redirect_uri: "https://agent.example.com/other",
  });
  assert.equal(elsewhere.json().error, "invalid_grant");

  const c = await mk();
  const target = await exchange(c.code, c.verifier, {
    resource: "https://api.example.com/mcp",
  });
  assert.equal(target.statusCode, 400);
  assert.equal(target.json().error, "invalid_target");

  const d = await mk();
  const other = await exchange(d.code, d.verifier, {
    client_id: "https://someone.example.com/client.json",
  });
  assert.equal(other.json().error, "invalid_grant");

  const bad = await inject("POST", "/oauth/token", {
    form: { grant_type: "password", username: "x", password: "y" },
  });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().error, "unsupported_grant_type");
  assert.equal(
    (await inject("POST", "/oauth/token", { form: {} })).json().error,
    "invalid_request",
  );
  const shortVerifier = await exchange("oac_x", "short");
  assert.equal(shortVerifier.json().error, "invalid_grant");
});

test("refresh tokens rotate; reusing a spent one revokes the family and pauses the connection", async () => {
  const first = await connect(me, { access: "read" });
  const r1 = await refresh(first.refresh_token);
  assert.equal(r1.statusCode, 200, r1.body);
  const second = r1.json();
  assert.notEqual(second.refresh_token, first.refresh_token);
  assert.equal(second.scope, "orbyn:read offline_access");
  // Asking to widen on refresh is refused.
  const wider = await refresh(second.refresh_token, CLIENT, {
    scope: "orbyn:write",
  });
  assert.equal(wider.json().error, "invalid_scope");
  // Another app can't use it.
  assert.equal(
    (await refresh(second.refresh_token, GPT)).json().error,
    "invalid_grant",
  );
  assert.equal((await h.legacy(second.access_token, "ping")).status, 200);

  heard.length = 0;
  // The first refresh token again, well after it rotated: someone copied it.
  await pool.query(
    "UPDATE agent_tokens SET used_at = now() - interval '2 minutes' WHERE token_hash = $1",
    [createHash("sha256").update(first.refresh_token).digest("hex")],
  );
  const reused = await refresh(first.refresh_token);
  assert.equal(reused.statusCode, 400);
  assert.equal(reused.json().error, "invalid_grant");
  // The whole family is gone: the newest tokens too.
  assert.equal((await h.legacy(second.access_token, "ping")).status, 401);
  assert.equal(
    (await refresh(second.refresh_token)).json().error,
    "invalid_grant",
  );
  const g = (
    await pool.query("SELECT suspended_at FROM agent_grants WHERE id = $1", [
      first.grant,
    ])
  ).rows[0];
  assert.ok(g.suspended_at, "the connection is paused");
  const audits = await pool.query(
    "SELECT 1 FROM audit_log WHERE action = 'agent_grant.refresh_reused' AND target_id = $1",
    [first.grant],
  );
  assert.equal(audits.rowCount, 1);
  const notice = await pool.query(
    "SELECT title FROM notifications WHERE user_id = $1 AND kind = 'agent' AND ref = $2 AND channel = 'inapp'",
    [me.id, `grant:${first.grant}`],
  );
  assert.ok(notice.rows.some((x) => /paused for your safety/.test(x.title)));
  await settle();
  assert.ok(heard.some((e) => e.reason === "refresh_reused"));

  // Signing in again un-pauses it.
  const back = await connect(me, { access: "read" });
  assert.equal(back.grant, first.grant);
  assert.equal((await h.legacy(back.access_token, "ping")).status, 200);
});

test("a refresh retried just after it rotated gets another pair instead of pausing the connection", async () => {
  const who = await h.register("oauth-retry", "Rey");
  const first = await connect(who, { access: "read" });
  const a = await refresh(first.refresh_token);
  assert.equal(a.statusCode, 200, a.body);
  // The answer was lost (or two tabs refreshed at once): the same token again.
  const b = await refresh(first.refresh_token);
  assert.equal(b.statusCode, 200, b.body);
  assert.notEqual(b.json().refresh_token, a.json().refresh_token);
  const paused = async () =>
    (
      await pool.query("SELECT suspended_at FROM agent_grants WHERE id = $1", [
        first.grant,
      ])
    ).rows[0].suspended_at;
  assert.equal(await paused(), null, "a retry isn't theft");
  // Both answers work.
  assert.equal((await h.legacy(a.json().access_token, "ping")).status, 200);
  assert.equal((await h.legacy(b.json().access_token, "ping")).status, 200);
  // A couple of retries at most: after that it counts as copied.
  assert.equal((await refresh(first.refresh_token)).statusCode, 200);
  const again = await refresh(first.refresh_token);
  assert.equal(again.json().error, "invalid_grant");
  assert.ok(await paused(), "too many uses of one token pause it");
});

test("RFC 7009 revocation: a refresh token takes its family; an app with nothing left is disconnected", async () => {
  const c = await connect(teammate, { access: "read" });
  const unknown = await inject("POST", "/oauth/revoke", {
    form: { token: "ort_nothing", client_id: CLIENT },
  });
  assert.equal(unknown.statusCode, 200);
  assert.equal(
    (await inject("POST", "/oauth/revoke", { form: {} })).json().error,
    "invalid_request",
  );
  const r = await inject("POST", "/oauth/revoke", {
    form: {
      token: c.refresh_token,
      token_type_hint: "refresh_token",
      client_id: CLIENT,
    },
  });
  assert.equal(r.statusCode, 200);
  assert.equal((await h.legacy(c.access_token, "ping")).status, 401);
  const g = (
    await pool.query("SELECT revoked_at FROM agent_grants WHERE id = $1", [
      c.grant,
    ])
  ).rows[0];
  assert.ok(g.revoked_at, "the app disconnected itself");
});

test("audience isolation: agent tokens only on MCP, app sessions never on MCP", async () => {
  const c = await connect(me, { access: "read" });
  // An access or refresh token is refused by the REST API.
  for (const t of [c.access_token, c.refresh_token]) {
    const r = await inject("GET", "/me", { token: t });
    assert.equal(r.statusCode, 401);
  }
  // A refresh token isn't an access token.
  const ort = await h.legacy(c.refresh_token, "ping");
  assert.equal(ort.status, 401);
  assert.match(String(ort.headers["www-authenticate"]), /invalid_token/);
  // The app's own session isn't an agent credential.
  const sess = await h.legacy(c.session, "ping");
  assert.equal(sess.status, 401);
  // A token bound to another resource is refused.
  await pool.query(
    "UPDATE agent_tokens SET resource = 'https://elsewhere.example.com/mcp' WHERE token_hash = $1",
    [createHash("sha256").update(c.access_token).digest("hex")],
  );
  assert.equal((await h.legacy(c.access_token, "ping")).status, 401);
});

// ---- consent API ----

test("consent API: 401 signed out, 403 with an API key, 400 for broken requests", async () => {
  const { req } = request();
  assert.equal((await consent(null, req)).statusCode, 401);
  const session = await login(me);
  const key = (
    await inject("POST", "/me/api-keys", {
      token: session,
      json: { name: "k" },
    })
  ).json().key as string;
  assert.equal((await consent(key, req)).statusCode, 403);
  assert.equal((await check(req, key)).statusCode, 403);

  const cases: [Partial<Req>, RegExp][] = [
    [{ client_id: "https://unknown.example.org/c.json" }, /description|know/],
    [{ client_id: "not-an-app" }, /doesn't know this app/],
    [{ client_id: "http://agent.example.com/oauth/client.json" }, /know/],
    [{ redirect_uri: "https://evil.example.com/cb" }, /didn't declare/],
    [{ response_type: "token" }, /doesn't do/],
    [{ code_challenge_method: "plain" }, /PKCE/],
    [{ code_challenge: "" }, /PKCE/],
    [
      { resource: "https://api.example.com/mcp" },
      /recipient that is not enabled/,
    ],
    [
      {
        resource:
          "https://private-user:private-secret@api.example.com/mcp?private-query=1#private-fragment",
      },
      /recipient that is not enabled/,
    ],
  ];
  for (const [over, why] of cases) {
    const bad = request(over).req;
    const a = await consent(session, bad);
    assert.equal(a.statusCode, 400, `${JSON.stringify(over)}: ${a.body}`);
    assert.match(a.json().message, why);
    if (over.resource)
      assert.doesNotMatch(a.body, /private-|api\.example\.com/);
    const c = await check(bad, session);
    assert.equal(c.statusCode, 400);
    if (over.resource)
      assert.doesNotMatch(c.body, /private-|api\.example\.com/);
  }
  // A missing request altogether.
  const none = await inject("POST", "/oauth/authorize", {
    token: session,
    json: { access: "read" },
  });
  assert.ok([400, 422].includes(none.statusCode), none.body);
  // No spaces at all.
  const nowhere = await consent(session, req, {
    personal: false,
    team_ids: [],
  });
  assert.equal(nowhere.statusCode, 422);
  // A team you're not in, and a team that turned agents off.
  const stranger = await consent(session, req, {
    team_ids: ["00000000-0000-4000-8000-000000000000"],
  });
  assert.equal(stranger.statusCode, 404);
  const quiet = await consent(session, req, { team_ids: [offTeam] });
  assert.equal(quiet.statusCode, 403);
  assert.match(quiet.json().message, /turned outside agents off/);

  // Declining sends the app back with access_denied (and state, iss).
  const denied = await inject("POST", "/oauth/authorize/deny", {
    json: { request: req },
  });
  const back = new URL(denied.json().redirect_to);
  assert.equal(back.searchParams.get("error"), "access_denied");
  assert.equal(back.searchParams.get("state"), req.state);
  assert.equal(back.searchParams.get("iss"), oauthIssuer());
  const deniedBad = await inject("POST", "/oauth/authorize/deny", {
    json: { request: { ...req, redirect_uri: "https://evil.example.com/" } },
  });
  assert.equal(
    deniedBad.statusCode,
    400,
    "never sends anyone to an undeclared address",
  );
});

test("step-up auth: write access needs a password (and two-step) or passkey within 10 minutes", async () => {
  const who = await h.register("oauth-reauth", "Sam");
  const { req } = request();
  // A session from signing up hasn't confirmed anything since.
  const write = await consent(who.token, req, { access: "write" });
  assert.equal(write.statusCode, 403);
  assert.equal(write.json().message, "reauth_required");
  const bookings = await consent(who.token, req, {
    access: "read",
    bookings: true,
  });
  assert.equal(bookings.statusCode, 403);
  // Read access needs nothing more.
  assert.equal(
    (await consent(who.token, req, { access: "read" })).statusCode,
    200,
  );

  const wrong = await inject("POST", "/me/reauth", {
    token: who.token,
    json: { password: "not the password" },
  });
  assert.equal(
    wrong.statusCode,
    403,
    "a wrong password never signs the app out (not 401)",
  );
  assert.equal(
    (await inject("POST", "/me/reauth", { json: { password: PASSWORD } }))
      .statusCode,
    401,
  );
  const ok = await inject("POST", "/me/reauth", {
    token: who.token,
    json: { password: PASSWORD },
  });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.ok(Date.parse(ok.json().reauth_until) > Date.now() + 9 * 60_000);
  assert.equal(
    (await consent(who.token, request().req, { access: "write" })).statusCode,
    200,
  );
  const audited = await pool.query(
    "SELECT details FROM audit_log WHERE action = 'user.reauthenticated' AND target_id = $1",
    [who.id],
  );
  assert.equal(audited.rows[0].details.how, "password");

  // Older than 10 minutes no longer counts.
  await pool.query(
    "UPDATE sessions SET reauthenticated_at = now() - interval '11 minutes' WHERE user_id = $1",
    [who.id],
  );
  assert.equal(
    (await consent(who.token, request().req, { access: "write" })).statusCode,
    403,
  );

  // With two-step on, the password alone isn't enough.
  const setup = await inject("POST", "/me/2fa/setup", { token: who.token });
  const secret = setup.json().secret as string;
  const on = await inject("POST", "/me/2fa/enable", {
    token: who.token,
    json: { code: liveCode(secret) },
  });
  assert.equal(on.statusCode, 200, on.body);
  const noCode = await inject("POST", "/me/reauth", {
    token: who.token,
    json: { password: PASSWORD },
  });
  assert.equal(noCode.statusCode, 403);
  assert.equal(noCode.json().message, "totp_required");
  const badCode = await inject("POST", "/me/reauth", {
    token: who.token,
    json: { password: PASSWORD, code: "000000" },
  });
  assert.equal(badCode.statusCode, 403);
  const withCode = await inject("POST", "/me/reauth", {
    token: who.token,
    json: { password: PASSWORD, code: liveCode(secret) },
  });
  assert.equal(withCode.statusCode, 200, withCode.body);
  // A passkey assertion that doesn't verify is refused the same way.
  const pk = await inject("POST", "/me/reauth", {
    token: who.token,
    json: { handle: "nope", response: { id: "x" } },
  });
  assert.equal(pk.statusCode, 403);
  assert.equal(
    (await inject("POST", "/me/reauth/options", { token: who.token }))
      .statusCode,
    200,
  );
});

// ---- registration and client documents ----

test("DCR: public clients only, application type checked, limited per address, switchable", async () => {
  // The limits count registrations over the last hour and day, and the test
  // database outlives a run: earlier runs' apps count as older, so this run
  // starts under the limits whenever it runs.
  await pool.query(
    "UPDATE oauth_clients SET created_at = created_at - interval '2 days' WHERE kind = 'dcr'",
  );
  const from = "10.92.0.1";
  const reg = (body: unknown, at = from) =>
    inject("POST", "/oauth/register", { json: body, from: at });
  const made = await reg({
    client_name: "Cli‮Tool",
    redirect_uris: ["http://127.0.0.1:33418/callback"],
    token_endpoint_auth_method: "client_secret_post",
    grant_types: ["authorization_code", "refresh_token"],
  });
  assert.equal(made.statusCode, 201, made.body);
  const c = made.json();
  assert.match(c.client_id, /^dcr_/);
  assert.equal(
    c.token_endpoint_auth_method,
    "none",
    "secret methods become none",
  );
  assert.equal(c.client_secret, undefined);
  assert.equal(c.application_type, "native");
  assert.equal(c.client_name, "CliTool", "direction tricks are removed");

  const bad: [unknown, string | null][] = [
    [{ redirect_uris: ["http://evil.example.com/cb"] }, "invalid_redirect_uri"],
    [{ redirect_uris: ["javascript:alert(1)"] }, "invalid_redirect_uri"],
    [{ redirect_uris: ["https://a.example.com/cb#x"] }, "invalid_redirect_uri"],
    [{ redirect_uris: [] }, "invalid_redirect_uri"],
    [
      { redirect_uris: ["https://a.example.com/cb", "http://localhost/cb"] },
      "invalid_client_metadata",
    ],
    [
      { redirect_uris: ["http://localhost/cb"], application_type: "web" },
      "invalid_client_metadata",
    ],
    // One website per app: a second site beside the first could be sent
    // the code, and so could a second app scheme.
    [
      {
        redirect_uris: [
          "https://claude.ai/api/mcp/auth_callback",
          "https://evil.example.com/cb",
        ],
      },
      "invalid_redirect_uri",
    ],
    [
      {
        redirect_uris: ["https://a.example.com/cb", "https://A.example.com/x"],
      },
      null,
    ],
    [
      { redirect_uris: ["com.one.app:/cb", "com.other.app:/cb"] },
      "invalid_redirect_uri",
    ],
    [
      { redirect_uris: ["http://127.0.0.1:3000/cb", "com.one.app:/cb"] },
      "invalid_redirect_uri",
    ],
    [
      { redirect_uris: ["http://127.0.0.1:3000/cb", "http://localhost/cb"] },
      null,
    ],
    [
      {
        redirect_uris: ["https://a.example.com/cb"],
        grant_types: ["client_credentials"],
      },
      "invalid_client_metadata",
    ],
    [
      {
        redirect_uris: ["https://a.example.com/cb"],
        jwks_uri: "https://a.example.com/j",
      },
      "invalid_client_metadata",
    ],
  ];
  for (const [body, error] of bad) {
    const r = await reg(body, address());
    if (error === null) {
      assert.equal(r.statusCode, 201, `${JSON.stringify(body)}: ${r.body}`);
      continue;
    }
    assert.equal(r.statusCode, 400, JSON.stringify(body));
    assert.equal(r.json().error, error);
  }

  // A registered loopback app signs in on any port (RFC 8252).
  const p = pkce();
  const session = await login(me);
  const allowed = await consent(session, {
    response_type: "code",
    client_id: c.client_id,
    redirect_uri: "http://127.0.0.1:51000/callback",
    code_challenge: p.challenge,
    code_challenge_method: "S256",
    state: "s",
  });
  assert.equal(allowed.statusCode, 200, allowed.body);
  const redirect = new URL(allowed.json().redirect_to);
  assert.equal(redirect.port, "51000");
  const info = await check(
    {
      response_type: "code",
      client_id: c.client_id,
      redirect_uri: "http://127.0.0.1:51000/callback",
      code_challenge: p.challenge,
      code_challenge_method: "S256",
    },
    session,
  );
  assert.equal(info.json().client.verified, false);
  assert.equal(info.json().client.redirect_local, true);
  const t = await inject("POST", "/oauth/token", {
    form: {
      grant_type: "authorization_code",
      code: redirect.searchParams.get("code")!,
      redirect_uri: "http://127.0.0.1:51000/callback",
      client_id: c.client_id,
      code_verifier: p.verifier,
    },
  });
  assert.equal(t.statusCode, 200, t.body);

  // Per address: the route's own limit (10 an hour)…
  const burst = "10.92.0.2";
  let limited = 0;
  for (let i = 0; i < 11; i++) {
    const r = await reg({ redirect_uris: ["http://localhost/cb"] }, burst);
    if (r.statusCode === 429) limited++;
  }
  assert.ok(
    limited >= 1,
    "the 11th registration from one address in an hour is refused",
  );
  // …and the daily cap that holds across every copy.
  const daily = "10.92.0.3";
  await pool.query(
    `INSERT INTO oauth_clients (id, kind, name, host, redirect_uris, registered_from)
     SELECT 'dcr_seed' || g || '${randomBytes(4).toString("hex")}xxxxxxxxxxxx', 'dcr', 'Seed', 'localhost',
            '{http://localhost/cb}', $1
       FROM generate_series(1, $2::int) g`,
    [addressHash(daily), DCR_LIMITS.per_address_per_day],
  );
  const capped = await reg({ redirect_uris: ["http://localhost/cb"] }, daily);
  assert.equal(capped.statusCode, 429);
  assert.equal(capped.json().error, "temporarily_unavailable");

  // Admins can switch registration off.
  await setting("dcr_enabled", false);
  try {
    const off = await reg(
      { redirect_uris: ["http://localhost/cb"] },
      address(),
    );
    assert.equal(off.statusCode, 403);
    assert.equal(off.json().error, "access_denied");
  } finally {
    await clear("dcr_enabled");
  }
});

test("CIMD through netguard: https only, public addresses, 64 KB, redirects re-checked, ETag cache", async () => {
  const session = await login(me);
  const attempt = async (
    clientId: string,
    redirect = "https://x.example.com/cb",
  ) =>
    check(
      request({ client_id: clientId, redirect_uri: redirect }).req,
      session,
    );

  // A name that resolves to a private address is never fetched.
  const rebind = "https://rebind.example.com/client.json";
  docs.set(rebind, { status: 200, body: cimd(rebind) });
  fetched.length = 0;
  const priv = await attempt(rebind);
  assert.equal(priv.statusCode, 400);
  assert.ok(!fetched.some((f) => f.url === rebind), "never called");

  // Too large.
  const big = "https://slow.example.com/big.json";
  docs.set(big, {
    status: 200,
    body: `{"client_id":"${big}","x":"${"a".repeat(70_000)}"}`,
  });
  const large = await attempt(big);
  assert.equal(large.statusCode, 400);
  assert.match(large.json().message, /too large/);

  // A document that names another app.
  const liar = "https://slow.example.com/liar.json";
  docs.set(liar, { status: 200, body: cimd(CLIENT) });
  assert.match((await attempt(liar)).json().message, /different app/);

  // One signing in with a key that doesn't say where its keys are.
  const keyless = "https://slow.example.com/secret.json";
  docs.set(keyless, {
    status: 200,
    body: cimd(keyless, { token_endpoint_auth_method: "private_key_jwt" }),
  });
  assert.match(
    (await attempt(keyless)).json().message,
    /Claude signs in with a signed key \(private_key_jwt\), but its description doesn't publish its keys/,
  );

  // A redirect to a private address is checked again, and refused.
  const hop = "https://hop.example.com/client.json";
  docs.set(hop, {
    status: 302,
    headers: { location: "https://rebind.example.com/client.json" },
  });
  assert.equal((await attempt(hop)).statusCode, 400);

  // The good document is cached with its ETag: fetched once while fresh…
  await pool.query("DELETE FROM oauth_clients WHERE id = $1", [CLIENT]);
  fetched.length = 0;
  await check(request().req, session);
  await check(request().req, session);
  assert.equal(fetched.filter((f) => f.url === CLIENT).length, 1);
  // …and revalidated with If-None-Match once stale (a 304 keeps it).
  await pool.query(
    "UPDATE oauth_clients SET fetched_at = now() - interval '1 hour' WHERE id = $1",
    [CLIENT],
  );
  docs.set(CLIENT, { status: 304, headers: { etag: '"v1"' } });
  const revalidated = await check(request().req, session);
  assert.equal(revalidated.statusCode, 200, revalidated.body);
  const last = fetched.filter((f) => f.url === CLIENT).at(-1)!;
  assert.equal(last.headers["if-none-match"], '"v1"');
  docs.set(CLIENT, {
    status: 200,
    body: cimd(CLIENT),
    headers: { etag: '"v1"', "cache-control": "max-age=600" },
  });

  // Admins can limit which hosts connect, and block one app.
  await setting("allowed_client_hosts", ["claude.ai"]);
  try {
    const r = await check(request().req, session);
    assert.equal(r.statusCode, 403);
    assert.match(r.json().message, /can't connect/);
  } finally {
    await clear("allowed_client_hosts");
  }
});

test("allowed websites: a self-registered app must be allowed for every address it sends people back to", async () => {
  const reg = (redirect_uris: string[]) =>
    inject("POST", "/oauth/register", {
      json: { client_name: "Claude", redirect_uris },
    });
  // Registering one now is refused (one website per app)...
  const refused = await reg([
    "https://claude.ai/cb",
    "https://evil.example.com/cb",
  ]);
  assert.equal(refused.statusCode, 400, refused.body);
  assert.equal(refused.json().error, "invalid_redirect_uri");
  // ...but an app registered before that rule keeps its addresses, so the
  // allowed-websites check still covers every one of them.
  const sneakyId = `dcr_${randomBytes(24).toString("base64url")}`;
  await pool.query(
    `INSERT INTO oauth_clients (id, kind, name, host, redirect_uris, metadata)
     VALUES ($1, 'dcr', 'Claude', 'claude.ai', $2, '{"application_type":"web"}')`,
    [sneakyId, ["https://claude.ai/cb", "https://evil.example.com/cb"]],
  );
  const sneaky = { json: () => ({ client_id: sneakyId }) };
  const honest = await reg(["https://claude.ai/cb"]);
  assert.equal(honest.statusCode, 201, honest.body);
  const ask = (clientId: string, redirect: string) => {
    const p = pkce();
    return {
      req: {
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirect,
        code_challenge: p.challenge,
        code_challenge_method: "S256",
        state: "s",
        scope: "orbyn:read offline_access",
      },
      verifier: p.verifier,
    };
  };
  const session = await login(me);
  // Before the list is narrowed, the sneaky app connects (to use later).
  const early = ask(sneaky.json().client_id, "https://claude.ai/cb");
  const allowedEarly = await consent(session, early.req);
  assert.equal(allowedEarly.statusCode, 200, allowedEarly.body);
  const earlyTokens = (
    await exchange(codeOf(allowedEarly.json().redirect_to), early.verifier, {
      redirect_uri: "https://claude.ai/cb",
      client_id: sneaky.json().client_id,
    })
  ).json();
  assert.ok(earlyTokens.refresh_token);

  await setting("allowed_client_hosts", ["claude.ai"]);
  try {
    // Its first address is allowed, but it could send the code elsewhere.
    for (const redirect of [
      "https://claude.ai/cb",
      "https://evil.example.com/cb",
    ]) {
      const { req } = ask(sneaky.json().client_id, redirect);
      const r = await check(req, session);
      assert.equal(r.statusCode, 403, redirect);
      assert.match(r.json().message, /evil\.example\.com can't connect/);
      assert.equal((await consent(session, req)).statusCode, 403);
    }
    // Its tokens stop working too: no refresh, no MCP calls.
    assert.equal(
      (await refresh(earlyTokens.refresh_token, sneaky.json().client_id)).json()
        .error,
      "invalid_grant",
    );
    assert.equal(
      (await h.legacy(earlyTokens.access_token, "ping")).status,
      403,
    );
    // An app that only goes back to claude.ai is fine.
    const ok = await check(
      ask(honest.json().client_id, "https://claude.ai/cb").req,
      session,
    );
    assert.equal(ok.statusCode, 200, ok.body);
  } finally {
    await clear("allowed_client_hosts");
  }
});

test("allowed websites: narrowing the list stops refreshes from apps no longer allowed", async () => {
  const who = await h.register("oauth-narrowed", "Nia");
  const c = await connect(who, { access: "read" });
  await setting("allowed_client_hosts", ["claude.ai"]);
  try {
    const r = await refresh(c.refresh_token);
    assert.equal(r.statusCode, 400);
    assert.equal(r.json().error, "invalid_grant");
    assert.match(r.json().error_description ?? r.json().message, /website/);
  } finally {
    await clear("allowed_client_hosts");
  }
  // Allowed again, the same refresh token still works (it wasn't spent).
  assert.equal((await refresh(c.refresh_token)).statusCode, 200);
});

// ---- the MCP side: step-up and ChatGPT ----

test("step-up: a read connection asking for a write tool gets 403 insufficient_scope; ChatGPT gets it on the result", async () => {
  const write = defineCapability({
    name: "test_make_note",
    title: "Make a note",
    description: "Test only: a change.",
    input: z.object({ text: z.string() }).strict(),
    output: z.object({ ok: z.boolean() }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    access: "write",
    toolset: "core",
    mode: "write",
    tier: "W1",
    async run() {
      return { structured: { ok: true }, markdown: "Done." };
    },
  });
  const undo = registry.extend([write]);
  try {
    const reader = await connect(me, { access: "read" });
    const list = await h.legacy(reader.access_token, "tools/list");
    const tool = list.body.result.tools.find(
      (x: { name: string }) => x.name === "test_make_note",
    );
    assert.ok(tool, "listed, so calling it can ask for more");
    assert.deepEqual(tool.securitySchemes, [
      { type: "oauth2", scopes: ["orbyn:write"] },
    ]);
    assert.deepEqual(tool._meta.securitySchemes, tool.securitySchemes);
    const read = list.body.result.tools.find(
      (x: { name: string }) => x.name === "get_context",
    );
    assert.deepEqual(read.securitySchemes[0].scopes, ["orbyn:read"]);

    const denied = await h.legacy(reader.access_token, "tools/call", {
      name: "test_make_note",
      arguments: { text: "hi" },
    });
    assert.equal(denied.status, 403);
    const challenge = String(denied.headers["www-authenticate"]);
    assert.match(challenge, /^Bearer error="insufficient_scope"/);
    assert.match(challenge, /scope="orbyn:read orbyn:propose orbyn:write"/);
    assert.match(
      challenge,
      /resource_metadata="[^"]+oauth-protected-resource\/mcp"/,
    );

    // Allowed after signing in again with write.
    const writer = await connect(me, { access: "write" });
    const done = await h.tool(writer.access_token, "test_make_note", {
      text: "hi",
    });
    assert.equal(done?.isError, undefined, JSON.stringify(done));

    // ChatGPT: a 200 with the challenge in _meta, as its Apps SDK expects.
    const gpt = await connect(
      teammate,
      { access: "read" },
      { client_id: GPT, redirect_uri: GPT_CALLBACK },
    );
    const onResult = await h.legacy(gpt.access_token, "tools/call", {
      name: "test_make_note",
      arguments: { text: "hi" },
    });
    assert.equal(onResult.status, 200);
    const result = onResult.body.result;
    assert.equal(result.isError, true);
    assert.match(result._meta["mcp/www_authenticate"][0], /insufficient_scope/);

    // An agent key can't be widened: it isn't shown the tool, and a call is refused in the result.
    const key = await h.agentKey(me, { access: "read" });
    const keyList = await h.legacy(key.key, "tools/list");
    assert.ok(
      !keyList.body.result.tools.some(
        (x: { name: string }) => x.name === "test_make_note",
      ),
    );
    const keyCall = await h.tool(key.key, "test_make_note", { text: "hi" });
    assert.equal(keyCall?.isError, true);
  } finally {
    undo();
  }
});

// ---- teams ----

test("teams: a first use tells the owners once; Outside agents shows who; leaving takes the team off", async () => {
  // A team no agent has used yet (on this copy or any other).
  const teamId = await h.team(teammate, "Design studio", [[me, "member"]]);
  const c = await connect(me, { access: "read", team_ids: [teamId] });
  const { noteTeamUse } = await import("../src/modules/mcp-server/routes.js");
  assert.equal((await h.legacy(c.access_token, "ping")).status, 200);
  // The notice is written off the request path.
  await settle();
  const told = await pool.query(
    "SELECT title FROM notifications WHERE user_id = $1 AND kind = 'agent' AND ref = $2 AND channel = 'inapp'",
    [teammate.id, `team:${teamId}`],
  );
  assert.equal(told.rowCount, 1, "the owner is told");
  assert.match(told.rows[0].title, /Design studio for the first time/);
  const self = await pool.query(
    "SELECT 1 FROM notifications WHERE user_id = $1 AND ref = $2",
    [me.id, `team:${teamId}`],
  );
  assert.equal(self.rowCount, 0, "not the person whose agent it is");
  assert.equal(typeof noteTeamUse, "function");

  // Owners see members' connections by name and app; members see only the policy.
  const owner = await inject("GET", `/teams/${teamId}/agents`, {
    token: teammate.token,
  });
  assert.equal(owner.statusCode, 200, owner.body);
  assert.ok(owner.json().first_used_at);
  assert.ok(
    owner
      .json()
      .connections.some(
        (x: { member: string; app: string }) =>
          x.member === "Kim" && x.app === "Claude",
      ),
  );
  const member = await inject("GET", `/teams/${teamId}/agents`, {
    token: me.token,
  });
  assert.equal(member.json().connections, null);
  assert.equal(member.json().agent_access, "role");
  assert.equal(
    (await inject("GET", `/teams/${teamId}/agents`, { token: admin.token }))
      .statusCode,
    404,
  );
  assert.equal(
    (await inject("GET", `/teams/${teamId}/agents`)).statusCode,
    401,
  );

  // A member can't set the team's cap; the owner can; the consent page follows it.
  const tried = await inject("PUT", `/teams/${teamId}/agent-access`, {
    token: me.token,
    json: { agent_access: "off" },
  });
  assert.equal(tried.statusCode, 403);
  heard.length = 0;
  const set = await inject("PUT", `/teams/${teamId}/agent-access`, {
    token: teammate.token,
    json: { agent_access: "read" },
  });
  assert.equal(set.statusCode, 200);
  await settle();
  assert.ok(heard.some((e) => e.reason === "team_policy"));
  const session = await login(me);
  const shown = await check(request().req, session);
  assert.equal(
    shown.json().account.teams.find((t: { id: string }) => t.id === teamId)
      .agent_access,
    "read",
  );
  await pool.query("UPDATE teams SET agent_access = 'role' WHERE id = $1", [
    teamId,
  ]);

  // Leaving the team takes it off every connection; rejoining doesn't bring it back.
  const left = await inject("DELETE", `/teams/${teamId}/members/${me.id}`, {
    token: me.token,
  });
  assert.equal(left.statusCode, 204, left.body);
  const after = (
    await pool.query("SELECT team_ids FROM agent_grants WHERE id = $1", [
      c.grant,
    ])
  ).rows[0].team_ids;
  assert.ok(!after.includes(teamId));
  await inject("POST", `/teams/${teamId}/members`, {
    token: teammate.token,
    json: { email: me.email, role: "member" },
  });
  const rejoined = (
    await pool.query("SELECT team_ids FROM agent_grants WHERE id = $1", [
      c.grant,
    ])
  ).rows[0].team_ids;
  assert.ok(!rejoined.includes(teamId));
});

// ---- revocation triggers ----

test("revocation: password reset, admin sign-out, disable, delete and blocking an app end connections, with NOTIFY", async () => {
  const seen: string[] = [];
  const stop = onAuthChange((e) => seen.push(e.reason));

  // Password reset.
  const a = await h.register("oauth-reset", "Reset");
  const ca = await connect(a, { access: "read" });
  const key = await h.agentKey(a);
  const resetToken = await transaction((db) => issueToken(db, a.id, "reset"));
  heard.length = 0;
  const reset = await inject("POST", "/auth/reset-password", {
    json: { token: resetToken, password: "another-long-password" },
  });
  assert.equal(reset.statusCode, 200, reset.body);
  assert.equal((await h.legacy(ca.access_token, "ping")).status, 401);
  assert.equal((await h.legacy(key.key, "ping")).status, 401);
  await settle();
  assert.ok(
    heard.some((e) => e.reason === "password_reset" && e.users?.includes(a.id)),
  );
  assert.ok(seen.includes("password_reset"), "every copy's listener hears it");

  // Admin: sign out everywhere.
  const b = await h.register("oauth-signout", "Out");
  const cb = await connect(b, { access: "read" });
  const out = await inject("POST", `/admin/users/${b.id}/sign-out`, {
    token: admin.token,
  });
  assert.equal(out.statusCode, 200, out.body);
  assert.equal((await h.legacy(cb.access_token, "ping")).status, 401);

  // Admin: disable.
  const c = await h.register("oauth-disable", "Off");
  const cc = await connect(c, { access: "read" });
  const off = await inject("PUT", `/admin/users/${c.id}`, {
    token: admin.token,
    json: { disabled: true },
  });
  assert.equal(off.statusCode, 200, off.body);
  const revoked = await pool.query(
    "SELECT revoked_at FROM agent_grants WHERE id = $1",
    [cc.grant],
  );
  assert.ok(revoked.rows[0].revoked_at);

  // Admin: delete (the connection goes with the account).
  const d = await h.register("oauth-delete", "Gone");
  const cd = await connect(d, { access: "read", team_ids: [] });
  heard.length = 0;
  const del = await inject("DELETE", `/admin/users/${d.id}`, {
    token: admin.token,
  });
  assert.equal(del.statusCode, 204, del.body);
  assert.equal(
    (await pool.query("SELECT 1 FROM agent_grants WHERE id = $1", [cd.grant]))
      .rowCount,
    0,
  );
  assert.equal((await h.legacy(cd.access_token, "ping")).status, 401);
  await settle();
  assert.ok(heard.some((e) => e.reason === "account_deleted"));

  // Admin: block an app. Its sign-ins end, new ones are refused, keys stay.
  const e = await h.register("oauth-block", "Blocked");
  const ce = await connect(e, { access: "read" });
  const ekey = await h.agentKey(e);
  const block = await inject("PUT", "/admin/agents", {
    token: admin.token,
    json: { blocked_client_ids: [CLIENT] },
  });
  assert.equal(block.statusCode, 200, block.body);
  try {
    assert.equal((await h.legacy(ce.access_token, "ping")).status, 401);
    assert.equal((await h.legacy(ekey.key, "ping")).status, 200);
    const again = await check(request().req, await login(e));
    assert.equal(again.statusCode, 403);
    assert.equal(
      (await refresh(ce.refresh_token)).json().error,
      "invalid_grant",
    );
    const clients = await inject("GET", "/admin/agents/clients", {
      token: admin.token,
    });
    assert.equal(
      clients.json().find((x: { id: string }) => x.id === CLIENT).blocked,
      true,
    );
  } finally {
    await inject("PUT", "/admin/agents", {
      token: admin.token,
      json: { blocked_client_ids: [] },
    });
  }
  stop();
});

// ---- admin ----

test("admin: apps, usage by app without people who opted out, and each user's connections", async () => {
  const u1 = await h.register("oauth-usage1", "Counted");
  const u2 = await h.register("oauth-usage2", "Private");
  const g1 = await connect(u1, { access: "read" });
  const g2 = await connect(u2, { access: "read" });
  await pool.query("UPDATE users SET analytics_opt_out = true WHERE id = $1", [
    u2.id,
  ]);
  await pool.query(
    `INSERT INTO agent_usage_daily (day, grant_id, calls, writes, denied, limited)
     VALUES (current_date, $1, 7, 1, 0, 0), (current_date, $2, 1000, 0, 0, 0)
     ON CONFLICT (day, grant_id) DO UPDATE SET calls = EXCLUDED.calls`,
    [g1.grant, g2.grant],
  );
  const usage = await inject("GET", "/admin/agents/usage?days=7", {
    token: admin.token,
  });
  assert.equal(usage.statusCode, 200, usage.body);
  const claude = usage
    .json()
    .apps.find((x: { app: string }) => x.app === "Claude");
  assert.ok(claude.calls >= 7);
  assert.ok(claude.calls < 1000, "an opted-out person's calls aren't counted");
  assert.equal(
    (await inject("GET", "/admin/agents/usage", { token: me.token }))
      .statusCode,
    403,
  );
  assert.equal((await inject("GET", "/admin/agents/usage")).statusCode, 401);
  assert.equal(
    (
      await inject("GET", "/admin/agents/usage?days=900", {
        token: admin.token,
      })
    ).statusCode,
    422,
  );
  assert.equal(
    (await inject("GET", "/admin/agents/clients", { token: me.token }))
      .statusCode,
    403,
  );

  const detail = await inject("GET", `/admin/users/${u1.id}`, {
    token: admin.token,
  });
  const listed = detail
    .json()
    .agents.find((x: { id: string }) => x.id === g1.grant);
  assert.equal(listed.client_host, "agent.example.com");
  const revoke = await inject(
    "DELETE",
    `/admin/users/${u1.id}/agents/${g1.grant}`,
    {
      token: admin.token,
    },
  );
  assert.equal(revoke.statusCode, 204);
  assert.equal((await h.legacy(g1.access_token, "ping")).status, 401);
  assert.equal(
    (
      await inject("DELETE", `/admin/users/${u1.id}/agents/${g1.grant}`, {
        token: admin.token,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await inject("DELETE", `/admin/users/${u1.id}/agents/${g1.grant}`, {
        token: me.token,
      })
    ).statusCode,
    403,
  );
});

test("maintenance: refreshing keeps working (/oauth/ stays open)", async () => {
  const c = await connect(me, { access: "read" });
  await setting("maintenance", { enabled: true, message: "", until: null });
  try {
    const r = await refresh(c.refresh_token);
    assert.equal(r.statusCode, 200, r.body);
  } finally {
    await clear("maintenance");
  }
});

test("sign-ins that were allowed but never finished aren't listed, and are cleared after a day", async () => {
  const { runSweep } = await import("../src/lib/sweep.js");
  const who = await h.register("oauth-unfinished", "Pat");
  const session = await login(who);
  const allowed = await consent(session, request().req);
  assert.equal(allowed.statusCode, 200, allowed.body);
  const grant = (
    await pool.query<{ id: string; authorized_at: Date | null }>(
      "SELECT id, authorized_at FROM agent_grants WHERE user_id = $1 AND kind = 'oauth'",
      [who.id],
    )
  ).rows[0];
  assert.equal(grant.authorized_at, null);
  const listed = await inject("GET", "/me/agents", { token: who.token });
  assert.equal(listed.statusCode, 200);
  assert.ok(
    !listed.json().grants.some((g: { id: string }) => g.id === grant.id),
  );
  await runSweep();
  assert.equal(
    (await pool.query("SELECT 1 FROM agent_grants WHERE id = $1", [grant.id]))
      .rowCount,
    1,
    "kept for a day",
  );
  await pool.query(
    "UPDATE agent_grants SET created_at = now() - interval '2 days' WHERE id = $1",
    [grant.id],
  );
  const finished = await connect(me, { access: "read" });
  await pool.query(
    "UPDATE agent_grants SET created_at = now() - interval '2 days' WHERE id = $1",
    [finished.grant],
  );
  await runSweep();
  assert.equal(
    (await pool.query("SELECT 1 FROM agent_grants WHERE id = $1", [grant.id]))
      .rowCount,
    0,
  );
  assert.equal(
    (
      await pool.query("SELECT 1 FROM agent_grants WHERE id = $1", [
        finished.grant,
      ])
    ).rowCount,
    1,
    "a finished sign-in stays",
  );
});

test("sign-ins never finished don't count towards the limit, and allowing again restarts their day", async () => {
  const { MAX_GRANTS } = await import("../src/modules/agents/service.js");
  const { runSweep } = await import("../src/lib/sweep.js");
  const who = await h.register("oauth-abandoned", "Abe");
  await pool.query(
    `INSERT INTO agent_grants (user_id, kind, client_id, client_name, name, access)
     SELECT $1, 'oauth', 'https://abandoned.example.com/' || g, 'Gone', 'Gone', 'read'
       FROM generate_series(1, $2::int) g`,
    [who.id, MAX_GRANTS],
  );
  const c = await connect(who, { access: "read" });
  assert.ok(c.access_token, "abandoned sign-ins don't block a new one");

  // Allowed a day ago but never finished; allowed again just now.
  const session = await login(who);
  const first = await consent(
    session,
    request({ client_id: GPT, redirect_uri: GPT_CALLBACK }).req,
  );
  assert.equal(first.statusCode, 200, first.body);
  await pool.query(
    "UPDATE agent_grants SET created_at = now() - interval '2 days' WHERE user_id = $1 AND client_id = $2",
    [who.id, GPT],
  );
  const again = request({ client_id: GPT, redirect_uri: GPT_CALLBACK });
  const second = await consent(session, again.req);
  assert.equal(second.statusCode, 200, second.body);
  await runSweep();
  const t = await exchange(codeOf(second.json().redirect_to), again.verifier, {
    redirect_uri: GPT_CALLBACK,
    client_id: GPT,
  });
  assert.equal(t.statusCode, 200, t.body);
});

test("the limit is checked again when a sign-in finishes: two consents at once can't both pass it", async () => {
  const { MAX_GRANTS } = await import("../src/modules/agents/service.js");
  const who = await h.register("oauth-limit-race", "Lim");
  // One short of the limit, all finished.
  await pool.query(
    `INSERT INTO agent_grants (user_id, kind, client_id, client_name, name, access, authorized_at)
     SELECT $1, 'oauth', 'https://full.example.com/' || g, 'Full', 'Full', 'read', now()
       FROM generate_series(1, $2::int) g`,
    [who.id, MAX_GRANTS - 1],
  );
  const session = await login(who);
  // Two apps are allowed, each under the limit on its own.
  const a = request();
  const b = request({ client_id: GPT, redirect_uri: GPT_CALLBACK });
  const allowedA = await consent(session, a.req);
  const allowedB = await consent(session, b.req);
  assert.equal(allowedA.statusCode, 200, allowedA.body);
  assert.equal(allowedB.statusCode, 200, allowedB.body);
  // The first to finish takes the last place; the second is refused.
  const first = await exchange(codeOf(allowedA.json().redirect_to), a.verifier);
  assert.equal(first.statusCode, 200, first.body);
  const second = await exchange(
    codeOf(allowedB.json().redirect_to),
    b.verifier,
    { redirect_uri: GPT_CALLBACK, client_id: GPT },
  );
  assert.equal(second.statusCode, 400, second.body);
  assert.equal(second.json().error, "invalid_grant");
  assert.match(second.json().error_description, /connected agents/);
  const live = (
    await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM agent_grants
        WHERE user_id = $1 AND revoked_at IS NULL AND authorized_at IS NOT NULL`,
      [who.id],
    )
  ).rows[0].n;
  assert.equal(live, MAX_GRANTS);
  // Refreshing a connection that already finished still works at the limit.
  const again = await refresh(first.json().refresh_token);
  assert.equal(again.statusCode, 200, again.body);
});

test("maintenance: confirming it's you stays open, so the consent page can grant write access", async () => {
  const who = await h.register("oauth-maint-reauth", "Mae");
  await setting("maintenance", { enabled: true, message: "", until: null });
  try {
    const r = await inject("POST", "/me/reauth", {
      token: who.token,
      json: { password: PASSWORD },
    });
    assert.equal(r.statusCode, 200, r.body);
  } finally {
    await clear("maintenance");
  }
});

test("the consent page can't be framed; the metadata is routed at the issuer", async () => {
  const read = (f: string) => readFile(new URL(f, import.meta.url), "utf8");
  for (const file of [
    "../../desktop/nginx.conf",
    "../../deploy/k8s/web.yaml",
  ]) {
    const conf = await read(file);
    const page = conf.match(/location = \/oauth\/authorize \{([^}]*)\}/);
    assert.ok(page, `${file} has a location for the consent page`);
    assert.match(page[1], /frame-ancestors 'none'/);
    assert.match(page[1], /X-Frame-Options DENY/);
    assert.match(page[1], /Referrer-Policy no-referrer/);
    assert.match(page[1], /Cache-Control "no-store"/);
    assert.match(
      conf,
      /location = \/\.well-known\/oauth-authorization-server \{/,
    );
  }
  const gateway = await read("../../gateway/nginx.conf.template");
  const web = gateway.slice(
    gateway.indexOf("listen 8081;"),
    gateway.indexOf("listen 8082;"),
  );
  assert.match(web, /location = \/\.well-known\/oauth-authorization-server \{/);
  // The OAuth endpoints go through /api/ like every other API call.
  assert.doesNotMatch(web, /location \/api\/oauth/);
  assert.match(web, /location \/api\/ \{/);
});

test("the Privacy Policy and Terms describe connected agents, in a new version", async () => {
  const { DEFAULT_LEGAL_VERSION, LEGAL_DEFAULTS } = await import("@orbyn/core");
  assert.ok(DEFAULT_LEGAL_VERSION >= "2026-09-26", "everyone accepts again");
  assert.match(LEGAL_DEFAULTS.privacy, /## Connected agents/);
  assert.match(LEGAL_DEFAULTS.privacy, /their own privacy policy/);
  assert.match(LEGAL_DEFAULTS.privacy, /analytics/);
  assert.match(LEGAL_DEFAULTS.terms, /## Connected agents/);
  const served = await inject("GET", "/legal/privacy");
  assert.equal(served.statusCode, 200, served.body);
  assert.match(served.body, /Connected agents/);
});

/** A code valid right now for a base32 secret (as the server computes it). */
function liveCode(secret: string): string {
  const key = totp.base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(bin % 1_000_000).padStart(6, "0");
}

// ---- apps that sign in with a key (private_key_jwt, RFC 7523) ----

const KEYED = "https://agent.example.com/oauth/keyed.json";
const KEYED_URI = "https://agent.example.com/oauth/keyed-uri.json";
const JWKS_AT = "https://keys.example.com/jwks.json";
const JWT_BEARER = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";

const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
const stranger = generateKeyPairSync("rsa", { modulusLength: 2048 });
const rotated = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = (k: KeyObject, kid: string) => ({
  ...k.export({ format: "jwk" }),
  kid,
  use: "sig",
});
const RSA_JWK = jwk(rsa.publicKey, "rsa-1");
const EC_JWK = jwk(ec.publicKey, "ec-1");

type Claims = {
  alg?: "RS256" | "PS256" | "ES256";
  kid?: string;
  key?: KeyObject;
  iss?: string;
  sub?: string;
  aud?: string;
  iat?: number;
  exp?: number;
  jti?: string;
};
const nowSec = () => Math.floor(Date.now() / 1000);
/** A client assertion for `client`, valid unless `over` says otherwise. */
const signed = (client: string, over: Claims = {}) => {
  const alg = over.alg ?? "RS256";
  return new SignJWT({ jti: over.jti ?? randomBytes(12).toString("hex") })
    .setProtectedHeader({
      alg,
      kid: over.kid ?? (alg === "ES256" ? "ec-1" : "rsa-1"),
    })
    .setIssuer(over.iss ?? client)
    .setSubject(over.sub ?? client)
    .setAudience(over.aud ?? `${oauthIssuer()}/api/oauth/token`)
    .setIssuedAt(over.iat ?? nowSec())
    .setExpirationTime(over.exp ?? nowSec() + 60)
    .sign(over.key ?? (alg === "ES256" ? ec.privateKey : rsa.privateKey));
};
const b64 = (v: unknown) =>
  Buffer.from(JSON.stringify(v)).toString("base64url");
/** An unsigned ("none") or HMAC-signed assertion, as an attacker would try. */
const forged = (client: string, alg: "none" | "HS256") => {
  const head = b64({ alg, typ: "JWT" });
  const body = b64({
    iss: client,
    sub: client,
    aud: `${oauthIssuer()}/api/oauth/token`,
    iat: nowSec(),
    exp: nowSec() + 60,
    jti: randomBytes(8).toString("hex"),
  });
  if (alg === "none") return `${head}.${body}.`;
  const sig = createHmac("sha256", String(RSA_JWK.n))
    .update(`${head}.${body}`)
    .digest("base64url");
  return `${head}.${body}.${sig}`;
};
const keyedDoc = (id: string, extra: Record<string, unknown>) =>
  cimd(id, {
    client_name: "Keyed agent",
    token_endpoint_auth_method: "private_key_jwt",
    ...extra,
  });

/** Consent for `client`, returning an unspent code and its verifier. */
const codeFor = async (client: string, session: string) => {
  const { req, verifier } = request({ client_id: client });
  const r = await consent(session, req);
  assert.equal(r.statusCode, 200, r.body);
  return { code: codeOf(r.json().redirect_to), verifier };
};
const withAssertion = (assertion: string, over: Req = {}) => ({
  client_assertion_type: JWT_BEARER,
  client_assertion: assertion,
  ...over,
});

/** Forgets the apps a test uses, so each run fetches their documents afresh. */
const forget = async () => {
  await pool.query(
    "DELETE FROM oauth_clients WHERE id LIKE 'https://agent.example.com/oauth/%' AND id <> $1",
    [CLIENT],
  );
  await pool.query("DELETE FROM oauth_client_assertions");
};

/** Collects what the server logs about client authentication. */
const watchLog = () => {
  const lines: string[] = [];
  const real = console.warn;
  console.warn = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  return {
    lines,
    stop: () => {
      console.warn = real;
    },
  };
};

test("private_key_jwt with jwks in the document: the whole sign-in, and refresh, need a valid assertion", async () => {
  await forget();
  docs.set(KEYED, {
    status: 200,
    body: keyedDoc(KEYED, { jwks: { keys: [RSA_JWK, EC_JWK] } }),
    headers: { "content-type": "application/json" },
  });
  const session = await login(me);
  const shown = await check(request({ client_id: KEYED }).req, session);
  assert.equal(shown.statusCode, 200, shown.body);
  assert.equal(shown.json().client.name, "Keyed agent");
  const stored = (
    await pool.query("SELECT metadata FROM oauth_clients WHERE id = $1", [
      KEYED,
    ])
  ).rows[0].metadata;
  assert.equal(stored.auth_method, "private_key_jwt");
  assert.equal(stored.jwks.length, 2);

  const { code, verifier } = await codeFor(KEYED, session);
  const send = (over: Req) =>
    exchange(code, verifier, { client_id: KEYED, ...over });
  const refusedWith = async (over: Req, why: RegExp) => {
    const r = await send(over);
    assert.equal(r.statusCode, 401, `${why}: ${r.body}`);
    assert.equal(r.json().error, "invalid_client");
    assert.match(r.json().error_description, why);
  };

  const log = watchLog();
  const bad: [string, Req, RegExp][] = [
    ["missing", {}, /signs in with a signed key: send client_assertion/],
    [
      "wrong type",
      {
        client_assertion_type: "urn:x",
        client_assertion: await signed(KEYED),
      },
      /client_assertion_type must be/,
    ],
    [
      "wrong audience",
      withAssertion(await signed(KEYED, { aud: "https://elsewhere.example" })),
      /for another server/,
    ],
    [
      "expired",
      withAssertion(
        await signed(KEYED, { iat: nowSec() - 300, exp: nowSec() - 120 }),
      ),
      /expired/,
    ],
    [
      "too long",
      withAssertion(await signed(KEYED, { exp: nowSec() + 7200 })),
      /lasts too long/,
    ],
    [
      "too long from iat",
      withAssertion(
        await signed(KEYED, { iat: nowSec() - 3700, exp: nowSec() + 60 }),
      ),
      /lasts too long/,
    ],
    [
      "issued in the future",
      withAssertion(
        await signed(KEYED, { iat: nowSec() + 120, exp: nowSec() + 180 }),
      ),
      /future|isn't valid yet/,
    ],
    [
      "wrong key",
      withAssertion(await signed(KEYED, { key: stranger.privateKey })),
      /isn't signed with one of this app's keys/,
    ],
    [
      "another app's iss",
      withAssertion(await signed(KEYED, { iss: CLIENT })),
      /iss and sub/,
    ],
    [
      "another app's sub",
      withAssertion(await signed(KEYED, { sub: CLIENT })),
      /iss and sub/,
    ],
    ["alg none", withAssertion(forged(KEYED, "none")), /RS256, PS256, ES256/],
    ["HS256", withAssertion(forged(KEYED, "HS256")), /RS256, PS256, ES256/],
    ["garbage", withAssertion("not.a.jwt"), /isn't a valid signed JWT/],
  ];
  try {
    for (const [, over, why] of bad) await refusedWith(over, why);
  } finally {
    log.stop();
  }
  // The server logs the app and its method, never the assertion.
  assert.ok(
    log.lines.some(
      (l) => l.includes(KEYED) && l.includes('"method":"private_key_jwt"'),
    ),
  );
  assert.ok(!log.lines.some((l) => l.includes("eyJ")), "no assertion logged");

  // A refused app never burned the code: with a good assertion it works.
  const good = await signed(KEYED);
  const ok = await send(withAssertion(good));
  assert.equal(ok.statusCode, 200, ok.body);
  const tokens = ok.json();
  assert.match(tokens.access_token, /^oat_/);
  // The jti is kept hashed until the assertion expires…
  const kept = await pool.query(
    "SELECT jti_hash, expires_at FROM oauth_client_assertions WHERE client_id = $1",
    [KEYED],
  );
  assert.equal(kept.rowCount, 1);
  assert.ok(kept.rows[0].expires_at.getTime() > Date.now());
  // …and the same assertion can't be used again.
  const next = await codeFor(KEYED, session);
  const replay = await exchange(next.code, next.verifier, {
    client_id: KEYED,
    ...withAssertion(good),
  });
  assert.equal(replay.statusCode, 401);
  assert.match(replay.json().error_description, /already used/);

  // PKCE is still required with a key: no verifier, or a wrong one, fails.
  const noVerifier = await inject("POST", "/oauth/token", {
    form: {
      grant_type: "authorization_code",
      code: next.code,
      redirect_uri: CALLBACK,
      client_id: KEYED,
      ...withAssertion(await signed(KEYED)),
    },
  });
  assert.equal(noVerifier.statusCode, 400);
  assert.equal(noVerifier.json().error, "invalid_request");
  const wrongVerifier = await exchange(next.code, pkce().verifier, {
    client_id: KEYED,
    ...withAssertion(await signed(KEYED)),
  });
  assert.equal(wrongVerifier.json().error, "invalid_grant");

  // ES256 and PS256 work; so does the issuer as the audience, and leaving
  // client_id out (the assertion's sub names the app).
  for (const over of [
    { alg: "ES256" as const },
    { alg: "PS256" as const },
    { aud: oauthIssuer() },
  ]) {
    const c = await codeFor(KEYED, session);
    const r = await exchange(c.code, c.verifier, {
      client_id: KEYED,
      ...withAssertion(await signed(KEYED, over)),
    });
    assert.equal(r.statusCode, 200, `${JSON.stringify(over)}: ${r.body}`);
  }
  const bare = await codeFor(KEYED, session);
  const noId = await inject("POST", "/oauth/token", {
    form: {
      grant_type: "authorization_code",
      code: bare.code,
      redirect_uri: CALLBACK,
      code_verifier: bare.verifier,
      ...withAssertion(await signed(KEYED)),
    },
  });
  assert.equal(noId.statusCode, 200, noId.body);

  // Refreshing needs an assertion too.
  const noProof = await refresh(tokens.refresh_token, KEYED);
  assert.equal(noProof.statusCode, 401);
  assert.equal(noProof.json().error, "invalid_client");
  const wrongProof = await refresh(
    tokens.refresh_token,
    KEYED,
    withAssertion(await signed(KEYED, { key: stranger.privateKey })),
  );
  assert.equal(wrongProof.json().error, "invalid_client");
  const refreshed = await refresh(
    tokens.refresh_token,
    KEYED,
    withAssertion(await signed(KEYED)),
  );
  assert.equal(refreshed.statusCode, 200, refreshed.body);
  assert.match(refreshed.json().refresh_token, /^ort_/);

  // A public app can't send an assertion, and can't pass as a keyed one.
  const pub = await connect(me, { access: "read" });
  const asPublic = await refresh(
    pub.refresh_token,
    CLIENT,
    withAssertion(await signed(CLIENT)),
  );
  assert.equal(asPublic.statusCode, 401);
  assert.match(asPublic.json().error_description, /public app/);
});

test("private_key_jwt with jwks_uri: keys fetched through netguard, cached, and read again when a new key appears", async () => {
  await forget();
  const keySet = (keys: unknown[], etag: string) => ({
    status: 200,
    body: JSON.stringify({ keys }),
    headers: {
      "content-type": "application/jwk-set+json",
      etag,
      "cache-control": "max-age=600",
    },
  });
  docs.set(KEYED_URI, {
    status: 200,
    body: keyedDoc(KEYED_URI, { jwks_uri: JWKS_AT }),
  });
  docs.set(JWKS_AT, keySet([RSA_JWK], '"k1"'));
  const session = await login(me);
  fetched.length = 0;
  const a = await codeFor(KEYED_URI, session);
  const first = await exchange(a.code, a.verifier, {
    client_id: KEYED_URI,
    ...withAssertion(await signed(KEYED_URI)),
  });
  assert.equal(first.statusCode, 200, first.body);
  const b = await codeFor(KEYED_URI, session);
  const second = await exchange(b.code, b.verifier, {
    client_id: KEYED_URI,
    ...withAssertion(await signed(KEYED_URI)),
  });
  assert.equal(second.statusCode, 200, second.body);
  const reads = fetched.filter((f) => f.url === JWKS_AT);
  assert.equal(reads.length, 1, "cached while fresh");
  assert.match(reads[0].headers["user-agent"], /Orbyn/);

  // The app rotates to a new key. Keys read under a minute ago aren't read
  // again (so unknown kids can't make Orbyn fetch on every request)…
  docs.set(JWKS_AT, keySet([RSA_JWK, jwk(rotated.publicKey, "rsa-2")], '"k2"'));
  const c = await codeFor(KEYED_URI, session);
  const withNew = () =>
    signed(KEYED_URI, { key: rotated.privateKey, kid: "rsa-2" });
  const early = await exchange(c.code, c.verifier, {
    client_id: KEYED_URI,
    ...withAssertion(await withNew()),
  });
  assert.equal(early.statusCode, 401);
  // …but after that, an unknown key reads them again, with If-None-Match.
  await pool.query(
    `UPDATE oauth_clients SET metadata = jsonb_set(metadata, '{jwks_cache,fetched_at}',
       to_jsonb((extract(epoch FROM now()) * 1000 - 120000)::bigint)) WHERE id = $1`,
    [KEYED_URI],
  );
  const rotatedIn = await exchange(c.code, c.verifier, {
    client_id: KEYED_URI,
    ...withAssertion(await withNew()),
  });
  assert.equal(rotatedIn.statusCode, 200, rotatedIn.body);
  assert.equal(
    fetched.filter((f) => f.url === JWKS_AT).at(-1)!.headers["if-none-match"],
    '"k1"',
  );

  // Keys on a private address are never fetched.
  const inside = "https://agent.example.com/oauth/keyed-inside.json";
  const insideKeys = "https://rebind.example.com/jwks.json";
  docs.set(inside, {
    status: 200,
    body: keyedDoc(inside, { jwks_uri: insideKeys }),
  });
  docs.set(insideKeys, keySet([RSA_JWK], '"x"'));
  fetched.length = 0;
  const d = await codeFor(inside, session);
  const priv = await exchange(d.code, d.verifier, {
    client_id: inside,
    ...withAssertion(await signed(inside)),
  });
  assert.equal(priv.statusCode, 401);
  assert.equal(priv.json().error, "invalid_client");
  assert.match(priv.json().error_description, /Couldn't read this app's keys/);
  assert.ok(!fetched.some((f) => f.url === insideKeys), "never called");
});

test("CIMD auth methods: client_secret_* are served as public apps with PKCE; others are refused by name", async () => {
  await forget();
  const session = await login(me);
  const basic = "https://agent.example.com/oauth/basic.json";
  docs.set(basic, {
    status: 200,
    body: cimd(basic, {
      client_name: "Secretive agent",
      token_endpoint_auth_method: "client_secret_basic",
    }),
  });
  const log = watchLog();
  let shown;
  try {
    shown = await check(request({ client_id: basic }).req, session);
  } finally {
    log.stop();
  }
  assert.equal(shown.statusCode, 200, shown.body);
  assert.ok(
    log.lines.some(
      (l) => l.includes(basic) && l.includes('"method":"client_secret_basic"'),
    ),
  );
  const meta = (
    await pool.query("SELECT metadata FROM oauth_clients WHERE id = $1", [
      basic,
    ])
  ).rows[0].metadata;
  assert.equal(meta.auth_method, "none");
  assert.equal(meta.declared_auth_method, "client_secret_basic");

  // It authenticates the way it declared (an HTTP Basic header naming it,
  // client_id left out of the form); whatever secret it sends is ignored,
  // and PKCE decides.
  const a = await codeFor(basic, session);
  const header = `Basic ${Buffer.from(`${encodeURIComponent(basic)}:whatever`).toString("base64")}`;
  const noVerifier = await inject("POST", "/oauth/token", {
    headers: { authorization: header },
    form: {
      grant_type: "authorization_code",
      code: a.code,
      redirect_uri: CALLBACK,
    },
  });
  assert.equal(noVerifier.json().error, "invalid_request");
  const ok = await inject("POST", "/oauth/token", {
    headers: { authorization: header },
    form: {
      grant_type: "authorization_code",
      code: a.code,
      redirect_uri: CALLBACK,
      code_verifier: a.verifier,
    },
  });
  assert.equal(ok.statusCode, 200, ok.body);
  // A header naming another app than the form is refused.
  const mixed = await inject("POST", "/oauth/token", {
    headers: { authorization: header },
    form: {
      grant_type: "refresh_token",
      refresh_token: ok.json().refresh_token,
      client_id: CLIENT,
    },
  });
  assert.equal(mixed.json().error, "invalid_request");

  // client_secret_post: the same, with client_secret in the form ignored.
  const post = "https://agent.example.com/oauth/post.json";
  docs.set(post, {
    status: 200,
    body: cimd(post, { token_endpoint_auth_method: "client_secret_post" }),
  });
  const b = await codeFor(post, session);
  const posted = await exchange(b.code, b.verifier, {
    client_id: post,
    client_secret: "anything",
  });
  assert.equal(posted.statusCode, 200, posted.body);

  // Any other method is refused, named in plain words, and logged.
  const cases: [string, unknown, RegExp][] = [
    [
      "cert",
      "tls_client_auth",
      /^Claude asks to sign in with a client certificate \(tls_client_auth\), which Orbyn doesn't support yet\./,
    ],
    [
      "hmac",
      "client_secret_jwt",
      /^Claude asks to sign in with a token signed with a shared secret \(client_secret_jwt\), which Orbyn doesn't support yet\./,
    ],
    [
      "odd",
      "made_up_method",
      /^Claude asks to sign in with a method called "made_up_method", which Orbyn doesn't support yet\./,
    ],
  ];
  for (const [slug, method, why] of cases) {
    const id = `https://agent.example.com/oauth/${slug}.json`;
    docs.set(id, {
      status: 200,
      body: cimd(id, { token_endpoint_auth_method: method }),
    });
    const watch = watchLog();
    let r;
    try {
      r = await check(request({ client_id: id }).req, session);
    } finally {
      watch.stop();
    }
    assert.equal(r.statusCode, 400);
    assert.match(r.json().message, why);
    assert.ok(
      watch.lines.some(
        (l) => l.includes(id) && l.includes(`"method":"${method}"`),
      ),
      `logged ${method}`,
    );
  }

  // A key set holding a private key, or keys in two places, is refused.
  const leaky = "https://agent.example.com/oauth/leaky.json";
  docs.set(leaky, {
    status: 200,
    body: keyedDoc(leaky, {
      jwks: { keys: [rsa.privateKey.export({ format: "jwk" })] },
    }),
  });
  assert.match(
    (await check(request({ client_id: leaky }).req, session)).json().message,
    /publishes a private or secret key/,
  );
  const both = "https://agent.example.com/oauth/both.json";
  docs.set(both, {
    status: 200,
    body: keyedDoc(both, { jwks: { keys: [RSA_JWK] }, jwks_uri: JWKS_AT }),
  });
  assert.match(
    (await check(request({ client_id: both }).req, session)).json().message,
    /both jwks and jwks_uri/,
  );
  const hs = "https://agent.example.com/oauth/hs.json";
  docs.set(hs, {
    status: 200,
    body: keyedDoc(hs, {
      jwks: { keys: [RSA_JWK] },
      token_endpoint_auth_signing_alg: "HS256",
    }),
  });
  assert.match(
    (await check(request({ client_id: hs }).req, session)).json().message,
    /HS256, which Orbyn doesn't support yet/,
  );
});
