import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import {
  validateTeamsOAuthConfig,
  teamsOAuthConfigDigest,
  newTeamsOAuthState,
  teamsAuthorizationUrl,
  verifyTeamsUserIdentity,
  exchangeTeamsCode,
  microsoftIdentityKeys,
} from "../src/modules/agent-channels/teams-oauth.js";
import { TeamsAuthenticationError } from "../src/modules/agent-channels/teams-auth.js";
const config = {
  clientId: randomUUID(),
  clientSecret: "fixture-oauth-client-secret",
  botAppId: randomUUID(),
  redirectUri: "https://orbyn.example/api/agent-channels/teams/callback",
};
const tenant = randomUUID(),
  oid = randomUUID(),
  now = Date.parse("2026-10-06T10:00:00Z"),
  pending = newTeamsOAuthState();
const pair = await generateKeyPair("RS256", { modulusLength: 2048 });
const key = {
  ...(await exportJWK(pair.publicKey)),
  kid: "fixture",
  issuer: "https://login.microsoftonline.com/{tenantid}/v2.0",
};
const keyLookup = async (id: string) => {
  assert.equal(id, tenant);
  return [key];
};
const refusal = (status: number) => (e: unknown) =>
  e instanceof TeamsAuthenticationError && e.status === status;
async function token(overrides: Record<string, unknown> = {}) {
  return new SignJWT({
    tid: tenant,
    oid,
    sub: "fixture-subject",
    ver: "2.0",
    nonce: pending.nonce,
    name: "Fixture user",
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256", kid: "fixture" })
    .setAudience(String(overrides.aud ?? config.clientId))
    .setIssuer(
      String(
        overrides.iss ?? `https://login.microsoftonline.com/${tenant}/v2.0`,
      ),
    )
    .setIssuedAt(Number(overrides.iat ?? now / 1000))
    .setNotBefore(Number(overrides.nbf ?? now / 1000 - 5))
    .setExpirationTime(Number(overrides.exp ?? now / 1000 + 3600))
    .sign(pair.privateKey);
}
test("authorization requests independent state/nonce/S256 and identity-only organizational scopes", () => {
  const url = new URL(teamsAuthorizationUrl(config, pending));
  assert.equal(url.origin, "https://login.microsoftonline.com");
  assert.equal(url.pathname, "/organizations/oauth2/v2.0/authorize");
  assert.equal(url.searchParams.get("scope"), "openid profile");
  assert.equal(url.searchParams.get("prompt"), "select_account");
  assert.equal(url.searchParams.get("redirect_uri"), config.redirectUri);
  assert.equal(url.searchParams.get("nonce"), pending.nonce);
  assert.equal(
    url.searchParams.get("code_challenge"),
    createHash("sha256").update(pending.verifier).digest("base64url"),
  );
  assert.notEqual(pending.nonce, pending.verifier);
  assert.notEqual(pending.nonce, pending.state);
  assert.equal(
    pending.digest,
    createHash("sha256").update(pending.state).digest("hex"),
  );
  assert.ok(!url.href.includes(config.clientSecret));
});
test("callback configuration cannot be supplied by a request origin or carry credentials, fragments or query capabilities", () => {
  assert.deepEqual(validateTeamsOAuthConfig(config), config);
  for (const redirectUri of [
    "http://orbyn.example/api/agent-channels/teams/callback",
    "https://user:secret@orbyn.example/api/agent-channels/teams/callback",
    config.redirectUri + "?secret=private",
    config.redirectUri + "#private",
    "https://orbyn.example/anything",
  ])
    assert.throws(
      () => validateTeamsOAuthConfig({ ...config, redirectUri }),
      refusal(503),
    );
  assert.notEqual(
    teamsOAuthConfigDigest(config),
    teamsOAuthConfigDigest({ ...config, botAppId: randomUUID() }),
  );
  assert.notEqual(
    teamsOAuthConfigDigest(config),
    teamsOAuthConfigDigest({
      ...config,
      clientSecret: "changed-client-secret",
    }),
  );
  assert.throws(
    () =>
      teamsAuthorizationUrl(config, {
        ...pending,
        challenge: newTeamsOAuthState().challenge,
      }),
    refusal(400),
  );
});
test("verified user identity uses tenant/object IDs, never email matching or application credentials", async () => {
  const result = await verifyTeamsUserIdentity(
    await token({ email: "same-email@fixture.invalid" }),
    config.clientId,
    pending.nonce,
    keyLookup,
    now,
  );
  assert.deepEqual(result, {
    tenantId: tenant,
    objectId: oid,
    subject: "fixture-subject",
    displayName: "Fixture user",
  });
  assert.equal("email" in result, false);
  assert.equal("accessToken" in result, false);
});
test("wrong nonce, audience, issuer, tenant version, stale time, application identity and absent object ID reject", async () => {
  for (const change of [
    { nonce: newTeamsOAuthState().nonce },
    { aud: randomUUID() },
    { iss: "https://attacker.invalid" },
    { ver: "1.0" },
    { exp: now / 1000 - 31 },
    { nbf: now / 1000 + 31 },
    { iat: now / 1000 - 631 },
    { idtyp: "app" },
    { oid: undefined },
    { oid: "email@fixture.invalid" },
    { azp: randomUUID() },
  ])
    await assert.rejects(
      verifyTeamsUserIdentity(
        await token(change),
        config.clientId,
        pending.nonce,
        keyLookup,
        now,
      ),
      refusal(401),
    );
});
test("unverified tenant cannot choose another origin, consumer identity or an arbitrary key endpoint", async () => {
  for (const tid of [
    "attacker.invalid",
    "../../private",
    "9188040d-6c67-4c5b-b112-36a304b66dad",
  ])
    await assert.rejects(
      verifyTeamsUserIdentity(
        await token({ tid }),
        config.clientId,
        pending.nonce,
        async () => {
          throw new Error("Key lookup must not occur");
        },
        now,
      ),
      refusal(401),
    );
});
test("Microsoft signing-key issuer and unique matching RSA kid are mandatory", async () => {
  const signed = await token();
  for (const keys of [
    [],
    [key, key],
    [{ ...key, issuer: "https://attacker.invalid" }],
    [{ ...key, n: "AQAB" }],
  ])
    await assert.rejects(
      verifyTeamsUserIdentity(
        signed,
        config.clientId,
        pending.nonce,
        async () => keys,
        now,
      ),
      refusal(401),
    );
  assert.equal(
    (
      await verifyTeamsUserIdentity(
        signed,
        config.clientId,
        pending.nonce,
        async () => [
          {
            ...key,
            issuer: `https://login.microsoftonline.com/${tenant}/v2.0`,
          },
        ],
        now,
      )
    ).objectId,
    oid,
  );
});
test("code redemption is one fixed bounded POST and returns only verified identity", async () => {
  const signed = await token();
  let calls = 0;
  const request: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(
      url,
      "https://login.microsoftonline.com/organizations/oauth2/v2.0/token",
    );
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    const body = new URLSearchParams(String(init?.body));
    assert.equal(body.get("client_secret"), config.clientSecret);
    assert.equal(body.get("code_verifier"), pending.verifier);
    assert.equal(body.get("scope"), "openid profile");
    assert.equal(body.get("redirect_uri"), config.redirectUri);
    return Response.json({
      id_token: signed,
      access_token: "discard-this-private-token",
      refresh_token: "not-requested",
    });
  };
  const result = await exchangeTeamsCode(
    config,
    "fixture-code",
    pending,
    request,
    keyLookup,
    now,
  );
  assert.equal(calls, 1);
  assert.equal(result.objectId, oid);
  assert.equal("access_token" in result, false);
});
test("transport, rate-limit, provider refusal, invalid token and oversized response never replay the code or expose private content", async () => {
  for (const respond of [
    () => {
      throw new Error("PRIVATE-TOKEN");
    },
    () => new Response("PRIVATE-TOKEN", { status: 429 }),
    () => new Response("PRIVATE-TOKEN", { status: 400 }),
    () =>
      Response.json({
        id_token: "invalid",
        error_description: "PRIVATE-TOKEN",
      }),
    () => new Response("x".repeat(65537)),
  ]) {
    let calls = 0;
    await assert.rejects(
      exchangeTeamsCode(
        config,
        "fixture-code",
        pending,
        async () => {
          calls++;
          return respond();
        },
        keyLookup,
        now,
      ),
      (e) => refusal(503)(e) && !(e as Error).message.includes("PRIVATE-TOKEN"),
    );
    assert.equal(calls, 1);
  }
});
test("tenant-key discovery uses only Microsoft HTTPS and strips unused metadata", async () => {
  const result = await microsoftIdentityKeys(tenant, async (url, init) => {
    assert.equal(
      url,
      `https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`,
    );
    assert.equal(init?.headers, undefined);
    assert.equal(init?.redirect, "error");
    return Response.json({ keys: [{ ...key, x5c: ["unused-certificate"] }] });
  });
  assert.equal(result.length, 1);
  assert.equal("x5c" in result[0], false);
  await assert.rejects(
    microsoftIdentityKeys("https://attacker.invalid", async () => {
      throw new Error("Must not fetch");
    }),
    refusal(403),
  );
});
