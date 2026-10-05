import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fail } from "@orbyn/core";
import { pool } from "../src/db/pool.js";
import { digest } from "../src/lib/auth.js";
import { createService } from "../src/services/http.js";
import { createTeamsChannelRoutes } from "../src/modules/agent-channels/teams-routes.js";
import * as actual from "../src/modules/agent-channels/teams-installations.js";

test("Teams HTTP boundary requires app sessions, strict input and bounded requests", async () => {
  const userId = randomUUID(),
    sessionId = randomUUID(),
    id = randomUUID();
  const user = {
    id: userId,
    role: "member",
    disabled: false,
    email_verified: true,
  };
  mock.method(pool, "query", async (sql: string, args: unknown[] = []) => {
    assert.ok(
      !sql.includes("idempotency_keys"),
      "OAuth installation must not replay cached response proofs",
    );
    if (sql.includes("JOIN sessions"))
      return {
        rows: args[0] === digest("expired") ? [] : [{ ...user }],
        rowCount: 1,
      };
    if (sql.includes("JOIN api_keys"))
      return { rows: [{ ...user }], rowCount: 1 };
    if (sql.includes("SELECT id FROM sessions"))
      return { rows: [{ id: sessionId }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const config = {
    clientId: randomUUID(),
    clientSecret: "synthetic-teams-client-secret",
    botAppId: randomUUID(),
    redirectUri: "https://orbyn.example/api/agent-channels/teams/callback",
  };
  let configured = true,
    rejected = false,
    captures = 0;
  const binding = (value: { userId: string; sessionId: string }) =>
    assert.deepEqual(value, { userId, sessionId });
  const connection = {
    id,
    display_name: "Fixture",
    tenant_id: randomUUID(),
    object_id: randomUUID(),
    dm_enabled: false,
    version: 1,
    state: "awaiting_conversation" as const,
  };
  const deps: typeof actual = {
    ...actual,
    readTeamsChannel: async (b) => {
      binding(b);
      return connection;
    },
    beginTeamsInstallation: async (b, c) => {
      binding(b);
      assert.deepEqual(c, config);
      return {
        id,
        authorization_url:
          "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?state=fixture",
        expires_at: new Date().toISOString(),
      };
    },
    readTeamsInstallationRequest: async (b, requestId) => {
      binding(b);
      assert.equal(requestId, id);
      if (rejected) fail(404, "Unavailable");
      return {
        id,
        state: "pending",
        expires_at: new Date().toISOString(),
        identity: null,
      };
    },
    confirmTeamsInstallation: async (b) => {
      binding(b);
      return {
        id,
        version: 1,
        link_token: "x".repeat(43),
        link_expires_at: new Date().toISOString(),
        dm_enabled: false as const,
      };
    },
    restartTeamsConversationLink: async (b) => {
      binding(b);
      return {
        id,
        version: 2,
        link_token: "x".repeat(43),
        link_expires_at: new Date().toISOString(),
        dm_enabled: false as const,
      };
    },
    setTeamsDmPermission: async (b) => {
      binding(b);
      return connection;
    },
    disconnectTeamsInstallation: async (b) => {
      binding(b);
      return { ...connection, state: "disconnected" as const, version: 2 };
    },
    captureTeamsInstallation: async (c, input) => {
      captures++;
      assert.deepEqual(c, config);
      assert.equal(input.state, "x".repeat(43));
      if (rejected)
        fail(503, "Teams connection failed. Start a new connection request.");
      return { captured: !input.error };
    },
  };
  const app = await createService("api", [
    createTeamsChannelRoutes(deps, () => (configured ? config : undefined)),
  ]);
  let address = 1;
  const call = (
    method: "GET" | "POST" | "PUT",
    url: string,
    token?: string,
    payload?: object,
    remoteAddress = `10.75.0.${address++}`,
  ) =>
    app.inject({
      method,
      url,
      remoteAddress,
      headers: token
        ? {
            authorization: `Bearer ${token}`,
            "idempotency-key": "must-not-replay-oauth",
          }
        : {},
      ...(payload ? { payload } : {}),
    });
  const confirm = {
    tenant_id: connection.tenant_id,
    object_id: connection.object_id,
    expected_version: 0,
  };
  try {
    for (const [method, url, payload] of [
      ["GET", "/agent-channels/teams", undefined],
      ["GET", `/agent-channels/teams/installations/${id}`, undefined],
      ["POST", "/agent-channels/teams/installations", {}],
      ["POST", `/agent-channels/teams/installations/${id}/confirm`, confirm],
      ["POST", "/agent-channels/teams/disconnect", { expected_version: 1 }],
      [
        "POST",
        "/agent-channels/teams/conversation-link",
        { expected_version: 1 },
      ],
      [
        "PUT",
        "/agent-channels/teams/permission",
        { expected_version: 1, dm_enabled: false },
      ],
    ] as const) {
      assert.equal(
        (await call(method, url, undefined, payload)).statusCode,
        401,
      );
      assert.equal(
        (await call(method, url, "ok_fixture", payload)).statusCode,
        403,
      );
      assert.equal(
        (await call(method, url, "expired", payload)).statusCode,
        401,
      );
      const ok = await call(method, url, "session", payload);
      assert.equal(ok.statusCode, 200, ok.body);
      assert.equal(ok.headers["cache-control"], "no-store");
      const invalid = await call(
        method,
        method === "GET" ? `${url}?forbidden=1` : url,
        "session",
        method === "GET" ? undefined : { forbidden: true },
      );
      assert.equal(invalid.statusCode, 422, invalid.body);
      if (method !== "GET") {
        const malformed = await app.inject({
          method,
          url,
          remoteAddress: `10.76.0.${address++}`,
          headers: {
            authorization: "Bearer session",
            "content-type": "application/json",
          },
          payload: "{",
        });
        assert.equal(malformed.statusCode, 400);
      }
      let limited = false;
      for (let i = 0; i < 12; i++)
        if (
          (await call(method, url, "session", payload, "10.77.0.1"))
            .statusCode === 429
        ) {
          limited = true;
          break;
        }
      assert.ok(limited, url);
    }
    rejected = true;
    assert.equal(
      (
        await call(
          "GET",
          `/agent-channels/teams/installations/${id}`,
          "session",
        )
      ).statusCode,
      404,
    );
    const callback = `/agent-channels/teams/callback?state=${"x".repeat(43)}&code=synthetic-code`;
    const failed = await call("GET", callback);
    assert.equal(failed.statusCode, 503);
    assert.doesNotMatch(failed.body, /synthetic-code/);
    rejected = false;
    const result = await call("GET", callback);
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.headers["referrer-policy"], "no-referrer");
    assert.equal(result.headers["cache-control"], "no-store");
    assert.match(
      String(result.headers["content-security-policy"]),
      /default-src 'none'/,
    );
    assert.match(result.body, /Review your Microsoft account/);
    assert.doesNotMatch(
      result.body,
      /synthetic-code|xxxxxxxx|<script|access_token/,
    );
    const before = captures;
    assert.equal(
      (await call("GET", `${callback}&redirect_uri=https://attacker.example`))
        .statusCode,
      422,
    );
    assert.equal(
      (await call("GET", `${callback}&error=denied`)).statusCode,
      422,
    );
    assert.equal(captures, before);
    assert.match(
      (
        await call(
          "GET",
          `/agent-channels/teams/callback?state=${"x".repeat(43)}&error=denied`,
        )
      ).body,
      /cancelled/,
    );
    configured = false;
    const status = await call("GET", "/agent-channels/teams", "session");
    assert.equal(status.json().configured, false);
    assert.equal(
      (await call("POST", "/agent-channels/teams/installations", "session", {}))
        .statusCode,
      503,
    );
    assert.equal(
      (
        await call("POST", "/agent-channels/teams/disconnect", "session", {
          expected_version: 1,
        })
      ).statusCode,
      200,
    );
  } finally {
    await app.close();
    mock.restoreAll();
  }
});
