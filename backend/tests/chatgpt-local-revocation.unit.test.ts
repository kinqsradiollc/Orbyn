import { test } from "node:test";
import assert from "node:assert/strict";
import { revokeChatgptLocalGrant } from "@orbyn/api-client";
const grant = {
  clientId: "oaiapp_fixture",
  accessToken: "private-access",
  refreshToken: "private-refresh",
  idToken: "private-id",
  scopes: ["resource.invoke", "chatgpt.tokens.use.direct"],
  sharingGranted: true,
  savedAt: 100000,
  expiresAt: 100001,
};
test("empty 200 revokes exact renewable grant without API credentials", async () => {
  await revokeChatgptLocalGrant(grant, {
    fetch: (async (url, init) => {
      assert.equal(url, "https://auth.openai.com/api/accounts/oauth/revoke");
      assert.deepEqual(Object.fromEntries(init!.body as URLSearchParams), {
        client_id: "oaiapp_fixture",
        token: "private-refresh",
        token_type_hint: "refresh_token",
      });
      assert.equal(init!.redirect, "error");
      assert.equal(init!.credentials, "omit");
      assert.equal(init!.cache, "no-store");
      assert.equal(new Headers(init!.headers).has("Authorization"), false);
      return new Response(null, { status: 200 });
    }) as typeof fetch,
  });
});
test("transient failures retry with backoff and stop after confirmation", async () => {
  let calls = 0;
  await revokeChatgptLocalGrant(grant, {
    fetch: (async () => {
      calls++;
      return new Response(null, { status: calls === 1 ? 503 : 200 });
    }) as typeof fetch,
  });
  assert.equal(calls, 2);
});
test("persistent 5xx has three bounded attempts and sanitized errors", async () => {
  let calls = 0;
  await assert.rejects(
    revokeChatgptLocalGrant(grant, {
      fetch: (async () => {
        calls++;
        return new Response("private-refresh", { status: 500 });
      }) as typeof fetch,
    }),
    (e) => !String(e).includes("private-refresh"),
  );
  assert.equal(calls, 3);
});
test("non-200 successful status does not falsely confirm revocation", async () => {
  let calls = 0;
  await assert.rejects(
    revokeChatgptLocalGrant(grant, {
      fetch: (async () => {
        calls++;
        return new Response(null, { status: 204 });
      }) as typeof fetch,
    }),
  );
  assert.equal(calls, 1);
});
test("missing refresh token needs no remote renewable-session request", async () => {
  await revokeChatgptLocalGrant(
    { ...grant, refreshToken: null },
    {
      fetch: (async () => {
        throw new Error("unexpected");
      }) as typeof fetch,
    },
  );
});
test("external cancellation during backoff prevents another attempt", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    revokeChatgptLocalGrant(grant, {
      signal: controller.signal,
      fetch: (async () => {
        calls++;
        setTimeout(() => controller.abort(), 10);
        return new Response(null, { status: 503 });
      }) as typeof fetch,
    }),
  );
  assert.equal(calls, 1);
});
test("uncooperative fetch cannot keep disconnect pending beyond deadline", async () => {
  await assert.rejects(
    revokeChatgptLocalGrant(grant, {
      timeoutMs: 10,
      fetch: (async () => new Promise(() => {})) as typeof fetch,
    }),
  );
});
