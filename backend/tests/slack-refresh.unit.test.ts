import { test } from "node:test";
import assert from "node:assert/strict";
import { refreshSlackToken } from "../src/modules/agent-channels/slack-refresh.js";
const config = {
  clientId: "123.456",
  clientSecret: "synthetic-slack-client-secret",
  appId: "AFIXTURE",
  redirectUri: "https://orbyn.example/api/agent-channels/slack/callback",
};
const previous = {
  appId: "AFIXTURE",
  workspaceId: "TFIXTURE",
  workspaceName: "Fixture",
  userId: "UOWNER",
  botUserId: "UBOT",
  scopes: ["chat:write", "im:write"],
  accessToken: "synthetic-old-access",
  refreshToken: "synthetic-old-refresh",
  expiresAt: "2026-10-05T12:00:00.000Z",
};
const fresh = () => ({
  ok: true,
  token_type: "bot",
  scope: "im:write,chat:write",
  access_token: "synthetic-new-access",
  refresh_token: "synthetic-new-refresh",
  expires_in: 43200,
});
test("refresh redeems one bot refresh token at a fixed endpoint and preserves verified identity/permissions", async () => {
  let calls = 0;
  const now = new Date("2026-10-05T11:58:00Z");
  const result = await refreshSlackToken(
    config,
    previous,
    async (url, init) => {
      calls++;
      assert.equal(String(url), "https://slack.com/api/oauth.v2.access");
      assert.equal(init?.redirect, "error");
      assert.equal(init?.method, "POST");
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get("grant_type"), "refresh_token");
      assert.equal(body.get("refresh_token"), previous.refreshToken);
      assert.equal(body.get("client_id"), config.clientId);
      assert.equal(body.get("client_secret"), config.clientSecret);
      assert.equal(body.has("code"), false);
      assert.equal(body.has("redirect_uri"), false);
      return Response.json({
        ...fresh(),
        authed_user: {
          id: previous.userId,
          access_token: "never-store-personal-token",
        },
        team: { id: previous.workspaceId },
        app_id: previous.appId,
        bot_user_id: previous.botUserId,
        enterprise: { id: "EFIXTURE" },
      });
    },
    now,
  );
  assert.equal(calls, 1);
  assert.equal(result.state, "ready");
  if (result.state === "ready") {
    assert.deepEqual(result.installation, {
      ...previous,
      accessToken: "synthetic-new-access",
      refreshToken: "synthetic-new-refresh",
      expiresAt: "2026-10-05T23:58:00.000Z",
    });
    assert.doesNotMatch(JSON.stringify(result), /never-store/);
  }
});
test("identity/scope changes, wrong token type, token reuse and invalid bounds fail closed after redemption", async () => {
  for (const change of [
    { app_id: "AOTHER" },
    { team: { id: "TOTHER" } },
    { bot_user_id: "UOTHER" },
    { authed_user: { id: "UOTHER" } },
    { token_type: "user" },
    { is_enterprise_install: true },
    { scope: "chat:write" },
    { scope: "chat:write,im:write,admin:write" },
    { refresh_token: previous.refreshToken },
    { access_token: previous.accessToken },
    { expires_in: 0 },
    { expires_in: 86401 },
    { refresh_token: "" },
  ]) {
    const result = await refreshSlackToken(config, previous, async () =>
      Response.json({ ...fresh(), ...change }),
    );
    assert.deepEqual(result, { state: "unknown" });
  }
});
test("invalid credentials cannot send a refresh request", async () => {
  let calls = 0;
  const request: typeof fetch = async () => {
    calls++;
    return Response.json(fresh());
  };
  for (const changed of [
    { refreshToken: undefined, expiresAt: null },
    { appId: "AOTHER" },
    { userId: "invalid" },
    { scopes: [] },
  ])
    await refreshSlackToken(config, { ...previous, ...changed }, request);
  assert.equal(calls, 0);
});
test("rate limits use bounded declared delay without an internal retry", async () => {
  for (const [header, delay] of [
    ["1", 5],
    ["100000", 3600],
    ["bad", 60],
  ]) {
    let calls = 0;
    const result = await refreshSlackToken(config, previous, async () => {
      calls++;
      return new Response("", {
        status: 429,
        headers: { "retry-after": header },
      });
    });
    assert.deepEqual(result, { state: "limited", retryAfter: delay });
    assert.equal(calls, 1);
  }
});
test("explicit invalid-token refusals require reconnect; other private errors remain unknown and sanitized", async () => {
  for (const error of [
    "invalid_refresh_token",
    "token_revoked",
    "invalid_client_id",
  ])
    assert.deepEqual(
      await refreshSlackToken(config, previous, async () =>
        Response.json({ ok: false, error }),
      ),
      { state: "reconnect" },
    );
  for (const request of [
    async () => new Response("private-token", { status: 503 }),
    async () => new Response("not-json"),
    async () => Response.json({ ok: false, error: "private-token" }),
    async () => {
      throw new Error("private-token");
    },
    async () => new Response("x".repeat(65537)),
  ]) {
    const result = await refreshSlackToken(config, previous, request);
    assert.deepEqual(result, { state: "unknown" });
    assert.doesNotMatch(JSON.stringify(result), /private-token/);
  }
});
