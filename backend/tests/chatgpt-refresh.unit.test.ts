import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { refreshChatgptTokens: refresh } = createRequire(import.meta.url)(
  "../../desktop/chatgpt-oauth.cjs",
);
const saved = {
  clientId: "oaiapp_fixture",
  idToken: "old-id",
  refreshToken: "old-refresh",
  scopes: ["openid", "chatgpt.tokens.use.direct"],
};
const response = (over = {}) =>
  new Response(
    JSON.stringify({
      access_token: "new-access",
      token_type: "Bearer",
      expires_in: 3600,
      ...over,
    }),
  );

test("refresh uses only the issued registration, renewable token and fixed resource", async () => {
  const result = await refresh(saved, {
    fetch: async (url: string, init: RequestInit) => {
      assert.equal(url, "https://auth.openai.com/api/accounts/oauth/token");
      assert.equal(init.redirect, "error");
      assert.equal(init.credentials, "omit");
      assert.deepEqual(Object.fromEntries(init.body as URLSearchParams), {
        grant_type: "refresh_token",
        client_id: saved.clientId,
        refresh_token: saved.refreshToken,
        resource: "https://api.openai.com/v1",
      });
      return response({
        refresh_token: "replacement-refresh",
        id_token: "replacement-id",
        scope: "openid",
      });
    },
  });
  assert.equal(result.refreshToken, "replacement-refresh");
  assert.equal(result.idToken, "replacement-id");
  assert.equal(result.sharingGranted, false);
  assert.equal(result.accessToken, "new-access");
});

test("omitted refresh fields preserve the retained identity, renewable token and grant", async () => {
  const result = await refresh(saved, { fetch: async () => response() });
  assert.equal(result.idToken, saved.idToken);
  assert.equal(result.refreshToken, saved.refreshToken);
  assert.deepEqual(result.scopes, saved.scopes);
  assert.equal(result.sharingGranted, true);
  assert.notEqual(result.scopes, saved.scopes);
});

test("invalid registration or credentials never reach the provider", async () => {
  let calls = 0;
  for (const over of [
    { clientId: "dynamic_agent_client" },
    { refreshToken: null },
    { refreshToken: "bad token" },
    { idToken: "" },
    { scopes: ["bad scope"] },
  ])
    await assert.rejects(
      refresh(
        { ...saved, ...over },
        {
          fetch: async () => {
            calls++;
            return response();
          },
        },
      ),
    );
  assert.equal(calls, 0);
});

test("expired refresh grants and malformed replacements fail without mutating saved credentials", async () => {
  const original = structuredClone(saved);
  await assert.rejects(
    refresh(saved, {
      fetch: async () =>
        new Response(
          JSON.stringify({
            error: "invalid_grant",
            error_description: "private-fixture",
          }),
          { status: 400 },
        ),
    }),
    (error: any) =>
      error.code === "AUTH_REFRESH_EXPIRED" &&
      !error.message.includes("private-fixture"),
  );
  for (const over of [
    { access_token: "" },
    { refresh_token: "" },
    { id_token: null },
    { scope: null },
    { expires_in: 0 },
  ])
    await assert.rejects(
      refresh(saved, { fetch: async () => response(over) }),
      (error: any) => error.code === "AUTH_RESPONSE",
    );
  assert.deepEqual(saved, original);
});

test("cancellation fences a late refresh response", async () => {
  const controller = new AbortController();
  await assert.rejects(
    refresh(saved, {
      signal: controller.signal,
      fetch: async () => {
        controller.abort();
        return response();
      },
    }),
    (error: any) => error.code === "AUTH_ABORTED",
  );
});
