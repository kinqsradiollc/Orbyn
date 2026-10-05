import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import {
  authenticateTeamsActivity,
  createTeamsSigningKeyCache,
  teamsServiceUrl,
  TeamsAuthenticationError,
} from "../src/modules/agent-channels/teams-auth.js";
const appId = randomUUID(),
  now = Date.parse("2026-10-06T10:00:00Z"),
  serviceUrl = "https://smba.trafficmanager.net/teams/";
const pair = await generateKeyPair("RS256", { modulusLength: 2048 });
const key = {
  ...(await exportJWK(pair.publicKey)),
  kid: "fixture",
  endorsements: ["msteams"],
};
const body = () => ({
  type: "message",
  channelId: "msteams",
  serviceUrl,
  recipient: { id: `28:${appId}` },
  from: { id: "29:fixture", aadObjectId: randomUUID() },
  text: "Private answer",
});
async function signed(
  claims: Record<string, unknown> = {},
  content: unknown = body(),
) {
  const jwt = await new SignJWT({ serviceUrl, ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "fixture" })
    .setIssuer(String(claims.iss ?? "https://api.botframework.com"))
    .setAudience(String(claims.aud ?? appId))
    .setNotBefore(Number(claims.nbf ?? now / 1000 - 10))
    .setExpirationTime(Number(claims.exp ?? now / 1000 + 3600))
    .sign(pair.privateKey);
  return {
    raw: Buffer.from(JSON.stringify(content)),
    headers: {
      authorization: `Bearer ${jwt}`,
      "content-type": "application/json",
    },
  };
}
const refuse = (status: number) => (e: unknown) =>
  e instanceof TeamsAuthenticationError && e.status === status;
const read = async (
  claims: Record<string, unknown> = {},
  content?: unknown,
) => {
  const s = await signed(claims, content);
  return authenticateTeamsActivity(
    s.raw,
    s.headers,
    { appId },
    async () => [key],
    now,
  );
};
test("connector JWT verifies audience, issuer, time, Teams endorsement and exact service URL", async () => {
  const input = body();
  assert.deepEqual(await read({}, input), input);
  assert.equal(teamsServiceUrl(serviceUrl), serviceUrl);
});
test("other audiences, issuers, expired and future tokens fail cryptographic authentication", async () => {
  for (const change of [
    { aud: randomUUID() },
    { iss: "https://attacker.invalid" },
    { exp: now / 1000 - 301 },
    { nbf: now / 1000 + 301 },
  ])
    await assert.rejects(read(change), refuse(401));
});
test("absent, duplicate and malformed Authorization reject before body parsing or key lookup", async () => {
  for (const authorization of [
    undefined,
    ["Bearer fixture"],
    "Basic fixture",
    "Bearer malformed",
  ]) {
    await assert.rejects(
      authenticateTeamsActivity(
        Buffer.from("{"),
        { authorization },
        { appId },
        async () => {
          throw new Error("Key lookup must not occur");
        },
        now,
      ),
      refuse(401),
    );
  }
});
test("Teams key endorsement, unique kid and minimum RSA key strength are mandatory", async () => {
  const s = await signed();
  for (const [keys, status] of [
    [[{ ...key, endorsements: [] }], 403],
    [[{ ...key, endorsements: ["emulator"] }], 403],
    [[], 401],
    [[key, key], 401],
    [[{ ...key, n: "AQAB" }], 401],
  ] as const)
    await assert.rejects(
      authenticateTeamsActivity(
        s.raw,
        s.headers,
        { appId },
        async () => [...keys],
        now,
      ),
      refuse(status),
    );
});
test("signed service URL and recipient must match the incoming activity exactly", async () => {
  await assert.rejects(
    read({ serviceUrl: "https://smba.trafficmanager.net/amer/" }),
    refuse(403),
  );
  await assert.rejects(
    read({}, { ...body(), recipient: { id: `28:${randomUUID()}` } }),
    refuse(403),
  );
  await assert.rejects(
    read({}, { ...body(), channelId: "emulator" }),
    refuse(400),
  );
});
test("connector token never authorizes arbitrary hosts, query strings, redirects or ambiguous paths", () => {
  for (const value of [
    "http://smba.trafficmanager.net/teams/",
    "https://attacker.invalid/teams/",
    "https://smba.trafficmanager.net.attacker.invalid/teams/",
    "https://smba.trafficmanager.net:444/teams/",
    "https://user:password@smba.trafficmanager.net/teams/",
    `${serviceUrl}?token=private`,
    `${serviceUrl}#private`,
    `${serviceUrl}../`,
    `${serviceUrl}%2f`,
    `${serviceUrl}v3/conversations/`,
    "https://SMBA.trafficmanager.net/teams/",
  ])
    assert.throws(() => teamsServiceUrl(value), refuse(403));
  assert.equal(
    teamsServiceUrl("https://smba.trafficmanager.net/amer/"),
    "https://smba.trafficmanager.net/amer/",
  );
});
test("bounded body, content type and UTF-8 remain strict after authentication", async () => {
  const s = await signed();
  await assert.rejects(
    authenticateTeamsActivity(
      Buffer.alloc(65537),
      s.headers,
      { appId },
      async () => [key],
      now,
    ),
    refuse(413),
  );
  await assert.rejects(
    authenticateTeamsActivity(
      Buffer.from([0xff]),
      s.headers,
      { appId },
      async () => [key],
      now,
    ),
    refuse(400),
  );
  await assert.rejects(
    authenticateTeamsActivity(
      s.raw,
      { ...s.headers, "content-type": "text/plain" },
      { appId },
      async () => [key],
      now,
    ),
    refuse(400),
  );
  await assert.rejects(
    authenticateTeamsActivity(
      s.raw,
      s.headers,
      { appId: "invalid" },
      async () => [key],
      now,
    ),
    refuse(503),
  );
});

test("fixed key fetches are bounded, cached, deduplicated and refreshed with a cooldown", async () => {
  let tick = now,
    calls = 0;
  const fetcher: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(url, "https://login.botframework.com/v1/.well-known/keys");
    assert.equal(init?.redirect, "error");
    assert.equal(init?.headers, undefined);
    assert.ok(init?.signal);
    return Response.json({ keys: [key] });
  };
  const keys = createTeamsSigningKeyCache(fetcher, () => tick);
  const results = await Promise.all([keys(), keys(), keys()]);
  assert.equal(calls, 1);
  assert.deepEqual(results[0], results[1]);
  await keys(true);
  assert.equal(calls, 1, "unknown key cannot bypass refresh cooldown");
  tick += 60001;
  await keys(true);
  assert.equal(calls, 2);
  tick += 3600001;
  await keys();
  assert.equal(calls, 3, "cache refreshes well within24hours");
});
test("oversized, malformed, refused or redirected key documents never become trust anchors", async () => {
  for (const respond of [
    () => new Response("x".repeat(2 * 1024 * 1024 + 1)),
    () => Response.json({ keys: [] }),
    () => Response.json({ keys: [{ ...key, kty: "oct" }] }),
    () => new Response("", { status: 500 }),
    () =>
      new Response("", {
        status: 302,
        headers: { location: "https://attacker.invalid" },
      }),
  ]) {
    const keys = createTeamsSigningKeyCache(async () => respond());
    await assert.rejects(keys(), refuse(503));
  }
});
test("unknown key may refresh trusted keys once, but cannot choose a remote URL", async () => {
  const s = await signed();
  let calls = 0;
  const lookup = async (refresh = false) => {
    calls++;
    return refresh ? [key] : [];
  };
  await authenticateTeamsActivity(s.raw, s.headers, { appId }, lookup, now);
  assert.equal(calls, 2);
});

test("an audience list cannot substitute for the exact bot application audience", async () => {
  const token = await new SignJWT({ serviceUrl })
    .setProtectedHeader({ alg: "RS256", kid: "fixture" })
    .setIssuer("https://api.botframework.com")
    .setAudience([appId, randomUUID()])
    .setNotBefore(now / 1000 - 10)
    .setExpirationTime(now / 1000 + 3600)
    .sign(pair.privateKey);
  await assert.rejects(
    authenticateTeamsActivity(
      Buffer.from(JSON.stringify(body())),
      { authorization: `Bearer ${token}`, "content-type": "application/json" },
      { appId },
      async () => [key],
      now,
    ),
    refuse(401),
  );
});

test("the key document supports Microsoft current catalog size without trusting certificate metadata", async () => {
  const catalog = Array.from({ length: 233 }, (_, i) => ({
    ...key,
    kid: `fixture-${i}`,
    x5c: ["x".repeat(3000)],
  }));
  const payload = JSON.stringify({ keys: catalog });
  assert.ok(Buffer.byteLength(payload) > 65536);
  assert.ok(Buffer.byteLength(payload) < 2 * 1024 * 1024);
  const keys = createTeamsSigningKeyCache(async () => new Response(payload));
  assert.equal((await keys()).length, 233);
});
