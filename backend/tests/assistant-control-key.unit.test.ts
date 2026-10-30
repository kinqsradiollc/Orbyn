import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";

// Refuse real database access and do not inherit a user's database or rollout.
process.env.DATABASE_URL =
  "postgres://fixture:fixture@127.0.0.1:1/assistant_control_test";
process.env.DATABASE_READ_URL = "";
process.env.ASSISTANT_CONVERSATION_ENABLED = "false";
const { pool } = await import("../src/db/pool.js");
const { KEY_BLOCKED_MESSAGE } = await import("../src/lib/auth.js");
const { assistantRoutineRoutes } =
  await import("../src/modules/assistant-workspace/routine-routes.js");

const userId = randomUUID();
const id = randomUUID();
const user = {
  id: userId,
  name: "Fixture",
  role: "member",
  disabled: false,
  email_verified: true,
};
const input = {
  instruction: "Review my priorities",
  rrule: "FREQ=DAILY",
  timezone: "UTC",
  next_run_at: new Date(Date.now() + 3_600_000).toISOString(),
  paused: false,
};

test("personal keys cannot change approvals or create, edit, resume, pause or delete assistant routines", async (t) => {
  let lookups = 0;
  t.mock.method(pool, "query", async (sql: string) => {
    if (sql.includes("JOIN api_keys")) {
      lookups++;
      return { rows: [{ ...user }] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  t.mock.method(pool, "connect", async () => {
    throw new Error("A key must not reach a write transaction");
  });
  const app = Fastify();
  await app.register(assistantRoutineRoutes);
  try {
    const requests = [
      {
        method: "PUT" as const,
        url: "/me/assistant/approval-scopes",
        payload: { tasks: "always", pages: "always" },
      },
      { method: "POST" as const, url: "/me/agent-routines", payload: input },
      ...[
        { instruction: "Different work" },
        { paused: false },
        { paused: true },
        { next_run_at: input.next_run_at },
      ].map((payload) => ({
        method: "PUT" as const,
        url: `/me/agent-routines/${id}`,
        payload,
      })),
      { method: "DELETE" as const, url: `/me/agent-routines/${id}` },
      {
        method: "POST" as const,
        url: "/me/agent-routines?source=fixture",
        payload: input,
      },
    ];
    for (const request of requests) {
      const response = await app.inject({
        ...request,
        headers: { authorization: "Bearer ok_fixture-only" },
      });
      assert.equal(response.statusCode, 403, response.body);
      assert.equal(response.json().message, KEY_BLOCKED_MESSAGE);
    }
    assert.equal(lookups, requests.length);
  } finally {
    await app.close();
  }
});

test("a signed-in person can create, edit, resume and delete routines; keys can still read them", async (t) => {
  let routine = {
    id,
    user_id: userId,
    ...input,
    next_run_at: new Date(input.next_run_at),
    created_at: new Date(),
    updated_at: new Date(),
    revision: 1,
  };
  let removed = false;
  const query = async (sql: string, values: unknown[] = []) => {
    if (sql.includes("JOIN sessions") || sql.includes("JOIN api_keys"))
      return { rows: [{ ...user }] };
    if (sql.startsWith("UPDATE sessions") || sql.startsWith("UPDATE api_keys"))
      return { rows: [] };
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
    if (sql.includes("INSERT INTO agent_routines")) {
      assert.deepEqual(values, [
        userId,
        input.instruction,
        input.rrule,
        input.timezone,
        input.next_run_at,
        input.paused,
      ]);
      return { rows: [{ id }] };
    }
    if (sql.includes("UPDATE agent_routines SET")) {
      routine = {
        ...routine,
        instruction: values[2] as string,
        paused: values[6] as boolean,
      };
      return { rows: [{ id }] };
    }
    if (sql.includes("SELECT") && sql.includes("FROM agent_routines"))
      return { rows: removed ? [] : [{ ...routine }] };
    if (sql.startsWith("DELETE FROM agent_routines")) {
      removed = true;
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("UPDATE agent_grants SET approval_scopes = coalesce"))
      return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  };
  t.mock.method(pool, "query", query);
  t.mock.method(pool, "connect", async () => ({ query, release() {} }));
  const app = Fastify();
  await app.register(assistantRoutineRoutes);
  const headers = { authorization: "Bearer fixture-session" };
  try {
    const created = await app.inject({
      method: "POST",
      url: "/me/agent-routines",
      headers,
      payload: input,
    });
    assert.equal(created.statusCode, 201, created.body);
    for (const payload of [
      { instruction: "Changed instruction", paused: true },
      { paused: false },
    ]) {
      const changed = await app.inject({
        method: "PUT",
        url: `/me/agent-routines/${id}`,
        headers,
        payload,
      });
      assert.equal(changed.statusCode, 200, changed.body);
      assert.equal(changed.json().paused, payload.paused);
    }
    const read = await app.inject({
      method: "GET",
      url: "/me/agent-routines",
      headers: { authorization: "Bearer ok_fixture-only" },
    });
    assert.equal(read.statusCode, 200, read.body);
    assert.equal(read.json()[0].instruction, "Changed instruction");
    const deleted = await app.inject({
      method: "DELETE",
      url: `/me/agent-routines/${id}`,
      headers,
    });
    assert.equal(deleted.statusCode, 200, deleted.body);
    assert.equal(removed, true);
  } finally {
    await app.close();
  }
});

test("a signed-in person can save approvals and keys can still read the saved settings", async (t) => {
  let scopes: unknown = {};
  t.mock.method(pool, "query", async (sql: string, values: unknown[] = []) => {
    if (sql.includes("JOIN sessions") || sql.includes("JOIN api_keys"))
      return { rows: [{ ...user }] };
    if (sql.startsWith("UPDATE sessions") || sql.startsWith("UPDATE api_keys"))
      return { rows: [] };
    if (sql.includes("SELECT name FROM agent_settings")) return { rows: [] };
    if (sql.includes("INSERT INTO agent_grants"))
      return {
        rows: [
          {
            id: "fixture-grant",
            toolsets: [],
            personal: true,
            access: "write",
            team_ids: null,
            trust: "full",
          },
        ],
      };
    if (sql.includes("FROM team_members")) return { rows: [] };
    if (sql.startsWith("UPDATE agent_grants SET approval_scopes = $3")) {
      assert.deepEqual(values.slice(0, 2), ["fixture-grant", userId]);
      scopes = JSON.parse(values[2] as string);
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("SELECT approval_scopes"))
      return { rows: [{ approval_scopes: scopes }] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  t.mock.method(pool, "connect", async () => {
    throw new Error("No database connections");
  });
  const app = Fastify();
  await app.register(assistantRoutineRoutes);
  try {
    const saved = await app.inject({
      method: "PUT",
      url: "/me/assistant/approval-scopes",
      headers: { authorization: "Bearer fixture-session" },
      payload: { tasks: "always", pages: { scope: "routine", id } },
    });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.deepEqual(scopes, {
      tasks: "always",
      pages: { scope: "routine", id },
    });
    const read = await app.inject({
      method: "GET",
      url: "/me/assistant/approval-scopes",
      headers: { authorization: "Bearer ok_fixture-only" },
    });
    assert.equal(read.statusCode, 200, read.body);
    assert.deepEqual(read.json(), scopes);
  } finally {
    await app.close();
  }
});
