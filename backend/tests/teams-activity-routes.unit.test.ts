import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { createService } from "../src/services/http.js";
import { pool } from "../src/db/pool.js";
import { receiveTeamsActivity } from "../src/modules/agent-channels/teams-activity.js";
import { createTeamsActivityRoutes } from "../src/modules/agent-channels/teams-activity-routes.js";
const config = {
  clientId: randomUUID(),
  clientSecret: "fixture-user-identity-secret",
  botAppId: randomUUID(),
  redirectUri: "https://orbyn.example/api/agent-channels/teams/callback",
};
const pair = await generateKeyPair("RS256", { modulusLength: 2048 });
const key = {
  ...(await exportJWK(pair.publicKey)),
  kid: "fixture",
  endorsements: ["msteams"],
};
const serviceUrl = "https://smba.trafficmanager.net/teams/";
const content = {
  type: "message",
  id: randomUUID(),
  channelId: "msteams",
  serviceUrl,
  recipient: { id: `28:${config.botAppId}` },
  text: "Unrelated private message",
};
async function token(audience = config.botAppId) {
  return new SignJWT({ serviceUrl })
    .setProtectedHeader({ alg: "RS256", kid: "fixture" })
    .setIssuer("https://api.botframework.com")
    .setAudience(audience)
    .setNotBefore(Math.floor(Date.now() / 1000) - 10)
    .setExpirationTime(Math.floor(Date.now() / 1000) + 600)
    .sign(pair.privateKey);
}
test("Teams activity HTTP authenticates raw Connector payloads and preserves normal settings JSON parsing", async () => {
  mock.method(pool, "query", async () => ({ rows: [], rowCount: 0 }));
  let configured = true;
  const app = await createService("api", [
    createTeamsActivityRoutes(
      (raw, headers, c) =>
        receiveTeamsActivity(raw, headers, c, async () => [key]),
      () => (configured ? config : undefined),
    ),
    async (server) => {
      server.post("/fixture/json", async (request) => {
        assert.deepEqual(request.body, { ordinary: true });
        return { ok: true };
      });
    },
  ]);
  const jwt = await token();
  let address = 1;
  const call = (
    authorization: string | undefined,
    payload = JSON.stringify(content),
    remoteAddress = `10.88.0.${address++}`,
    url = "/agent-channels/teams/activities",
  ) =>
    app.inject({
      method: "POST",
      url,
      remoteAddress,
      headers: {
        "content-type": "application/json",
        ...(authorization ? { authorization } : {}),
      },
      payload,
    });
  try {
    assert.equal((await call(undefined)).statusCode, 401);
    assert.equal((await call("Bearer session")).statusCode, 401);
    assert.equal(
      (await call(`Bearer ${await token(randomUUID())}`)).statusCode,
      401,
    );
    const forbidden = await call(
      `Bearer ${jwt}`,
      JSON.stringify({ ...content, recipient: { id: `28:${randomUUID()}` } }),
    );
    assert.equal(forbidden.statusCode, 403);
    assert.doesNotMatch(
      forbidden.body,
      /Unrelated private message|fixture-user-identity-secret/,
    );
    assert.equal((await call(`Bearer ${jwt}`, "{")).statusCode, 400);
    const good = await call(`Bearer ${jwt}`);
    assert.equal(good.statusCode, 200, good.body);
    assert.deepEqual(good.json(), { received: true });
    assert.equal(good.headers["cache-control"], "no-store");
    assert.equal(
      (await call(`Bearer ${jwt}`, "x".repeat(65537))).statusCode,
      413,
    );
    assert.equal(
      (
        await call(
          `Bearer ${jwt}`,
          JSON.stringify(content),
          undefined,
          "/agent-channels/teams/activities?unexpected=private",
        )
      ).statusCode,
      422,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/fixture/json",
          payload: { ordinary: true },
          remoteAddress: "10.88.3.1",
        })
      ).statusCode,
      200,
    );
    let limited = false;
    for (let i = 0; i < 125; i++)
      if (
        (await call(`Bearer ${jwt}`, JSON.stringify(content), "10.88.2.1"))
          .statusCode === 429
      ) {
        limited = true;
        break;
      }
    assert.ok(limited);
    configured = false;
    assert.equal((await call(`Bearer ${jwt}`)).statusCode, 503);
  } finally {
    await app.close();
    mock.restoreAll();
  }
});
