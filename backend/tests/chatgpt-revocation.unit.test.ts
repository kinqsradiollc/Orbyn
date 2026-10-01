import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { revokeChatgptTokens: revoke } = createRequire(import.meta.url)(
  "../../desktop/chatgpt-oauth.cjs",
);
const credentials = {
  clientId: "oaiapp_fixture",
  refreshToken: "private-fixture-refresh",
};
const configuration = {
  issuer: "https://auth.openai.com",
  revocation_endpoint: "https://auth.openai.com/oauth/revoke",
};

test("revocation discovers the provider endpoint and sends only the renewable token and issued client", async () => {
  let calls = 0;
  const result = await revoke(credentials, {
    fetch: async (url: string, init: RequestInit) => {
      calls++;
      assert.equal(init.redirect, "error");
      assert.equal(init.credentials, "omit");
      if (calls === 1) {
        assert.equal(
          url,
          "https://auth.openai.com/.well-known/openid-configuration",
        );
        assert.equal(init.method, "GET");
        return Response.json(configuration);
      }
      assert.equal(url, configuration.revocation_endpoint);
      assert.deepEqual(Object.fromEntries(init.body as URLSearchParams), {
        token: credentials.refreshToken,
        token_type_hint: "refresh_token",
        client_id: credentials.clientId,
      });
      return new Response(null, { status: 200 });
    },
  });
  assert.deepEqual(result, { revoked: true });
  assert.equal(calls, 2);
});

test("untrusted discovery, redirects and oversized or malformed configuration cannot receive a token", async () => {
  for (const config of [
    { ...configuration, issuer: "https://other.invalid" },
    { ...configuration, revocation_endpoint: "https://other.invalid/revoke" },
    {
      ...configuration,
      revocation_endpoint: "https://user:password@auth.openai.com/revoke",
    },
    { ...configuration, revocation_endpoint: "http://auth.openai.com/revoke" },
    {
      ...configuration,
      revocation_endpoint: "https://auth.openai.com/revoke?secret=1",
    },
  ]) {
    let calls = 0;
    const result = await revoke(credentials, {
      fetch: async () => {
        calls++;
        return Response.json(config);
      },
    });
    assert.deepEqual(result, { revoked: false });
    assert.equal(calls, 1);
  }
  for (const response of [
    new Response("bad-json"),
    new Response("x".repeat(262_145)),
    new Response(null, { status: 302 }),
  ]) {
    assert.deepEqual(
      await revoke(credentials, { fetch: async () => response }),
      { revoked: false },
    );
  }
});

test("revocation retries one transient provider failure and reports unconfirmed termination without private details", async () => {
  for (const recover of [true, false]) {
    let calls = 0;
    const result = await revoke(credentials, {
      fetch: async () => {
        if (++calls === 1) return Response.json(configuration);
        return recover && calls === 3
          ? new Response(null, { status: 200 })
          : new Response("private-provider-error", { status: 503 });
      },
    });
    assert.deepEqual(result, { revoked: recover });
    assert.equal(calls, 3);
  }
});

test("invalid revocation input never reaches the network and cancellation reports unconfirmed status", async () => {
  let calls = 0;
  for (const over of [
    { clientId: "dynamic_agent_client" },
    { refreshToken: "bad token" },
    { refreshToken: "" },
  ]) {
    await assert.rejects(
      revoke(
        { ...credentials, ...over },
        {
          fetch: async () => {
            calls++;
            return new Response();
          },
        },
      ),
    );
  }
  assert.equal(calls, 0);
  const controller = new AbortController();
  controller.abort();
  assert.deepEqual(
    await revoke(credentials, {
      signal: controller.signal,
      fetch: async (_url: string, init: RequestInit) => {
        init.signal?.throwIfAborted();
        return new Response();
      },
    }),
    { revoked: false },
  );
});
