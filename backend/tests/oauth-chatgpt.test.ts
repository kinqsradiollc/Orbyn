import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  type KeyObject,
} from "node:crypto";
import { SignJWT } from "jose";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";
import { helpers, type Person } from "./mcp-helpers.js";

/**
 * Connecting Orbyn to ChatGPT, played the way ChatGPT does it: the 401
 * challenge from /mcp → protected-resource metadata → the authorization
 * server's metadata → ChatGPT's client ID metadata document (private_key_jwt,
 * keys at jwks_uri) → the consent page → the browser back at ChatGPT's
 * callback → the code exchanged with a signed assertion → /mcp → refresh.
 * Every variant ChatGPT may send is tried. No real network: ChatGPT's
 * document and keys are stood in for, signed with our own key.
 */

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { outbound } = await import("../src/lib/netguard.js");
const { env, oauthIssuer } = await import("../src/config/env.js");

const app = await buildApp();
const h = helpers(app);
const PASSWORD = "a-long-test-password";

const CLIENT_ID = "https://chatgpt.com/oauth/client.json";
const JWKS_URI = "https://chatgpt.com/oauth/jwks.json";
const CALLBACK = "https://chatgpt.com/connector_platform_oauth_redirect";
const JWT_BEARER = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
const KID = "cimd-20260428030119";

const key = generateKeyPairSync("rsa", { modulusLength: 2048 });
const JWK = {
  ...key.publicKey.export({ format: "jwk" }),
  kid: KID,
  use: "sig",
  alg: "RS256",
};

/** ChatGPT's document, as https://chatgpt.com/oauth/client.json serves it. */
const CLIENT_DOC = {
  client_id: CLIENT_ID,
  client_uri: "https://chatgpt.com/",
  redirect_uris: [CALLBACK],
  token_endpoint_auth_method: "private_key_jwt",
  token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  client_name: "ChatGPT",
  logo_uri: "https://persistent.oaistatic.com/sonic/misc/openai-logo.png",
  token_endpoint_auth_signing_alg: "RS256",
  jwks_uri: JWKS_URI,
};

const served = new Map<
  string,
  { body: string; headers: Record<string, string> }
>([
  [
    CLIENT_ID,
    {
      body: JSON.stringify(CLIENT_DOC),
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=300",
      },
    },
  ],
  [
    JWKS_URI,
    {
      body: JSON.stringify({ keys: [JWK] }),
      headers: { "content-type": "application/json" },
    },
  ],
]);
const realLookup = outbound.lookup;
const realRequest = outbound.request;

let n = 0;
const address = () => `10.93.${Math.floor(n / 250) % 250}.${n++ % 250}`;

type Inject = Parameters<typeof app.inject>[0] & object;
const call = (opts: Inject) =>
  app.inject({ remoteAddress: address(), ...opts } as Inject);

const nowSec = () => Math.floor(Date.now() / 1000);

/** A client assertion shaped like ChatGPT's (RS256, kid, jti, short-lived). */
const assertion = (
  over: {
    aud?: string | string[];
    kid?: string | null;
    lifetime?: number;
    signer?: KeyObject;
    jti?: string;
  } = {},
) => {
  const header: { alg: string; typ: string; kid?: string } = {
    alg: "RS256",
    typ: "JWT",
  };
  if (over.kid !== null) header.kid = over.kid ?? KID;
  return new SignJWT({ jti: over.jti ?? randomBytes(16).toString("hex") })
    .setProtectedHeader(header)
    .setIssuer(CLIENT_ID)
    .setSubject(CLIENT_ID)
    .setAudience(over.aud ?? `${oauthIssuer()}/api/oauth/token`)
    .setIssuedAt(nowSec())
    .setExpirationTime(nowSec() + (over.lifetime ?? 300))
    .sign(over.signer ?? key.privateKey);
};

/** A token-endpoint request as a form (or JSON, when asked). */
const tokenCall = (
  body: Record<string, string>,
  as: "form" | "json" = "form",
  headers: Record<string, string> = {},
) =>
  call({
    method: "POST",
    url: "/oauth/token",
    headers: {
      "content-type":
        as === "form"
          ? "application/x-www-form-urlencoded"
          : "application/json",
      accept: "application/json",
      ...headers,
    },
    payload:
      as === "form"
        ? new URLSearchParams(body).toString()
        : JSON.stringify(body),
  });

const initialize = (token: string | null) =>
  h.post(
    {
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "openai-mcp", version: "1.0.0" },
      },
    },
    {
      accept: "application/json, text/event-stream",
      origin: "https://chatgpt.com",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  );

let me: Person;

before(async () => {
  await migrate();
  outbound.lookup = async (host: string) => {
    if (host !== "chatgpt.com") throw new Error("ENOTFOUND");
    return [{ address: "93.184.215.30", family: 4 }];
  };
  outbound.request = (async (checked: { url: URL }) => {
    const doc = served.get(String(checked.url));
    if (!doc) return new Response("missing", { status: 404 });
    return new Response(doc.body, { status: 200, headers: doc.headers });
  }) as typeof outbound.request;
  await pool.query("DELETE FROM oauth_clients WHERE id = $1", [CLIENT_ID]);
  me = await h.register("gpt-me", "Kim");
  await pool.query("UPDATE users SET role = 'member' WHERE id = $1", [me.id]);
});

after(async () => {
  outbound.lookup = realLookup;
  outbound.request = realRequest;
  await app.close();
  await pool.end();
});

const login = async () =>
  (
    await call({
      method: "POST",
      url: "/auth/login",
      payload: { email: me.email, password: PASSWORD },
    })
  ).json().token as string;

/** Discovery, exactly as ChatGPT walks it. */
async function discover() {
  const challenged = await initialize(null);
  assert.equal(challenged.status, 401, JSON.stringify(challenged.body));
  const header = String(challenged.headers["www-authenticate"]);
  const prmUrl = header.match(/resource_metadata="([^"]+)"/)?.[1];
  assert.ok(prmUrl, header);
  const prm = await call({ method: "GET", url: new URL(prmUrl).pathname });
  assert.equal(prm.statusCode, 200);
  const resource = prm.json().resource as string;
  assert.equal(resource, env.MCP_PUBLIC_URL);
  const issuer = prm.json().authorization_servers[0] as string;
  assert.equal(issuer, oauthIssuer());
  // RFC 8414 §3: the issuer's path (none here) is appended after the well-known part.
  const asm = await call({
    method: "GET",
    url: "/.well-known/oauth-authorization-server",
  });
  assert.equal(asm.statusCode, 200);
  const meta = asm.json();
  assert.equal(meta.issuer, issuer);
  assert.equal(meta.client_id_metadata_document_supported, true);
  assert.ok(
    meta.token_endpoint_auth_methods_supported.includes("private_key_jwt"),
  );
  assert.ok(meta.code_challenge_methods_supported.includes("S256"));
  return { resource, meta };
}

type Variant = {
  name: string;
  resource?: string;
  scope?: string;
  aud?: (tokenEndpoint: string, issuer: string) => string | string[];
  body?: "form" | "json";
  clientIdInBody?: boolean;
  kid?: null;
  /** Seconds the assertion lasts (ChatGPT's own lifetime isn't published). */
  lifetime?: number;
};

/** The parameters the consent page reads from its address. */
const PAGE_PARAMS = [
  "response_type",
  "client_id",
  "redirect_uri",
  "code_challenge",
  "code_challenge_method",
  "state",
  "scope",
  "resource",
];

/** The whole connection for one variant; returns the tokens. */
async function connect(v: Variant) {
  const { resource, meta } = await discover();
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("base64url");
  const req: Record<string, string> = {
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: CALLBACK,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  };
  const res = v.resource === undefined ? resource : v.resource;
  if (res) req.resource = res;
  if (v.scope !== undefined) req.scope = v.scope;

  // The browser opens the authorization endpoint: the web app's page.
  const authorize = new URL(meta.authorization_endpoint as string);
  for (const [k, val] of Object.entries(req))
    authorize.searchParams.set(k, val);
  // ChatGPT adds parameters of its own, some repeated.
  authorize.searchParams.append("ba_param", "a");
  authorize.searchParams.append("ba_param", "b");
  assert.equal(authorize.pathname, "/oauth/authorize");

  const session = await login();
  const shown = await call({
    method: "GET",
    url: `/oauth/authorize/check${authorize.search}`,
    headers: { authorization: `Bearer ${session}` },
  });
  assert.equal(shown.statusCode, 200, `${v.name}: ${shown.body}`);
  assert.equal(shown.json().client.name, "ChatGPT");
  assert.equal(shown.json().client.verified, true);

  // The page sends the request as it read it from its address.
  const request = Object.fromEntries(
    PAGE_PARAMS.flatMap((k) => {
      const val = authorize.searchParams.get(k);
      return val === null ? [] : [[k, val]];
    }),
  );
  const allowed = await call({
    method: "POST",
    url: "/oauth/authorize",
    headers: { authorization: `Bearer ${session}` },
    payload: { request, access: "write" },
  });
  assert.equal(allowed.statusCode, 200, `${v.name}: ${allowed.body}`);
  const back = new URL(allowed.json().redirect_to);
  // A plain https address the browser opens with GET: ChatGPT's callback.
  assert.equal(`${back.origin}${back.pathname}`, CALLBACK);
  assert.equal(back.searchParams.get("state"), state);
  assert.equal(back.searchParams.get("iss"), meta.issuer);
  const code = back.searchParams.get("code");
  assert.ok(code);

  const tokenEndpoint = meta.token_endpoint as string;
  assert.equal(new URL(tokenEndpoint).pathname, "/api/oauth/token");
  const body: Record<string, string> = {
    grant_type: "authorization_code",
    code,
    redirect_uri: CALLBACK,
    code_verifier: verifier,
    client_assertion_type: JWT_BEARER,
    client_assertion: await assertion({
      aud: v.aud?.(tokenEndpoint, meta.issuer),
      kid: v.kid,
      lifetime: v.lifetime,
    }),
  };
  if (v.clientIdInBody !== false) body.client_id = CLIENT_ID;
  if (res) body.resource = res;
  const exchanged = await tokenCall(body, v.body);
  assert.equal(exchanged.statusCode, 200, `${v.name}: ${exchanged.body}`);
  const tokens = exchanged.json();
  assert.equal(tokens.token_type, "Bearer");
  assert.ok(
    tokens.access_token && tokens.refresh_token && tokens.expires_in > 0,
  );
  assert.equal(exchanged.headers["cache-control"], "no-store");

  // The token works at /mcp.
  const init = await initialize(tokens.access_token);
  assert.equal(init.status, 200, `${v.name}: ${JSON.stringify(init.body)}`);
  const list = await h.legacy(tokens.access_token, "tools/list", undefined, {
    origin: "https://chatgpt.com",
  });
  assert.equal(list.status, 200);
  // The profile tool ChatGPT calls right after linking (openai/profile).
  const profileTool = list.body.result.tools.find(
    (t: { _meta?: Record<string, unknown> }) => t._meta?.["openai/profile"],
  );
  assert.equal(profileTool?.name, "get_profile");
  assert.deepEqual(profileTool.inputSchema.properties, {});
  assert.deepEqual(profileTool.outputSchema.required, ["id"]);
  const profile = await h.legacy(
    tokens.access_token,
    "tools/call",
    { name: "get_profile", arguments: {} },
    { origin: "https://chatgpt.com" },
  );
  assert.equal(profile.status, 200);
  const result = profile.body.result;
  assert.notEqual(result.isError, true, JSON.stringify(result));
  assert.match(result.structuredContent.id, /^prf_[0-9a-f]{32}$/);
  assert.equal(result.structuredContent.name, "Kim");
  assert.deepEqual(
    JSON.parse(result.content[0].text),
    result.structuredContent,
  );

  // Refresh, with a fresh assertion.
  const refreshBody: Record<string, string> = {
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
    client_assertion_type: JWT_BEARER,
    client_assertion: await assertion({
      aud: v.aud?.(tokenEndpoint, meta.issuer),
      kid: v.kid,
      lifetime: v.lifetime,
    }),
  };
  if (v.clientIdInBody !== false) refreshBody.client_id = CLIENT_ID;
  if (res) refreshBody.resource = res;
  const refreshed = await tokenCall(refreshBody, v.body);
  assert.equal(refreshed.statusCode, 200, `${v.name}: ${refreshed.body}`);
  const again = await initialize(refreshed.json().access_token);
  assert.equal(again.status, 200);
  return tokens;
}

const VARIANTS: Variant[] = [
  { name: "as metadata says: resource, no scope, aud = token endpoint" },
  {
    name: "with scope from the PRM",
    scope: "orbyn:read orbyn:propose orbyn:write orbyn:bookings",
  },
  { name: "with offline_access", scope: "orbyn:read offline_access" },
  {
    name: "resource without a path",
    resource: new URL(env.MCP_PUBLIC_URL).origin,
  },
  {
    name: "resource with a trailing slash",
    resource: `${env.MCP_PUBLIC_URL}/`,
  },
  { name: "no resource at all", resource: "" },
  { name: "aud = issuer", aud: (_t, iss) => iss },
  { name: "aud = issuer with a slash", aud: (_t, iss) => `${iss}/` },
  { name: "aud = [token endpoint, issuer]", aud: (t, iss) => [t, iss] },
  { name: "client_id only in the assertion", clientIdInBody: false },
  { name: "a JSON body", body: "json" },
  { name: "no kid in the header", kid: null },
  { name: "an assertion that lasts an hour", lifetime: 3600 },
];

for (const v of VARIANTS)
  test(`ChatGPT connects: ${v.name}`, async () => {
    await connect(v);
  });

test("ChatGPT: the profile id is the same on every connection of one account", async () => {
  const ids = new Set<string>();
  for (let i = 0; i < 2; i++) {
    const { access_token } = await connect({ name: `profile ${i}` });
    const r = await h.tool(access_token, "get_profile");
    ids.add(r?.structuredContent.id);
  }
  assert.equal(ids.size, 1);
  const other = await h.register("gpt-other", "Ari");
  const key = await h.agentKey(other);
  const theirs = await h.tool(key.key, "get_profile");
  assert.ok(!ids.has(theirs?.structuredContent.id));
});

test("ChatGPT: MCP discovery right after linking (initialize in each version, lists)", async () => {
  const { access_token } = await connect({ name: "discovery" });
  const headers = {
    authorization: `Bearer ${access_token}`,
    accept: "application/json, text/event-stream",
    origin: "https://chatgpt.com",
  };
  for (const version of ["2025-03-26", "2025-06-18", "2025-11-25"]) {
    const r = await h.post(
      {
        jsonrpc: "2.0",
        id: 0,
        method: "initialize",
        params: {
          protocolVersion: version,
          capabilities: {},
          clientInfo: { name: "openai-mcp", version: "1.0.0" },
        },
      },
      headers,
    );
    assert.equal(r.status, 200, version);
    assert.equal(r.body.result.protocolVersion, version);
  }
  const versioned = { ...headers, "mcp-protocol-version": "2025-06-18" };
  const note = await h.post(
    { jsonrpc: "2.0", method: "notifications/initialized" },
    versioned,
  );
  assert.equal(note.status, 202);
  for (const method of [
    "tools/list",
    "resources/list",
    "resources/templates/list",
    "prompts/list",
  ]) {
    const r = await h.post({ jsonrpc: "2.0", id: 1, method }, versioned);
    assert.equal(r.status, 200, method);
  }
  // No stream to open: 405, as the transport allows.
  const stream = await call({
    method: "GET",
    url: "/mcp",
    headers: {
      authorization: `Bearer ${access_token}`,
      accept: "text/event-stream",
    },
  });
  assert.equal(stream.statusCode, 405);
});

test("ChatGPT: what must still be refused (replay, wrong key, audience, redirect, PKCE)", async () => {
  const { meta } = await discover();
  const session = await login();
  const start = async (over: Record<string, string> = {}) => {
    const verifier = randomBytes(48).toString("base64url");
    const request = {
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: CALLBACK,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      state: "s",
      resource: env.MCP_PUBLIC_URL,
      ...over,
    };
    const r = await call({
      method: "POST",
      url: "/oauth/authorize",
      headers: { authorization: `Bearer ${session}` },
      payload: { request, access: "read" },
    });
    return { r, verifier };
  };
  // Only the declared callback, exactly.
  for (const redirect of [
    "https://chatgpt.com/connector/oauth/abc",
    `${CALLBACK}/`,
    "https://evil.example/connector_platform_oauth_redirect",
  ])
    assert.equal((await start({ redirect_uri: redirect })).r.statusCode, 400);
  // PKCE with S256, always.
  assert.equal(
    (await start({ code_challenge_method: "plain" })).r.statusCode,
    400,
  );
  // Another resource.
  assert.equal(
    (await start({ resource: "https://mcp.example.com/mcp" })).r.statusCode,
    400,
  );

  const exchange = async (clientAssertion: string) => {
    const { r, verifier } = await start();
    assert.equal(r.statusCode, 200, r.body);
    const code = new URL(r.json().redirect_to).searchParams.get("code")!;
    return tokenCall({
      grant_type: "authorization_code",
      code,
      redirect_uri: CALLBACK,
      code_verifier: verifier,
      client_id: CLIENT_ID,
      resource: env.MCP_PUBLIC_URL,
      client_assertion_type: JWT_BEARER,
      client_assertion: clientAssertion,
    });
  };
  const stranger = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const refusals: [string, string][] = [
    ["another key", await assertion({ signer: stranger.privateKey })],
    ["another server", await assertion({ aud: "https://orbyn.example" })],
    ["the MCP address as aud", await assertion({ aud: env.MCP_PUBLIC_URL })],
    ["too long", await assertion({ lifetime: 7200 })],
  ];
  for (const [why, a] of refusals) {
    const r = await exchange(a);
    assert.equal(r.statusCode, 401, `${why}: ${r.body}`);
    assert.equal(r.json().error, "invalid_client");
  }
  // One assertion, once.
  const jti = randomBytes(8).toString("hex");
  assert.equal((await exchange(await assertion({ jti }))).statusCode, 200);
  const replay = await exchange(await assertion({ jti }));
  assert.equal(replay.statusCode, 401);
  assert.match(replay.json().error_description, /already used/);
  assert.equal(meta.authorization_response_iss_parameter_supported, true);
});
