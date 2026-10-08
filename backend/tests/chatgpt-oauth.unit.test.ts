import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { request } from "node:http";
const { prepareChatgptAuthorization: prepare } = createRequire(import.meta.url)(
  "../../desktop/chatgpt-oauth.cjs",
);
const hostId = `urn:uuid:${randomUUID()}`;
const options = { hostId, timeoutMs: 5000 };
const callback = (attempt: any, fields: Record<string, string> = {}) => {
  const url = new URL(attempt.redirectUri);
  url.searchParams.set(
    "state",
    new URL(attempt.authorizationUrl).searchParams.get("state")!,
  );
  for (const [key, value] of Object.entries(fields))
    url.searchParams.set(key, value);
  return url;
};
const status = (code: string) => (error: any) => error.code === code;

test("returning authorization sends its retained identity hint only to the fixed OpenAI endpoint", async () => {
  const attempt = await prepare({
    ...options,
    clientId: "oaiapp_returning",
    idTokenHint: "private-fixture-id",
  });
  try {
    const url = new URL(attempt.authorizationUrl);
    assert.equal(url.origin, "https://auth.openai.com");
    assert.equal(url.searchParams.get("id_token_hint"), "private-fixture-id");
    assert.equal(url.searchParams.get("agent_name_hint"), null);
    await fetch(
      callback(attempt, {
        code: "fixture-code",
        client_id: "oaiapp_returning",
      }),
    );
    const result = await attempt.result;
    assert.equal(result.idTokenHint, undefined);
    assert.equal(result.clientId, "oaiapp_returning");
  } finally {
    attempt.cancel();
  }
  for (const over of [
    { idTokenHint: "fixture-id" },
    { clientId: "oaiapp_returning", idTokenHint: "bad hint" },
    { clientId: "oaiapp_returning", idTokenHint: "x".repeat(65_537) },
  ])
    await assert.rejects(
      prepare({ ...options, ...over }),
      status("AUTH_INPUT"),
    );
});

test("dynamic registration binds a loopback URI, fresh state/nonce and S256 PKCE", async () => {
  const attempt = await prepare(options);
  try {
    const url = new URL(attempt.authorizationUrl);
    assert.equal(
      url.origin + url.pathname,
      "https://auth.openai.com/api/accounts/authorize",
    );
    assert.equal(new URL(attempt.redirectUri).hostname, "127.0.0.1");
    assert.equal(new URL(attempt.redirectUri).pathname, "/auth/callback");
    assert.equal(url.searchParams.get("redirect_uri"), attempt.redirectUri);
    assert.equal(url.searchParams.get("client_id"), "dynamic_agent_client");
    assert.equal(url.searchParams.get("agent_name_hint"), "Orbyn");
    assert.equal(url.searchParams.get("ext_agent_host_id"), hostId);
    assert.equal(url.searchParams.get("resource"), "https://api.openai.com/v1");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    const response = await fetch(
      callback(attempt, {
        code: "private-code",
        client_id: "oaiapp_issued",
        scope: "untrusted.callback.scope",
      }),
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.ok(!(await response.text()).includes("private-code"));
    const value = await attempt.result;
    assert.equal(value.clientId, "oaiapp_issued");
    assert.equal(value.redirectUri, attempt.redirectUri);
    assert.equal(value.nonce, url.searchParams.get("nonce"));
    assert.equal(value.code, "private-code");
    assert.equal(value.scope, undefined);
    assert.equal(
      createHash("sha256").update(value.verifier).digest("base64url"),
      url.searchParams.get("code_challenge"),
    );
    assert.ok(value.verifier.length >= 43);
    await assert.rejects(
      fetch(
        callback(attempt, { code: "private-code", client_id: "oaiapp_issued" }),
      ),
    );
  } finally {
    attempt.cancel();
  }
});

test("invalid state, duplicates, paths, methods, Origin and Host cannot consume a valid attempt", async () => {
  const attempt = await prepare(options);
  try {
    const wrongState = callback(attempt, {
      code: "code",
      client_id: "oaiapp_issued",
      state: "wrong",
    });
    assert.equal((await fetch(wrongState)).status, 400);
    const duplicate = callback(attempt, {
      code: "code",
      client_id: "oaiapp_issued",
    });
    duplicate.searchParams.append(
      "state",
      duplicate.searchParams.get("state")!,
    );
    assert.equal((await fetch(duplicate)).status, 400);
    assert.equal(
      (await fetch(attempt.redirectUri.replace("/auth/callback", "/callback")))
        .status,
      404,
    );
    assert.equal(
      (await fetch(callback(attempt), { method: "POST" })).status,
      405,
    );
    assert.equal(
      (
        await fetch(callback(attempt), {
          headers: { Origin: "https://evil.invalid" },
        })
      ).status,
      403,
    );
    const rebinding = await new Promise<number>((resolve, reject) => {
      const req = request(
        callback(attempt),
        { headers: { Host: "evil.invalid" } },
        (res) => {
          res.resume();
          resolve(res.statusCode!);
        },
      );
      req.on("error", reject);
      req.end();
    });
    assert.equal(rebinding, 403);
    assert.equal(
      (
        await fetch(
          callback(attempt, { code: "code", client_id: "oaiapp_issued" }),
        )
      ).status,
      200,
    );
    assert.equal((await attempt.result).code, "code");
  } finally {
    attempt.cancel();
  }
});

test("returning registrations keep their issued ID and nonce; replacement IDs are rejected", async () => {
  for (const clientId of [undefined, "oaiapp_returning", "oaiapp_other"]) {
    const attempt = await prepare({
      ...options,
      clientId: "oaiapp_returning",
      nonce: "backend-nonce-1234567890",
    });
    try {
      const auth = new URL(attempt.authorizationUrl);
      assert.equal(auth.searchParams.get("agent_name_hint"), null);
      assert.equal(auth.searchParams.get("nonce"), "backend-nonce-1234567890");
      const fields: Record<string, string> = { code: "code" };
      if (clientId) fields.client_id = clientId;
      const res = await fetch(callback(attempt, fields));
      if (clientId === "oaiapp_other") {
        assert.equal(res.status, 400);
        await assert.rejects(attempt.result, status("AUTH_REGISTRATION"));
      } else {
        assert.equal(res.status, 200);
        assert.equal((await attempt.result).clientId, "oaiapp_returning");
      }
    } finally {
      attempt.cancel();
    }
  }
});

test("incomplete registration and validated provider denial stop without reflecting private details", async () => {
  for (const fields of [
    { code: "code" },
    { code: "code", client_id: "dynamic_agent_client" },
    { error: "access_denied", error_description: "private-provider-message" },
    { error: "private-provider-error" },
  ]) {
    const attempt = await prepare(options);
    try {
      const res = await fetch(
        callback(attempt, fields as Record<string, string>),
      );
      assert.equal(res.status, 400);
      assert.ok(!(await res.text()).includes("private-provider"));
      await assert.rejects(
        attempt.result,
        (e: any) => !e.message.includes("private-provider"),
      );
    } finally {
      attempt.cancel();
    }
  }
});

test("cancellation, expiry and invalid configuration never leave an active listener", async () => {
  const controller = new AbortController();
  const attempt = await prepare({ ...options, signal: controller.signal });
  controller.abort();
  await assert.rejects(attempt.result, status("AUTH_ABORTED"));
  await assert.rejects(fetch(attempt.redirectUri));
  const timed = await prepare({ ...options, timeoutMs: 10 });
  await assert.rejects(timed.result, status("AUTH_EXPIRED"));
  await assert.rejects(fetch(timed.redirectUri));
  for (const changed of [
    { clientId: "dynamic_agent_client" },
    { hostId: "" },
    { timeoutMs: 600001 },
    { nonce: "short" },
  ])
    await assert.rejects(
      prepare({ ...options, ...changed }),
      status("AUTH_INPUT"),
    );
  await assert.rejects(
    prepare({ ...options, signal: controller.signal }),
    status("AUTH_ABORTED"),
  );
});

test("separate attempts cannot exchange state or PKCE verifiers", async () => {
  const one = await prepare(options),
    two = await prepare(options);
  try {
    const a = new URL(one.authorizationUrl),
      b = new URL(two.authorizationUrl);
    assert.notEqual(a.searchParams.get("state"), b.searchParams.get("state"));
    assert.notEqual(a.searchParams.get("nonce"), b.searchParams.get("nonce"));
    assert.notEqual(
      a.searchParams.get("code_challenge"),
      b.searchParams.get("code_challenge"),
    );
    assert.equal(
      (
        await fetch(
          callback(one, {
            state: b.searchParams.get("state")!,
            code: "code",
            client_id: "oaiapp_issued",
          }),
        )
      ).status,
      400,
    );
  } finally {
    one.cancel();
    two.cancel();
  }
});

const { exchangeChatgptCode: exchange } = createRequire(import.meta.url)(
  "../../desktop/chatgpt-oauth.cjs",
);
const completed = {
  clientId: "oaiapp_issued",
  code: "private-code",
  verifier: "a".repeat(43),
  redirectUri: "http://127.0.0.1:45678/auth/callback",
};
const tokenResponse = {
  access_token: "private-access",
  id_token: "private-id",
  refresh_token: "private-refresh",
  token_type: "Bearer",
  expires_in: 3600,
  scope:
    "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
};

test("code exchange uses fixed OAuth endpoint, exact redirect, issued ID and no client secret", async () => {
  let sent: RequestInit | undefined;
  const value = await exchange(completed, {
    fetch: async (url: string, init: RequestInit) => {
      assert.equal(url, "https://auth.openai.com/api/accounts/oauth/token");
      sent = init;
      return Response.json({
        ...tokenResponse,
        private_metadata: "not-returned",
      });
    },
  });
  assert.equal(sent!.redirect, "error");
  assert.equal(sent!.credentials, "omit");
  assert.equal(sent!.cache, "no-store");
  const fields = sent!.body as URLSearchParams;
  assert.equal(fields.get("client_id"), completed.clientId);
  assert.equal(fields.get("redirect_uri"), completed.redirectUri);
  assert.equal(fields.get("code_verifier"), completed.verifier);
  assert.equal(fields.get("code"), completed.code);
  assert.equal(fields.get("resource"), "https://api.openai.com/v1");
  assert.equal(fields.get("client_secret"), null);
  assert.equal(value.sharingGranted, true);
  assert.equal(value.private_metadata, undefined);
  assert.equal(value.expiresAt - value.savedAt, 3600000);
});

test("callback scopes cannot authorize plan usage; token response decides the granted scope", async () => {
  const value = await exchange(
    { ...completed, scope: "chatgpt.tokens.use.direct" },
    {
      fetch: async () =>
        Response.json({ ...tokenResponse, scope: "openid email profile" }),
    },
  );
  assert.equal(value.sharingGranted, false);
  assert.deepEqual(value.scopes, ["openid", "email", "profile"]);
});

test("invalid grant, malformed responses, oversized bodies and external errors stay generic", async () => {
  for (const response of [
    Response.json(
      { error: "invalid_grant", error_description: "private-detail" },
      { status: 400 },
    ),
    new Response("private-html", { status: 503 }),
    Response.json({ ...tokenResponse, id_token: "" }),
    Response.json({ ...tokenResponse, token_type: "other" }),
    Response.json({ ...tokenResponse, expires_in: -1 }),
    new Response("x".repeat(262145)),
  ]) {
    await assert.rejects(
      exchange(completed, { fetch: async () => response }),
      (e: any) => !e.message.includes("private-"),
    );
  }
  await assert.rejects(
    exchange(completed, {
      fetch: async () =>
        Response.json({ error: "invalid_grant" }, { status: 400 }),
    }),
    status("AUTH_CODE_EXPIRED"),
  );
  await assert.rejects(
    exchange(completed, {
      fetch: async () => {
        throw Object.assign(new Error("private-provider-message"), {
          code: "AUTH_FORGED",
        });
      },
    }),
    (e: any) =>
      e.code === "AUTH_FAILED" && !e.message.includes("private-provider"),
  );
});

test("exchange rejects redirects and unregistered IDs before making a network request", async () => {
  let calls = 0;
  for (const change of [
    { clientId: "dynamic_agent_client" },
    { redirectUri: "http://localhost:45678/auth/callback" },
    { redirectUri: "https://evil.invalid/auth/callback" },
    { redirectUri: "http://127.0.0.1:45678/callback" },
    { redirectUri: "http://127.0.0.1:45678/auth/callback?extra=true" },
    { verifier: "short" },
  ])
    await assert.rejects(
      exchange(
        { ...completed, ...change },
        {
          fetch: async () => {
            calls++;
            return Response.json(tokenResponse);
          },
        },
      ),
      status("AUTH_INPUT"),
    );
  assert.equal(calls, 0);
});

test("exchange cancellation and deadlines fence a late provider response", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(
    exchange(completed, {
      signal: controller.signal,
      fetch: async () => {
        calls++;
        return Response.json(tokenResponse);
      },
    }),
    status("AUTH_ABORTED"),
  );
  assert.equal(calls, 0);
  await assert.rejects(
    exchange(completed, {
      timeoutMs: 5,
      fetch: async () => {
        await new Promise((r) => setTimeout(r, 10));
        return Response.json(tokenResponse);
      },
    }),
    status("AUTH_ABORTED"),
  );
});

test("desktop refresh recognizes terminal grant errors without confusing server outages", async () => {
  const { refreshChatgptTokens } = createRequire(import.meta.url)(
    "../../desktop/chatgpt-oauth.cjs",
  );
  const saved = {
    clientId: "oaiapp_fixture",
    idToken: "private-id",
    refreshToken: "private-refresh",
    scopes: ["openid"],
  };
  for (const code of [
    "invalid_grant",
    "invalid_refresh_token",
    "token_expired",
    "refresh_token_expired",
    "refresh_token_invalidated",
    "refresh_token_reused",
  ])
    for (const error of [code, { code, message: "private-refresh" }])
      await assert.rejects(
        refreshChatgptTokens(saved, {
          fetch: async () => Response.json({ error }, { status: 400 }),
        }),
        (e: any) =>
          e.code === "AUTH_REFRESH_EXPIRED" && !e.message.includes("private-"),
      );
  for (const [http, code] of [
    [503, "invalid_grant"],
    [429, "refresh_token_reused"],
    [400, "invalid_client"],
  ])
    await assert.rejects(
      refreshChatgptTokens(saved, {
        fetch: async () =>
          Response.json({ error: code }, { status: http as number }),
      }),
      status("AUTH_FAILED"),
    );
});
