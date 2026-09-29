import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import "./setup.js";
import { defaultNightShift } from "@orbyn/core";
import type { ResolvedAi } from "../src/modules/ai/providers/adapters.js";
const { pool, transaction } = await import("../src/db/pool.js");
const { assistantNoticeStale } = await import("../src/worker/delivery.js");
const { migrate } = await import("../src/db/migrate.js");
const { scanNightShift } = await import("../src/worker/night-shift.js");
const { queueOvernightNotices } =
  await import("../src/worker/overnight-notices.js");
const { assistantPrincipal } =
  await import("../src/modules/agents/assistant.js");
const { recordNightRun } =
  await import("../src/modules/ai/agent/night-status.js");
const users: string[] = [];
const ai = {} as ResolvedAi; // Queue tests never call a provider or start a runner.
let oldBudget: number;
before(async () => {
  await migrate();
  oldBudget = (
    await pool.query("SELECT night_token_budget FROM ai_settings WHERE id")
  ).rows[0].night_token_budget;
});
after(async () => {
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [users]);
  await pool.query("UPDATE ai_settings SET night_token_budget = $1 WHERE id", [
    oldBudget,
  ]);
  await pool.end();
});
async function person() {
  const id = randomUUID();
  users.push(id);
  await pool.query(
    "INSERT INTO users(id, email, password_hash, name) VALUES($1, $2, 'test', 'Night tester')",
    [id, `night-worker-${id}@example.test`],
  );
  const grant = await assistantPrincipal({
    id,
    name: "Night tester",
    role: "member",
  });
  const prefs = {
    ...defaultNightShift(),
    enabled: true,
    start: "22:00",
    end: "08:00",
  };
  await pool.query(
    "INSERT INTO agent_settings(user_id, night_shift) VALUES($1, $2::jsonb)",
    [id, JSON.stringify(prefs)],
  );
  const task = (
    await pool.query(
      "INSERT INTO items(user_id, title, agent_grant_id, agent_state, agent_when) VALUES($1, 'First Tonight task', $2, 'queued', 'tonight') RETURNING id",
      [id, grant.grant_id],
    )
  ).rows[0].id;
  return { id, grant: grant.grant_id, task };
}
const night = async (userId: string) =>
  (
    await pool.query(
      "SELECT * FROM assistant_nights WHERE user_id = $1 ORDER BY local_day DESC LIMIT 1",
      [userId],
    )
  ).rows[0];
const queuedJob = async (userId: string) =>
  (
    await pool.query(
      "SELECT * FROM ai_jobs WHERE user_id = $1 AND state = 'queued' ORDER BY created_at DESC LIMIT 1",
      [userId],
    )
  ).rows[0];
async function complete(id: string, tokens = 100) {
  await pool.query(
    "UPDATE ai_jobs SET state = 'done', run_state = NULL, result = $2::jsonb WHERE id = $1",
    [id, JSON.stringify({ assistant_run: { token_estimate: tokens } })],
  );
  await recordNightRun(pool, id, "Night result", "kept");
}
test("morning notices wait for the window, survive concurrent workers and open the owned Overnight", async () => {
  const me = await person();
  const other = await person();
  const createNight = async (id: string) =>
    (
      await pool.query(
        `INSERT INTO assistant_nights(user_id, local_day, status, summary)
     VALUES($1, '2055-01-01', 'done', $2::jsonb) RETURNING id`,
        [
          id,
          JSON.stringify({
            end_at: "2055-01-02T08:00:00Z",
            not_done: [{ title: "Plan tomorrow", reason: "The window ended" }],
          }),
        ],
      )
    ).rows[0].id;
  const nightId = await createNight(me.id);
  await createNight(other.id);
  await pool.query("UPDATE users SET disabled = true WHERE id = $1", [
    other.id,
  ]);
  const token = `ExpoPushToken[${randomUUID()}]`;
  await pool.query("INSERT INTO devices(user_id, token) VALUES($1, $2)", [
    me.id,
    token,
  ]);
  assert.equal(
    await queueOvernightNotices(new Date("2055-01-02T07:59:00Z"), [
      me.id,
      other.id,
    ]),
    0,
  );
  const now = new Date("2055-01-02T08:00:00Z");
  const claims = await Promise.all([
    queueOvernightNotices(now, [me.id, other.id]),
    queueOvernightNotices(now, [me.id, other.id]),
  ]);
  assert.equal(
    claims.reduce((a, b) => a + b, 0),
    1,
  );
  const notices = (
    await pool.query("SELECT * FROM notifications WHERE ref = $1", [
      `overnight:${nightId}`,
    ])
  ).rows;
  assert.equal(notices.length, 2);
  assert.deepEqual(notices.map((n) => n.channel).sort(), ["inapp", "push"]);
  assert.ok(
    notices.every((n) => n.user_id === me.id && n.kind === "assistant"),
  );
  assert.equal(
    await transaction((db) => assistantNoticeStale(db, notices[0])),
    false,
  );
  assert.equal(
    await transaction((db) =>
      assistantNoticeStale(db, {
        ...notices[0],
        user_id: other.id,
      }),
    ),
    true,
  );
  assert.match(notices[0].body, /1 not done tonight/);
  assert.equal(await queueOvernightNotices(now, [me.id, other.id]), 0);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS count FROM notifications WHERE user_id = $1",
        [other.id],
      )
    ).rows[0].count,
    0,
  );
  await pool.query("UPDATE users SET disabled = true WHERE id = $1", [me.id]);
  assert.equal(
    await transaction((db) => assistantNoticeStale(db, notices[0])),
    true,
  );
});
test("two workers queue Tonight first, then wait for completion and respect the ten-run cap", async () => {
  const me = await person();
  const now = new Date("2050-01-01T23:00:00Z");
  const options = { only: [me.id], ai };
  const claims = await Promise.all([
    scanNightShift(now, options),
    scanNightShift(now, options),
  ]);
  assert.equal(
    claims.reduce((a, b) => a + b, 0),
    1,
  );
  const first = await queuedJob(me.id);
  assert.equal(first.run_state.request.automation.kind, "night");
  assert.equal(first.run_state.request.automation.source_kind, "task");
  assert.equal(first.run_state.request.automation.id, me.task);
  assert.equal((await night(me.id)).runs, 1);
  assert.equal(await scanNightShift(now, options), 0);
  await complete(first.id);
  assert.equal(await scanNightShift(now, options), 1);
  const second = await queuedJob(me.id);
  assert.equal(second.run_state.request.automation.night_kind, "plan");
  assert.equal((await night(me.id)).budget_used, 100);
  await complete(second.id);
  await pool.query("UPDATE assistant_nights SET runs = 10 WHERE user_id = $1", [
    me.id,
  ]);
  assert.equal(await scanNightShift(now, options), 0);
  const capped = await night(me.id);
  assert.equal(capped.status, "done");
  assert.ok(capped.summary.not_done.length > 0);
  assert.ok(
    capped.summary.not_done.every((x: { reason: string }) =>
      x.reason.includes("ten-run limit"),
    ),
  );
  assert.equal(await scanNightShift(now, options), 0);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM assistant_nights WHERE user_id = $1",
        [me.id],
      )
    ).rows[0].n,
    1,
  );
});
test("the shared night budget limits queued runs and leaves the remaining work for morning", async () => {
  const me = await person();
  const now = new Date("2050-01-02T23:00:00Z");
  const options = { only: [me.id], ai };
  await pool.query("UPDATE ai_settings SET night_token_budget = 1000 WHERE id");
  assert.equal(await scanNightShift(now, options), 1);
  const job = await queuedJob(me.id);
  assert.equal(job.run_state.state.token_budget, 1000);
  await complete(job.id, 1000);
  assert.equal(await scanNightShift(now, options), 0);
  assert.equal((await night(me.id)).status, "done");
  assert.ok(
    (await night(me.id)).summary.not_done.every((x: { reason: string }) =>
      x.reason.includes("token budget"),
    ),
  );
  await pool.query("UPDATE ai_settings SET night_token_budget = $1 WHERE id", [
    oldBudget,
  ]);
});
test("provider, account, pause, recent activity and window gates keep night work out of the queue", async () => {
  const me = await person();
  const now = new Date("2050-01-03T23:00:00Z");
  const options = { only: [me.id], ai };
  assert.equal(await scanNightShift(now, { ...options, ai: null }), 0);
  assert.equal(
    await scanNightShift(new Date("2050-01-03T12:00:00Z"), options),
    0,
  );
  await pool.query("UPDATE users SET disabled = true WHERE id = $1", [me.id]);
  assert.equal(await scanNightShift(now, options), 0);
  await pool.query("UPDATE users SET disabled = false WHERE id = $1", [me.id]);
  await pool.query(
    "UPDATE agent_grants SET suspended_at = now() WHERE id = $1",
    [me.grant],
  );
  assert.equal(await scanNightShift(now, options), 0);
  await pool.query(
    "UPDATE agent_grants SET suspended_at = NULL WHERE id = $1",
    [me.grant],
  );
  await pool.query(
    "INSERT INTO presence(user_id, device_id, platform, seen_at) VALUES($1, 'night-test', 'web', $2)",
    [me.id, now],
  );
  assert.equal(await scanNightShift(now, options), 0);
  await pool.query(
    "UPDATE presence SET seen_at = $2::timestamptz - interval '16 minutes' WHERE user_id = $1",
    [me.id, now],
  );
  assert.equal(await scanNightShift(now, options), 1);
  assert.equal(
    await scanNightShift(new Date("2050-01-04T08:00:00Z"), options),
    0,
  );
  const closed = await night(me.id);
  assert.equal(closed.status, "done");
  assert.ok(
    closed.summary.not_done.every((x: { reason: string }) =>
      x.reason.includes("window ended"),
    ),
  );
});

test("upcoming exams and promises select relevant kinds without requiring unfinished tasks", async () => {
  const me = await person();
  const now = new Date("2050-01-05T23:00:00Z");
  await pool.query("DELETE FROM items WHERE id = $1", [me.task]);
  await pool.query(
    "INSERT INTO study_exams(user_id, exam_key, title, starts_at) VALUES($1, 'night-exam', 'Upcoming exam', $2::timestamptz + interval '3 days')",
    [me.id, now],
  );
  await pool.query(
    "INSERT INTO work_records(created_by, owner_id, kind, title) VALUES($1, $1, 'promise', 'Send my draft')",
    [me.id],
  );
  const options = { only: [me.id], ai };
  const kinds: string[] = [];
  while (await scanNightShift(now, options)) {
    const job = await queuedJob(me.id);
    kinds.push(job.run_state.request.automation.night_kind);
    await complete(job.id);
  }
  assert.deepEqual(kinds, ["deadlines", "study", "follow_through"]);
});

test("one unreadable routine pauses itself while a valid due routine still queues", async () => {
  const me = await person();
  const now = new Date("2050-01-06T23:00:00Z");
  await pool.query("DELETE FROM items WHERE id = $1", [me.task]);
  const broken = (
    await pool.query(
      "INSERT INTO agent_routines(user_id, instruction, rrule, next_run_at) VALUES($1, 'Broken schedule', 'not a rule', $2) RETURNING id",
      [me.id, now],
    )
  ).rows[0].id;
  const valid = (
    await pool.query(
      "INSERT INTO agent_routines(user_id, instruction, rrule, next_run_at) VALUES($1, 'Review my work', 'FREQ=DAILY', $2) RETURNING id",
      [me.id, now],
    )
  ).rows[0].id;
  assert.equal(await scanNightShift(now, { only: [me.id], ai }), 1);
  const job = await queuedJob(me.id);
  assert.equal(job.run_state.request.automation.source_kind, "routine");
  assert.equal(job.run_state.request.automation.id, valid);
  const paused = (
    await pool.query(
      "SELECT paused, last_result FROM agent_routines WHERE id = $1",
      [broken],
    )
  ).rows[0];
  assert.equal(paused.paused, true);
  assert.match(paused.last_result.error, /schedule could not be read/);
});

test("a saved Tonight candidate taken back before its turn is skipped", async () => {
  const me = await person();
  const now = new Date("2050-01-07T23:00:00Z");
  const second = (
    await pool.query(
      "INSERT INTO items(user_id, title, agent_grant_id, agent_state, agent_when, updated_at) VALUES($1, 'Taken back', $2, 'queued', 'tonight', now() + interval '1 minute') RETURNING id",
      [me.id, me.grant],
    )
  ).rows[0].id;
  const options = { only: [me.id], ai };
  assert.equal(await scanNightShift(now, options), 1);
  await complete((await queuedJob(me.id)).id);
  await pool.query(
    "UPDATE items SET agent_grant_id = NULL, agent_state = NULL WHERE id = $1",
    [second],
  );
  assert.equal(await scanNightShift(now, options), 1);
  assert.equal(
    (await queuedJob(me.id)).run_state.request.automation.night_kind,
    "plan",
  );
  assert.ok(
    (await night(me.id)).summary.not_done.some(
      (entry: { title: string }) => entry.title === "Taken back",
    ),
  );
});

test("a full night queues exactly ten jobs and retains unstarted Tonight tasks", async () => {
  const me = await person();
  const now = new Date("2050-01-08T23:00:00Z");
  await pool.query(
    `INSERT INTO items(user_id, title, agent_grant_id, agent_state, agent_when)
     SELECT $1, 'Tonight task ' || n, $2, 'queued', 'tonight' FROM generate_series(1, 11) n`,
    [me.id, me.grant],
  );
  const options = { only: [me.id], ai };
  const claimed = new Set<string>();
  for (let n = 0; n < 10; n++) {
    assert.equal(await scanNightShift(now, options), 1);
    const job = await queuedJob(me.id);
    assert.equal(job.run_state.request.automation.night_kind, "handed");
    claimed.add(job.run_state.request.automation.id);
    await complete(job.id);
  }
  assert.equal(claimed.size, 10);
  assert.equal(await scanNightShift(now, options), 0);
  const finished = await night(me.id);
  assert.equal(finished.runs, 10);
  assert.equal(finished.status, "done");
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM items WHERE user_id = $1 AND agent_state = 'queued'",
        [me.id],
      )
    ).rows[0].n,
    2,
  );
  assert.equal(
    finished.summary.not_done.filter(
      (entry: { title: string }) =>
        entry.title.startsWith("Tonight task") ||
        entry.title === "First Tonight task",
    ).length,
    2,
  );
});

test("Friday weekly review remains eligible with no unfinished records, including after midnight", async () => {
  const me = await person();
  await pool.query("DELETE FROM items WHERE id=$1", [me.task]);
  const now = new Date("2026-10-03T02:00:00Z"); // Still Friday's 22:00–08:00 window.
  assert.equal(await scanNightShift(now, { only: [me.id], ai }), 1);
  const job = await queuedJob(me.id);
  assert.equal(job.run_state.request.automation.night_kind, "follow_through");
  assert.equal(
    (
      await pool.query(
        "SELECT local_day::text AS day FROM assistant_nights WHERE user_id=$1",
        [me.id],
      )
    ).rows[0].day,
    "2026-10-02",
  );
  await complete(job.id);
  assert.equal(await scanNightShift(now, { only: [me.id], ai }), 0);
});
