import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
// This suite requires an isolated PostgreSQL database, never a production database.
if (!process.env.DATABASE_URL?.includes("orbyn_test"))
  throw new Error("Set DATABASE_URL to an isolated database named orbyn_test");
let providerResponse: unknown = {
  summary: "Your week looks clear.",
  actions: [],
};
let providerStatus = 200;
const provider = createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    res.writeHead(providerStatus, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(providerResponse) } }],
      }),
    );
  });
});
await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
process.env.AI_BASE_URL = `http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`;
process.env.AI_MODEL = "test-provider";
process.env.SMTP_HOST = "";
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { enqueue } = await import("../src/worker/scheduler.js");
const app = await buildApp();
let alice = "";
let bob = "";
let aliceId = "";
let bobId = "";
const headers = (token: string) => ({ authorization: `Bearer ${token}` });
const payload = (title = "A plan") => ({
  title,
  notes: "",
  kind: "task",
  status: "todo",
  priority: "medium",
  due_at: null,
  end_at: null,
  reminder_minutes: 30,
});
const clean = (i: Record<string, unknown>) => ({
  title: i.title,
  notes: i.notes,
  kind: i.kind,
  status: i.status,
  priority: i.priority,
  due_at: i.due_at,
  end_at: i.end_at,
  reminder_minutes: i.reminder_minutes,
  version: i.version,
});
before(async () => {
  await migrate();
  for (const name of ["alice", "bob"]) {
    const r = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: `${name}-${randomUUID()}@example.com`,
        password: "a-long-test-password",
        name,
      },
    });
    assert.equal(r.statusCode, 201);
    const u = r.json();
    if (name === "alice") {
      alice = u.token;
      aliceId = u.user.id;
    } else {
      bob = u.token;
      bobId = u.user.id;
    }
  }
});
after(async () => {
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
    [aliceId, bobId],
  ]);
  await app.close();
  await pool.end();
  provider.close();
});
test("authentication rejects missing and revoked tokens", async () => {
  assert.equal((await app.inject({ url: "/items" })).statusCode, 401);
  const r = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email: "nobody@example.com", password: "invalid-password" },
  });
  assert.equal(r.statusCode, 401);
});
test("CRUD is tenant scoped and stale writes conflict", async () => {
  const created = await app.inject({
    method: "POST",
    url: "/items",
    headers: headers(alice),
    payload: payload(),
  });
  assert.equal(created.statusCode, 201);
  const i = created.json();
  const list = await app.inject({ url: "/items", headers: headers(bob) });
  assert.equal(list.json().length, 0);
  assert.equal(
    (
      await app.inject({
        method: "PUT",
        url: `/items/${i.id}`,
        headers: headers(bob),
        payload: { ...clean(i), title: "stolen" },
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        method: "DELETE",
        url: `/items/${i.id}?version=1`,
        headers: headers(bob),
      })
    ).statusCode,
    404,
  );
  const writes = await Promise.all(
    ["first", "second"].map((title) =>
      app.inject({
        method: "PUT",
        url: `/items/${i.id}`,
        headers: headers(alice),
        payload: { ...clean(i), title },
      }),
    ),
  );
  assert.deepEqual(writes.map((r) => r.statusCode).sort(), [200, 409]);
  assert.equal(
    (
      await app.inject({
        method: "DELETE",
        url: `/items/${i.id}?version=2`,
        headers: headers(alice),
      })
    ).statusCode,
    204,
  );
});
test("validates dates, ownership fields, event starts, and pagination", async () => {
  for (const raw of [
    { ...payload(), due_at: "2026-01-01T12:00:00" },
    { ...payload(), kind: "event" },
    { ...payload(), user_id: bobId },
    {
      ...payload(),
      due_at: "2026-01-02T12:00:00Z",
      end_at: "2026-01-01T12:00:00Z",
    },
    { ...payload(), reminder_minutes: -1 },
  ])
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/items",
          headers: headers(alice),
          payload: raw,
        })
      ).statusCode,
      422,
    );
  assert.equal(
    (await app.inject({ url: "/items?limit=501", headers: headers(alice) }))
      .statusCode,
    422,
  );
});
test("AI summaries do not mutate and proposals apply exactly once", async () => {
  const summary = await app.inject({
    method: "POST",
    url: "/ai/chat",
    headers: headers(alice),
    payload: { message: "Summarize", timezone: "Australia/Melbourne" },
  });
  assert.equal(summary.statusCode, 200);
  assert.deepEqual(summary.json().actions, []);
  providerResponse = {
    summary: "Proposed task",
    actions: [{ operation: "create", data: payload("AI-created") }],
  };
  const r = await app.inject({
    method: "POST",
    url: "/ai/chat",
    headers: headers(alice),
    payload: { message: "Create a task" },
  });
  assert.equal(r.statusCode, 200);
  const id = r.json().id;
  assert.equal(
    (
      await pool.query(
        "SELECT * FROM items WHERE user_id=$1 AND title='AI-created'",
        [aliceId],
      )
    ).rowCount,
    0,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/ai/proposals/${id}/apply`,
        headers: headers(bob),
      })
    ).statusCode,
    404,
  );
  const applied = await Promise.all(
    [1, 2].map(() =>
      app.inject({
        method: "POST",
        url: `/ai/proposals/${id}/apply`,
        headers: headers(alice),
      }),
    ),
  );
  assert.ok(applied.every((r) => r.statusCode === 200));
  assert.equal(
    (
      await pool.query(
        "SELECT * FROM items WHERE user_id=$1 AND title='AI-created'",
        [aliceId],
      )
    ).rowCount,
    1,
  );
});
test("AI proposal batch rolls back when an action targets another user", async () => {
  const b = (
    await app.inject({
      method: "POST",
      url: "/items",
      headers: headers(bob),
      payload: payload("Bob private"),
    })
  ).json();
  providerResponse = {
    summary: "Invalid batch",
    actions: [
      { operation: "create", data: payload("Must rollback") },
      { operation: "delete", item_id: b.id, version: 1 },
    ],
  };
  const r = await app.inject({
    method: "POST",
    url: "/ai/chat",
    headers: headers(alice),
    payload: { message: "Change things" },
  });
  assert.equal(r.statusCode, 200);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/ai/proposals/${r.json().id}/apply`,
        headers: headers(alice),
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM items WHERE user_id=$1 AND title='Must rollback'",
        [aliceId],
      )
    ).rowCount,
    0,
  );
});
test("AI provider errors and invalid outputs are handled", async () => {
  providerResponse = {
    summary: "Invalid",
    actions: [{ operation: "create", data: { title: "" } }],
  };
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/ai/chat",
        headers: headers(alice),
        payload: { message: "test" },
      })
    ).statusCode,
    502,
  );
  providerStatus = 500;
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/ai/chat",
        headers: headers(alice),
        payload: { message: "test" },
      })
    ).statusCode,
    502,
  );
  providerStatus = 200;
});
test("reminder scheduling is durable, deduplicated, and honors completed items", async () => {
  const due = new Date(Date.now() + 60000).toISOString();
  const i = (
    await app.inject({
      method: "POST",
      url: "/items",
      headers: headers(alice),
      payload: { ...payload("Reminder"), due_at: due },
    })
  ).json();
  await Promise.all([enqueue(), enqueue()]);
  const n = await pool.query(
    "SELECT * FROM notifications WHERE item_id=$1 AND channel='inapp'",
    [i.id],
  );
  assert.equal(n.rowCount, 1);
  const noticeId = n.rows[0].id;
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/notifications/${noticeId}/read`,
        headers: headers(bob),
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/notifications/${noticeId}/read`,
        headers: headers(alice),
      })
    ).statusCode,
    204,
  );
  await app.inject({
    method: "PUT",
    url: `/items/${i.id}`,
    headers: headers(alice),
    payload: { ...clean(i), status: "done" },
  });
  await enqueue();
  assert.equal(
    (await pool.query("SELECT * FROM notifications WHERE item_id=$1", [i.id]))
      .rowCount,
    1,
  );
});
test("device registration cannot be stolen and logout revokes the session", async () => {
  const token = `ExpoPushToken[${randomUUID()}]`;
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/devices",
        headers: headers(alice),
        payload: { token },
      })
    ).statusCode,
    204,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/devices",
        headers: headers(bob),
        payload: { token },
      })
    ).statusCode,
    409,
  );
  await app.inject({
    method: "DELETE",
    url: "/devices",
    headers: headers(alice),
    payload: { token },
  });
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/auth/logout",
        headers: headers(bob),
      })
    ).statusCode,
    204,
  );
  assert.equal(
    (await app.inject({ url: "/me", headers: headers(bob) })).statusCode,
    401,
  );
});
