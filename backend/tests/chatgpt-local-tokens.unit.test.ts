import { test } from "node:test";
import assert from "node:assert/strict";
import {
  exchangeChatgptLocalCode,
  refreshChatgptLocalGrant,
  parseChatgptLocalGrant,
  ChatgptLocalTokenError,
  readChatgptLocalModels,
} from "@orbyn/api-client";

const input = {
  clientId: "oaiapp_fixture",
  code: "fixture-code",
  verifier: "v".repeat(43),
  redirectUri: "http://127.0.0.1:1455/auth/callback",
};
const tokens = {
  access_token: "fixture-access",
  refresh_token: "fixture-refresh",
  id_token: "fixture-identity",
  token_type: "Bearer",
  expires_in: 3600,
  scope:
    "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
};
const now = () => 1000000;
const fetchTokens = (overrides = {}) =>
  (async () => Response.json({ ...tokens, ...overrides })) as typeof fetch;
const checkError = (code: string) => (error: unknown) =>
  error instanceof ChatgptLocalTokenError &&
  error.code === code &&
  !error.message.includes("fixture-access");

test("local exchange sends the issued registration, exact URI and PKCE without an app key", async () => {
  let called = false;
  const fetcher = (async (url, options) => {
    called = true;
    assert.equal(
      String(url),
      "https://auth.openai.com/api/accounts/oauth/token",
    );
    assert.equal(options!.method, "POST");
    assert.equal(options!.redirect, "error");
    assert.equal(options!.credentials, "omit");
    assert.equal(options!.cache, "no-store");
    assert.deepEqual(Object.fromEntries(options!.body as URLSearchParams), {
      grant_type: "authorization_code",
      client_id: input.clientId,
      code: input.code,
      code_verifier: input.verifier,
      redirect_uri: input.redirectUri,
      resource: "https://api.openai.com/v1",
    });
    assert.equal(new Headers(options!.headers).has("Authorization"), false);
    return Response.json(tokens);
  }) as typeof fetch;
  const result = await exchangeChatgptLocalCode(input, { fetch: fetcher, now });
  assert.ok(called);
  assert.equal(result.sharingGranted, true);
  assert.equal(result.expiresAt, 4600000);
});
test("callback and ID-token presence cannot invent plan permissions", async () => {
  for (const scope of [
    "openid",
    "resource.invoke",
    "chatgpt.tokens.use.direct",
    "",
  ]) {
    const result = await exchangeChatgptLocalCode(input, {
      fetch: fetchTokens({ scope }),
      now,
    });
    assert.equal(result.sharingGranted, false);
  }
});
test("refresh rotates credentials together while retaining omitted identity/scopes/refresh token", async () => {
  const first = await exchangeChatgptLocalCode(input, {
    fetch: fetchTokens(),
    now,
  });
  const body = {
    access_token: "rotated-access",
    token_type: "Bearer",
    expires_in: 600,
  };
  const updated = await refreshChatgptLocalGrant(first, {
    fetch: (async (_url, options) => {
      assert.deepEqual(Object.fromEntries(options!.body as URLSearchParams), {
        grant_type: "refresh_token",
        client_id: input.clientId,
        refresh_token: tokens.refresh_token,
        resource: "https://api.openai.com/v1",
      });
      return Response.json(body);
    }) as typeof fetch,
    now: () => 2000000,
  });
  assert.equal(updated.accessToken, "rotated-access");
  assert.equal(updated.refreshToken, first.refreshToken);
  assert.equal(updated.idToken, first.idToken);
  assert.deepEqual(updated.scopes, first.scopes);
  assert.equal(updated.expiresAt, 2600000);
});
test("scope reduction disables plan usage and escalation is rejected", async () => {
  const first = await exchangeChatgptLocalCode(input, {
    fetch: fetchTokens(),
    now,
  });
  assert.equal(
    (
      await refreshChatgptLocalGrant(first, {
        fetch: fetchTokens({ scope: "openid" }),
        now,
      })
    ).sharingGranted,
    false,
  );
  await assert.rejects(
    refreshChatgptLocalGrant(first, {
      fetch: fetchTokens({ scope: tokens.scope + " new.permission" }),
      now,
    }),
    checkError("invalid"),
  );
});
test("malformed token replies are rejected and provider payloads never enter errors", async () => {
  for (const override of [
    { access_token: "" },
    { token_type: "Basic" },
    { expires_in: 0 },
    { expires_in: 1.5 },
    { id_token: undefined },
    { scope: undefined },
    { refresh_token: "bad\nsecret" },
    { scope: "openid\nsecret" },
    { scope: "invalid/scope" },
  ])
    await assert.rejects(
      exchangeChatgptLocalCode(input, { fetch: fetchTokens(override), now }),
      checkError("unavailable"),
    );
  for (const status of [400, 401, 403, 429, 500])
    await assert.rejects(
      exchangeChatgptLocalCode(input, {
        fetch: (async () =>
          Response.json(
            { error: "provider-detail-fixture-access" },
            { status },
          )) as typeof fetch,
      }),
      checkError("unavailable"),
    );
});
test("expired code/refresh grants are actionable; unrenewable credentials cannot refresh", async () => {
  await assert.rejects(
    exchangeChatgptLocalCode(input, {
      fetch: (async () =>
        Response.json(
          { error: "invalid_grant" },
          { status: 400 },
        )) as typeof fetch,
    }),
    checkError("expired"),
  );
  const first = await exchangeChatgptLocalCode(input, {
    fetch: fetchTokens({ refresh_token: undefined }),
    now,
  });
  await assert.rejects(refreshChatgptLocalGrant(first), checkError("expired"));
});
test("dynamic entrypoint and foreign callbacks are refused before any network work", async () => {
  let count = 0;
  const fetcher = (async () => {
    count++;
    return Response.json(tokens);
  }) as typeof fetch;
  for (const change of [
    { clientId: "dynamic_agent_client" },
    { redirectUri: "https://orbyn.dev/callback" },
    { verifier: "short" },
    { code: "bad code" },
  ])
    await assert.rejects(
      exchangeChatgptLocalCode({ ...input, ...change }, { fetch: fetcher }),
    );
  assert.equal(count, 0);
});
test("oversized response is cancelled instead of parsing provider secrets", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(262145));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    exchangeChatgptLocalCode(input, {
      fetch: (async () => new Response(body)) as typeof fetch,
    }),
    checkError("unavailable"),
  );
  assert.equal(cancelled, true);
});
test("abort and deadline close a stalled response body", async () => {
  for (const explicit of [true, false]) {
    let cancelled = false;
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const promise = exchangeChatgptLocalCode(input, {
      fetch: (async () => new Response(body)) as typeof fetch,
      signal: controller.signal,
      timeoutMs: explicit ? 1000 : 10,
    });
    if (explicit) setTimeout(() => controller.abort(), 10);
    await assert.rejects(promise, checkError("cancelled"));
    assert.equal(cancelled, true);
  }
});
test("persisted grant parsing rejects false plan claims, stale timestamps and extra credentials", async () => {
  const grant = await exchangeChatgptLocalCode(input, {
    fetch: fetchTokens(),
    now,
  });
  for (const change of [
    { sharingGranted: false },
    { expiresAt: grant.savedAt },
    { clientId: "dynamic_agent_client" },
    { apiKey: "forbidden" },
  ])
    assert.throws(() => parseChatgptLocalGrant({ ...grant, ...change }));
});

test("deadline rejects even an uncooperative fetch and closes a late response", async () => {
  let resolve!: (response: Response) => void;
  let cancelled = false;
  const promise = exchangeChatgptLocalCode(input, {
    timeoutMs: 10,
    fetch: (() =>
      new Promise<Response>((yes) => {
        resolve = yes;
      })) as typeof fetch,
  });
  await assert.rejects(promise, checkError("cancelled"));
  resolve(
    new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
    ),
  );
  await new Promise<void>((yes) => setImmediate(yes));
  assert.equal(cancelled, true);
});

test("local model discovery uses only the grant token and preserves visible catalog choices", async () => {
  const grant = await exchangeChatgptLocalCode(input, {
    fetch: fetchTokens(),
    now,
  });
  const models = await readChatgptLocalModels(grant, {
    now,
    fetch: (async (url, init) => {
      assert.equal(String(url), "https://api.openai.com/v1/models");
      assert.equal(init!.method, "GET");
      assert.equal(init!.body, undefined);
      assert.equal(init!.redirect, "error");
      assert.equal(init!.cache, "no-store");
      assert.equal(init!.credentials, "omit");
      assert.equal(
        new Headers(init!.headers).get("Authorization"),
        "Bearer fixture-access",
      );
      return Response.json({
        models: [
          { slug: "available", display_name: "Available", visibility: "list" },
          { slug: "hidden", display_name: "Hidden", visibility: "hidden" },
        ],
      });
    }) as typeof fetch,
  });
  assert.deepEqual(models, [{ slug: "available", display_name: "Available" }]);
});
test("local catalog rejects expired or ungranted credentials before any request", async () => {
  const grant = await exchangeChatgptLocalCode(input, {
    fetch: fetchTokens(),
    now,
  });
  let requests = 0;
  const fetcher = (async () => {
    requests++;
    return Response.json({ models: [] });
  }) as typeof fetch;
  await assert.rejects(
    readChatgptLocalModels(grant, {
      now: () => grant.expiresAt,
      fetch: fetcher,
    }),
    checkError("expired"),
  );
  await assert.rejects(
    readChatgptLocalModels(
      { ...grant, scopes: ["openid"], sharingGranted: false },
      { now, fetch: fetcher },
    ),
    checkError("unavailable"),
  );
  assert.equal(requests, 0);
});
test("local model discovery sanitizes malformed and denied provider replies", async () => {
  const grant = await exchangeChatgptLocalCode(input, {
    fetch: fetchTokens(),
    now,
  });
  for (const response of [
    Response.json({ error: { message: "fixture-access" } }, { status: 403 }),
    Response.json({ error: "fixture-access" }, { status: 429 }),
    Response.json({ data: [{ id: "not-a-plan-catalog" }] }),
    Response.json({ models: [{ slug: "bad", visibility: "list" }] }),
    new Response("fixture-access"),
  ])
    await assert.rejects(
      readChatgptLocalModels(grant, {
        now,
        fetch: (async () => response) as typeof fetch,
      }),
      checkError("unavailable"),
    );
  await assert.rejects(
    readChatgptLocalModels(grant, {
      now,
      fetch: (async () => Response.json({}, { status: 401 })) as typeof fetch,
    }),
    checkError("expired"),
  );
});
test("local model request deadline cancels a transport that ignores abort", async () => {
  const grant = await exchangeChatgptLocalCode(input, {
    fetch: fetchTokens(),
    now,
  });
  await assert.rejects(
    readChatgptLocalModels(grant, {
      now,
      timeoutMs: 5,
      fetch: (() => new Promise(() => {})) as typeof fetch,
    }),
    checkError("cancelled"),
  );
});
test("local catalog is discarded when credentials expire during its response", async () => {
  const grant = await exchangeChatgptLocalCode(input, {
    fetch: fetchTokens(),
    now,
  });
  let time = now();
  await assert.rejects(
    readChatgptLocalModels(grant, {
      now: () => time,
      fetch: (async () => {
        time = grant.expiresAt;
        return Response.json({ models: [] });
      }) as typeof fetch,
    }),
    checkError("expired"),
  );
});

for (const code of [
  "invalid_grant",
  "invalid_refresh_token",
  "token_expired",
  "refresh_token_expired",
  "refresh_token_invalidated",
  "refresh_token_reused",
]) {
  test(`confirmed ${code} rejects only a refresh grant as unusable`, async () => {
    const grant = await exchangeChatgptLocalCode(input, {
      fetch: fetchTokens(),
      now,
    });
    for (const error of [code, { code, message: "fixture-access" }])
      await assert.rejects(
        refreshChatgptLocalGrant(grant, {
          now,
          fetch: (async () =>
            Response.json({ error }, { status: 400 })) as typeof fetch,
        }),
        checkError("invalid_refresh"),
      );
    await assert.rejects(
      exchangeChatgptLocalCode(input, {
        now,
        fetch: (async () =>
          Response.json({ error: code }, { status: 400 })) as typeof fetch,
      }),
      checkError(code === "invalid_grant" ? "expired" : "unavailable"),
    );
  });
}
test("refresh infrastructure errors and invalid-client failures do not mark a grant unusable", async () => {
  const grant = await exchangeChatgptLocalCode(input, {
    fetch: fetchTokens(),
    now,
  });
  for (const [status, code] of [
    [503, "invalid_grant"],
    [429, "refresh_token_reused"],
    [400, "invalid_client"],
    [401, "unknown_error"],
  ] as const)
    await assert.rejects(
      refreshChatgptLocalGrant(grant, {
        now,
        fetch: (async () =>
          Response.json({ error: code }, { status })) as typeof fetch,
      }),
      checkError("unavailable"),
    );
});
