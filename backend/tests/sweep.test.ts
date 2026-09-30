import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { buildApp } = await import("../src/app.js");

const app = await buildApp();
let admin = "";
let adminId = "";
let member = "";

const call = (
  token: string,
  method: "GET" | "POST" | "PUT",
  url: string,
  payload?: unknown,
) =>
  app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

const register = async () =>
  (
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: `sweep-${randomUUID()}@example.com`,
        password: "a-long-test-password",
        name: "Sweeper",
      },
    })
  ).json() as { token: string; user: { id: string } };

before(async () => {
  await migrate();
  const a = await register();
  admin = a.token;
  adminId = a.user.id;
  await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [adminId]);
  member = (await register()).token;
  await pool.query("DELETE FROM system_settings WHERE key = 'retention'");
});

after(async () => {
  await pool.query("DELETE FROM system_settings WHERE key = 'retention'");
  await app.close();
  await pool.end();
});

test("the sweeper clears outdated records and keeps recent ones", async () => {
  const marker = `sweep-${randomUUID()}`;
  const liveSession = (
    await pool.query<{ id: string }>(
      "SELECT id FROM sessions WHERE user_id=$1 AND expires_at>now() LIMIT 1",
      [adminId],
    )
  ).rows[0].id;
  const challengeRows = (
    await pool.query<{ id: string; nonce: string }>(
      `INSERT INTO chatgpt_identity_challenges(user_id,session_id,nonce,expires_at)
     VALUES($1,$2,$3,now()-interval '1 minute'),($1,$2,$4,now()+interval '10 minutes')
     RETURNING id,nonce`,
      [adminId, liveSession, `${marker}-expired`, `${marker}-live`],
    )
  ).rows;
  await pool.query(
    `INSERT INTO request_log (at, service, request_id, method, route, status, duration_ms)
     VALUES (now() - interval '30 days', 'api', $1, 'GET', '/old', 200, 5),
            (now() - interval '1 hour', 'api', $1, 'GET', '/new', 200, 5)`,
    [marker],
  );
  await pool.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at)
     VALUES ($1, $2, now() - interval '1 day')`,
    [`expired-${randomUUID()}`, adminId],
  );
  const doc = (
    await pool.query<{ id: string }>(
      "INSERT INTO docs (user_id, title) VALUES ($1, 'Old page') RETURNING id",
      [adminId],
    )
  ).rows[0].id;
  await pool
    .query(
      `INSERT INTO doc_versions (doc_id, version, title, content, created_at)
     VALUES ($1, 1, 'Old page', '[]', now() - interval '3 years')`,
      [doc],
    )
    .catch(() => {});

  const res = await call(admin, "POST", "/admin/sweep/run");
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json();
  assert.ok(body.last.removed.request_log >= 1);
  assert.ok(body.last.removed.sessions >= 1);
  assert.ok(body.last.removed.chatgpt_identity_challenges >= 1);
  assert.deepEqual(
    (
      await pool.query<{ nonce: string }>(
        "SELECT nonce FROM chatgpt_identity_challenges WHERE id=ANY($1::uuid[])",
        [challengeRows.map((row) => row.id)],
      )
    ).rows.map((row) => row.nonce),
    [`${marker}-live`],
  );
  const left = (
    await pool.query<{ route: string }>(
      "SELECT route FROM request_log WHERE request_id = $1",
      [marker],
    )
  ).rows.map((r) => r.route);
  assert.deepEqual(left, ["/new"]);
  // Page history is kept forever unless an admin chooses otherwise.
  assert.equal(
    body.rules.find((r: { key: string }) => r.key === "doc_versions").days,
    0,
  );
  assert.equal(body.last.removed.doc_versions, undefined);
});

test("admins set how long things are kept, within limits", async () => {
  const set = await call(admin, "PUT", "/admin/sweep/retention", {
    request_log: 3,
    doc_versions: 365,
  });
  assert.equal(set.statusCode, 200, set.body);
  const rules = set.json().rules;
  assert.equal(
    rules.find((r: { key: string }) => r.key === "request_log").days,
    3,
  );
  assert.equal(
    rules.find((r: { key: string }) => r.key === "doc_versions").days,
    365,
  );
  // Below a rule's minimum, and rules that can't change, are refused.
  assert.equal(
    (await call(admin, "PUT", "/admin/sweep/retention", { audit_log: 10 }))
      .statusCode,
    422,
  );
  assert.equal(
    (await call(admin, "PUT", "/admin/sweep/retention", { sessions: 30 }))
      .statusCode,
    422,
  );
  // 0 keeps forever.
  assert.equal(
    (await call(admin, "PUT", "/admin/sweep/retention", { audit_log: 0 }))
      .statusCode,
    200,
  );
});

test("assistant records have bounded retention and keep their saved notes", async () => {
  const ideaId = randomUUID();
  const chatId = randomUUID();
  const goalId = randomUUID();
  const oldDay = new Date(Date.now() - 60 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const veryOldDay = new Date(Date.now() - 500 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  await pool.query(
    `INSERT INTO assistant_ideas (id, user_id, local_day, title, summary, created_at)
     VALUES ($1, $2, $3::date, 'Old idea', 'A test idea', now() - interval '60 days')`,
    [ideaId, adminId, oldDay],
  );
  await pool.query(
    `INSERT INTO assistant_idea_days (user_id, local_day, claimed_at, finished_at)
     VALUES ($1, $2::date, now() - interval '60 days', now() - interval '60 days')`,
    [adminId, oldDay],
  );
  await pool.query(
    `INSERT INTO goals (id, user_id, title) VALUES ($1, $2, 'Old goal')`,
    [goalId, adminId],
  );
  await pool.query(
    `INSERT INTO goals_checkins (goal_id, user_id, week_of, summary, created_at)
     VALUES ($1, $2, $3::date, 'Old progress', now() - interval '500 days')`,
    [goalId, adminId, veryOldDay],
  );
  await pool.query(
    `INSERT INTO assistant_briefs (user_id, local_day, created_at)
     VALUES ($1, $2::date, now() - interval '500 days')`,
    [adminId, veryOldDay],
  );
  await pool.query(
    `INSERT INTO ai_chats (id, user_id, title, turns, swept_at, last_used_at)
     VALUES ($1, $2, 'Old compacted chat', '[]'::jsonb,
             now() - interval '400 days', now() - interval '400 days')`,
    [chatId, adminId],
  );

  const response = await call(admin, "POST", "/admin/sweep/run");
  assert.equal(response.statusCode, 200, response.body);
  const removed = response.json().last.removed;
  assert.ok(removed.assistant_ideas >= 1);
  assert.ok(removed.assistant_idea_days >= 1);
  assert.ok(removed.goal_checkins >= 1);
  assert.ok(removed.assistant_briefs >= 1);
  assert.equal(removed.assistant_chat_shells, undefined);
  assert.equal(
    (await pool.query("SELECT 1 FROM ai_chats WHERE id = $1", [chatId]))
      .rowCount,
    1,
    "a compacted chat keeps its history entry",
  );
  assert.equal(
    (await pool.query("SELECT 1 FROM goals WHERE id = $1", [goalId])).rowCount,
    1,
    "the goal and its latest progress summary remain available",
  );
});

test("members can't see or run the sweeper", async () => {
  assert.equal((await call(member, "GET", "/admin/sweep")).statusCode, 403);
  assert.equal(
    (await call(member, "POST", "/admin/sweep/run")).statusCode,
    403,
  );
  assert.equal(
    (await call(member, "PUT", "/admin/sweep/retention", { request_log: 3 }))
      .statusCode,
    403,
  );
});
