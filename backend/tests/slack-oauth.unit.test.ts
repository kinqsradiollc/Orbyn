import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { slackInstallationConfirm, slackChannelPermission } from "@orbyn/core";
import {
  newSlackOAuthState,
  slackAuthorizationUrl,
  slackOAuthConfigDigest,
  validateSlackOAuthConfig,
  readSlackInstallation,
  exchangeSlackCode,
} from "../src/modules/agent-channels/slack-oauth.js";

const config = {
  clientId: "123.456",
  clientSecret: "synthetic-slack-client-secret",
  appId: "AFIXTURE",
  redirectUri: "https://orbyn.example/api/agent-channels/slack/callback",
};
const granted = () => ({
  ok: true,
  app_id: config.appId,
  token_type: "bot",
  access_token: "synthetic-bot-token",
  bot_user_id: "UBOT",
  scope: "chat:write,im:write",
  authed_user: {
    id: "UINSTALLER",
    access_token: "must-not-store-personal-token",
  },
  team: { id: "TFIXTURE", name: "Test workspace" },
  is_enterprise_install: false,
});
const refusal = (status: number) => (error: unknown) => {
  assert.equal((error as { statusCode: number }).statusCode, status);
  assert.doesNotMatch(
    String(error),
    /synthetic|must-not-store|upstream-secret/,
  );
  return true;
};

test("Slack state is random and only a one-way digest is needed for callback lookup", () => {
  const first = newSlackOAuthState(),
    second = newSlackOAuthState();
  assert.match(first.state, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first.state, second.state);
  assert.equal(
    first.digest,
    createHash("sha256").update(first.state).digest("hex"),
  );
  assert.notEqual(first.digest, first.state);
});
test("Slack installation uses fixed authorization endpoint, exact callback and minimum bot scopes", () => {
  const state = newSlackOAuthState().state;
  const url = new URL(slackAuthorizationUrl(config, state));
  assert.equal(url.origin, "https://slack.com");
  assert.equal(url.pathname, "/oauth/v2/authorize");
  assert.equal(url.searchParams.get("redirect_uri"), config.redirectUri);
  assert.equal(url.searchParams.get("state"), state);
  assert.equal(url.searchParams.get("scope"), "chat:write,im:write,im:history");
  for (const field of [
    "client_secret",
    "user_scope",
    "access_token",
    "response_url",
  ])
    assert.equal(url.searchParams.has(field), false);
});
test("Slack callback configuration rejects redirects, userinfo, fragments and missing app secrets", () => {
  for (const redirectUri of [
    "http://orbyn.example/agent-channels/slack/callback",
    "https://orbyn.example/elsewhere",
    "https://user:password@orbyn.example/agent-channels/slack/callback",
    `${config.redirectUri}?redirect=https://bad.invalid`,
    `${config.redirectUri}#fragment`,
  ])
    assert.throws(
      () => validateSlackOAuthConfig({ ...config, redirectUri }),
      refusal(503),
    );
  assert.throws(
    () => validateSlackOAuthConfig({ ...config, clientSecret: "" }),
    refusal(503),
  );
  assert.throws(
    () => slackAuthorizationUrl(config, "untrusted-state"),
    refusal(400),
  );
});
test("Pending Slack app/config digest changes with app, client, secret and callback", () => {
  const digest = slackOAuthConfigDigest(config);
  for (const changed of [
    { appId: "ANEWAPP" },
    { clientId: "123.999" },
    { clientSecret: "different-synthetic-secret" },
    { redirectUri: "https://other.example/agent-channels/slack/callback" },
  ])
    assert.notEqual(slackOAuthConfigDigest({ ...config, ...changed }), digest);
});
test("Slack bot installation is bound to verified workspace/installer and ignores personal tokens", () => {
  const normalized = readSlackInstallation(granted(), config.appId);
  assert.equal(normalized.workspaceId, "TFIXTURE");
  assert.equal(normalized.userId, "UINSTALLER");
  assert.equal(normalized.accessToken, "synthetic-bot-token");
  assert.equal(normalized.expiresAt, null);
  assert.doesNotMatch(
    JSON.stringify(normalized),
    /must-not-store-personal-token/,
  );
});
test("Wrong app, workspace-less installs, missing actor/scopes and user tokens cannot be linked", () => {
  for (const changed of [
    { app_id: "ADIFFERENT" },
    { team: null },
    { is_enterprise_install: true },
    { authed_user: {} },
    { token_type: "user" },
    { scope: "chat:write" },
    { expires_in: 3600 },
    { refresh_token: "synthetic-refresh" },
  ])
    assert.throws(
      () => readSlackInstallation({ ...granted(), ...changed }, config.appId),
      refusal(503),
    );
});
test("Rotating Slack credentials preserve a bounded expiry and refresh token", () => {
  const now = new Date("2026-10-05T09:00:00Z");
  const value = readSlackInstallation(
    { ...granted(), expires_in: 43200, refresh_token: "synthetic-refresh" },
    config.appId,
    now,
  );
  assert.equal(value.expiresAt, "2026-10-05T21:00:00.000Z");
  assert.equal(value.refreshToken, "synthetic-refresh");
});
test("Slack code exchange sends only fixed endpoint and matching administrator callback", async () => {
  let calls = 0;
  const send: typeof fetch = async (url, options) => {
    calls++;
    assert.equal(url, "https://slack.com/api/oauth.v2.access");
    assert.equal(options?.method, "POST");
    assert.equal(options?.redirect, "error");
    assert.ok(options?.signal);
    const form = options?.body as URLSearchParams;
    assert.equal(form.get("code"), "synthetic-code");
    assert.equal(form.get("client_secret"), config.clientSecret);
    assert.equal(form.get("redirect_uri"), config.redirectUri);
    return Response.json(granted());
  };
  assert.equal(
    (await exchangeSlackCode(config, "synthetic-code", send)).workspaceId,
    "TFIXTURE",
  );
  assert.equal(calls, 1);
});
test("Slack external errors and malformed or oversized responses remain generic", async () => {
  for (const response of [
    new Response("upstream-secret", { status: 429 }),
    new Response("not-json upstream-secret"),
    new Response("x".repeat(65537)),
    Response.json({ ok: false, error: "upstream-secret" }),
  ]) {
    await assert.rejects(
      exchangeSlackCode(config, "synthetic-code", async () => response),
      refusal(503),
    );
  }
  await assert.rejects(
    exchangeSlackCode(config, "synthetic-code", async () => {
      throw new Error("upstream-secret");
    }),
    refusal(503),
  );
});
test("Slack confirmation and opt-in require strict boolean/version/actor review", () => {
  const review = {
    workspace_id: "TFIXTURE",
    external_user_id: "UINSTALLER",
    expected_bot_scopes: ["chat:write", "im:write"],
    expected_version: 0,
    dm_enabled: false,
  };
  assert.equal(slackInstallationConfirm.parse(review).dm_enabled, false);
  for (const change of [
    { dm_enabled: "true" },
    { expected_version: -1 },
    { external_user_id: "someone@example.test" },
    { extra: "authority" },
  ])
    assert.equal(
      slackInstallationConfirm.safeParse({ ...review, ...change }).success,
      false,
    );
  assert.equal(
    slackChannelPermission.safeParse({ dm_enabled: true, expected_version: 0 })
      .success,
    false,
  );
});
