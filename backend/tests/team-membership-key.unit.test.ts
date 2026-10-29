import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";

// No setup.js, real database or inherited database configuration is used.
// Every query is stubbed; attempting to acquire a connection fails closed.
process.env.DATABASE_URL =
  "postgres://fixture:fixture@127.0.0.1:1/membership_test";
process.env.DATABASE_READ_URL = "";
const { pool } = await import("../src/db/pool.js");
const { authenticate, keyBlockedRoute, KEY_BLOCKED_MESSAGE } =
  await import("../src/lib/auth.js");
const { teamRoutes } = await import("../src/modules/teams/routes.js");

const ownerId = randomUUID();
const teamId = randomUUID();
const teammateId = randomUUID();
const user = {
  id: ownerId,
  role: "member",
  email_verified: true,
  disabled: false,
};

test("personal keys cannot mutate membership through the registered team routes", async (t) => {
  const queries: string[] = [];
  t.mock.method(pool, "query", async (sql: string) => {
    queries.push(sql);
    if (sql.includes("JOIN api_keys")) return { rows: [{ ...user }] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  t.mock.method(pool, "connect", async () => {
    throw new Error("Membership transaction must not be reached by a key");
  });
  const app = Fastify();
  await app.register(teamRoutes);
  try {
    const path = `/teams/${teamId}/members`;
    const requests = [
      ...["viewer", "member", "admin", "owner"].flatMap((role) => [
        {
          method: "POST" as const,
          url: path,
          payload: { email: "fixture@example.test", role },
        },
        {
          method: "PUT" as const,
          url: `${path}/${teammateId}`,
          payload: { role },
        },
      ]),
      {
        method: "PUT" as const,
        url: `${path}/${ownerId}`,
        payload: { role: "viewer" },
      },
      { method: "DELETE" as const, url: `${path}/${ownerId}` },
      { method: "DELETE" as const, url: `${path}/${teammateId}` },
      // Query strings and encoded concrete ids still resolve to the same route pattern.
      {
        method: "POST" as const,
        url: `${path}?source=fixture`,
        payload: { email: "fixture@example.test", role: "owner" },
      },
      {
        method: "DELETE" as const,
        url: `${path}/%${ownerId.charCodeAt(0).toString(16)}${ownerId.slice(1)}`,
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
    assert.equal(queries.length, requests.length);
    assert.ok(queries.every((sql) => sql.includes("JOIN api_keys")));
  } finally {
    await app.close();
  }
});

test("sessions can still change member roles through the registered route", async (t) => {
  let updated = false;
  const query = async (sql: string, values?: unknown[]) => {
    if (sql.includes("JOIN sessions")) return { rows: [{ ...user }] };
    if (sql.startsWith("UPDATE sessions")) return { rows: [] };
    if (sql === "SELECT name FROM teams WHERE id=$1")
      return { rows: [{ name: "Fixture" }] };
    if (sql === "SELECT role FROM team_members WHERE team_id=$1 AND user_id=$2")
      return { rows: [{ role: "owner" }] };
    if (sql.includes("FOR UPDATE OF m"))
      return {
        rows: [
          {
            user_id: teammateId,
            role: "member",
            email: "fixture@example.test",
          },
        ],
      };
    if (sql.startsWith("UPDATE team_members")) {
      assert.deepEqual(values, ["owner", teamId, teammateId]);
      updated = true;
      return { rows: [], rowCount: 1 };
    }
    if (
      ["BEGIN", "COMMIT", "ROLLBACK"].includes(sql) ||
      sql.includes("pg_notify") ||
      sql.startsWith("INSERT INTO audit_log")
    )
      return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  };
  t.mock.method(pool, "query", query);
  t.mock.method(pool, "connect", async () => ({ query, release() {} }));
  const app = Fastify();
  await app.register(teamRoutes);
  try {
    const response = await app.inject({
      method: "PUT",
      url: `/teams/${teamId}/members/${teammateId}`,
      headers: { authorization: "Bearer fixture-session" },
      payload: { role: "owner" },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().role, "owner");
    assert.equal(updated, true);
  } finally {
    await app.close();
  }
});

test("ordinary personal-key routes remain available to the authentication boundary", async (t) => {
  t.mock.method(pool, "query", async (sql: string) => {
    if (sql.includes("JOIN api_keys")) return { rows: [{ ...user }] };
    if (sql.startsWith("UPDATE api_keys")) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  t.mock.method(pool, "connect", async () => {
    throw new Error("No database connections");
  });
  const app = Fastify();
  app.get("/teams/:id", async (r) => ({ id: (await authenticate(r)).id }));
  try {
    const response = await app.inject({
      method: "GET",
      url: `/teams/${teamId}`,
      headers: { authorization: "Bearer ok_fixture-only" },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().id, ownerId);
    for (const [method, route] of [
      ["GET", "/teams"],
      ["GET", "/teams/:id"],
      ["POST", "/teams"],
      ["PUT", "/teams/:id"],
      ["POST", "/items"],
      ["PUT", "/items/:id"],
      ["PUT", "/docs/:id"],
      ["GET", "/caldav/calendars/:userId/default"],
    ])
      assert.equal(keyBlockedRoute(method, route), false, `${method} ${route}`);
  } finally {
    await app.close();
  }
});
