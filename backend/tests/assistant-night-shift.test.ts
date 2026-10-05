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

for (const lane of ["interactive", "background"] as const) {
  for (const state of ["queued", "running", "waiting"] as const) {
    test(`${state} ${lane} work does not occupy the Overnight scheduler`, async () => {
      const me = await person();
      const unrelated = (
        await pool.query(
          "INSERT INTO ai_jobs(user_id,state,run_state) VALUES($1,$2,$3) RETURNING id,runtime_lane",
          [
            me.id,
            state,
            {
              version: 1,
              request:
                lane === "background"
                  ? { automation: { kind: "task", id: randomUUID() } }
                  : {},
            },
          ],
        )
      ).rows[0];
      assert.equal(unrelated.runtime_lane, lane);
      const now = new Date("2050-01-02T23:00:00Z");
      const options = { only: [me.id], ai };
      assert.equal(await scanNightShift(now, options), 1);
      const jobs = (
        await pool.query(
          "SELECT id,runtime_lane FROM ai_jobs WHERE user_id=$1 AND runtime_lane='overnight'",
          [me.id],
        )
      ).rows;
      assert.equal(jobs.length, 1);
      assert.notEqual(jobs[0].id, unrelated.id);
      assert.equal(await scanNightShift(now, options), 0);
      assert.equal((await night(me.id)).runs, 1);
      assert.equal(
        (
          await pool.query("SELECT state FROM ai_jobs WHERE id=$1", [
            unrelated.id,
          ])
        ).rows[0].state,
        state,
      );
    });
  }
}

for (const state of ["queued", "running"] as const) {
  test(`${state} Overnight work retains the scheduler's per-owner run limit`, async () => {
    const me = await person();
    const ownJob = (
      await pool.query(
        "INSERT INTO ai_jobs(user_id,state,run_state) VALUES($1,$2,$3) RETURNING id,runtime_lane",
        [
          me.id,
          state,
          { version: 1, request: { automation: { kind: "night" } } },
        ],
      )
    ).rows[0];
    assert.equal(ownJob.runtime_lane, "overnight");
    const options = { only: [me.id], ai };
    const now = new Date("2050-01-02T23:00:00Z");
    assert.equal(await scanNightShift(now, options), 0);
    assert.equal((await night(me.id)).runs, 0);
    await complete(ownJob.id);
    assert.equal(await scanNightShift(now, options), 1);
    assert.equal((await night(me.id)).runs, 1);
  });
}

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

test("calendar-only exams and subscribed meetings select overnight kinds before Study discovery", async () => {
  const me = await person();
  const now = new Date("2050-01-05T23:00:00Z");
  await pool.query("DELETE FROM items WHERE id=$1", [me.task]);
  const sub = (
    await pool.query(
      "INSERT INTO calendar_subscriptions(user_id,url,name,kind,busy,last_fetched_at) VALUES($1,$2,'Night calendar','exams',true,now()) RETURNING id",
      [me.id, `https://example.test/${randomUUID()}.ics`],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO external_events(subscription_id,uid,title,starts_at,ends_at,timezone) VALUES($1,'exam','Final exam',$2::timestamptz+interval '1 day',$2::timestamptz+interval '1 day 2 hours','UTC')",
    [sub, now],
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM study_exams WHERE user_id=$1",
        [me.id],
      )
    ).rows[0].n,
    0,
  );
  const kinds: string[] = [];
  while (await scanNightShift(now, { only: [me.id], ai })) {
    const job = await queuedJob(me.id);
    kinds.push(job.run_state.request.automation.night_kind);
    await complete(job.id);
  }
  assert.deepEqual(kinds, ["deadlines", "study", "meetings"]);
});

test("calendar exam discovery does not awaken work kept out of the assistant", async () => {
  const me = await person();
  const now = new Date("2050-01-05T23:00:00Z");
  await pool.query("DELETE FROM items WHERE id=$1", [me.task]);
  const project = (
    await pool.query(
      "INSERT INTO projects(user_id,name,assistant_off) VALUES($1,'Private study',true) RETURNING id",
      [me.id],
    )
  ).rows[0].id;
  const doc = (
    await pool.query(
      "INSERT INTO docs(user_id,project_id,title) VALUES($1,$2,'Private notes') RETURNING id",
      [me.id, project],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO items(user_id,project_id,title,kind,due_at,end_at) VALUES($1,$2,'Private final exam','event',$3::timestamptz+interval '1 day',$3::timestamptz+interval '1 day 2 hours')",
    [me.id, project, now],
  );
  await pool.query(
    "INSERT INTO study_exams(user_id,exam_key,title,starts_at,own,doc_ids) VALUES($1,'own:private','Private study exam',$2::timestamptz+interval '1 day',true,$3)",
    [me.id, now, [doc]],
  );
  assert.equal(await scanNightShift(now, { only: [me.id], ai }), 0);
  assert.equal(await queuedJob(me.id), undefined);
});

test("new notes awaken Study even before exams or cards exist", async () => {
  const me = await person();
  const now = new Date("2050-01-05T23:00:00Z");
  await pool.query("DELETE FROM items WHERE id=$1", [me.task]);
  await pool.query(
    "INSERT INTO docs(user_id,title,content,created_at,updated_at) VALUES($1,'Lecture notes',$2,$3,$3)",
    [
      me.id,
      JSON.stringify([
        {
          type: "paragraph",
          content: [{ type: "text", text: "Useful lecture material" }],
        },
      ]),
      now,
    ],
  );
  assert.equal(await scanNightShift(now, { only: [me.id], ai }), 1);
  const job = await queuedJob(me.id);
  assert.equal(job.run_state.request.automation.night_kind, "study");
  assert.match(job.run_state.request.message, /notes added today/);
  await complete(job.id);
  assert.equal(await scanNightShift(now, { only: [me.id], ai }), 0);
});

test("enabled kinds run by earliest due work after handed tasks", async () => {
  const me = await person();
  const now = new Date("2050-01-05T23:00:00Z");
  const sub = (
    await pool.query(
      "INSERT INTO calendar_subscriptions(user_id,url,name,kind,busy,last_fetched_at) VALUES($1,$2,'Work calendar','work',true,now()) RETURNING id",
      [me.id, `https://example.test/${randomUUID()}.ics`],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO external_events(subscription_id,uid,title,starts_at,ends_at,timezone) VALUES($1,'meeting','Tomorrow meeting',$2::timestamptz+interval '2 hours',$2::timestamptz+interval '3 hours','UTC')",
    [sub, now],
  );
  await pool.query(
    "INSERT INTO study_exams(user_id,exam_key,title,starts_at,own) VALUES($1,'own:later','Later exam',$2::timestamptz+interval '5 days',true)",
    [me.id, now],
  );
  const kinds: string[] = [];
  while (await scanNightShift(now, { only: [me.id], ai })) {
    const job = await queuedJob(me.id);
    kinds.push(job.run_state.request.automation.night_kind);
    await complete(job.id);
  }
  assert.equal(kinds[0], "handed");
  assert.ok(
    kinds.indexOf("meetings") < kinds.indexOf("deadlines"),
    JSON.stringify(kinds),
  );
  assert.ok(
    kinds.indexOf("meetings") < kinds.indexOf("study"),
    JSON.stringify(kinds),
  );
});

test("moving a persisted routine into the future skips it without blocking later night work", async () => {
  const me = await person();
  const now = new Date("2050-01-15T23:00:00Z");
  const routine = (
    await pool.query(
      "INSERT INTO agent_routines(user_id,instruction,rrule,next_run_at) VALUES($1,'Old routine','FREQ=DAILY',$2) RETURNING id",
      [me.id, now],
    )
  ).rows[0].id;
  const options = { only: [me.id], ai };
  assert.equal(await scanNightShift(now, options), 1);
  const first = await queuedJob(me.id);
  assert.equal(first.run_state.request.automation.source_kind, "task");
  const moved = new Date("2050-01-17T10:00:00Z");
  await pool.query(
    "UPDATE agent_routines SET next_run_at=$2,updated_at=now() WHERE id=$1",
    [routine, moved],
  );
  await complete(first.id);
  assert.equal(await scanNightShift(now, options), 1);
  assert.notEqual(
    (await queuedJob(me.id)).run_state.request.automation.id,
    routine,
  );
  assert.equal(
    (
      await pool.query("SELECT next_run_at FROM agent_routines WHERE id=$1", [
        routine,
      ])
    ).rows[0].next_run_at.toISOString(),
    moved.toISOString(),
  );
  // Candidates are ordered by their due work; advance through the remaining
  // work before asserting that the saved routine was encountered and skipped.
  await complete((await queuedJob(me.id)).id);
  while (await scanNightShift(now, options))
    await complete((await queuedJob(me.id)).id);
  assert.ok(
    (await night(me.id)).summary.not_done.some(
      (entry: { title: string }) => entry.title === "Scheduled routine",
    ),
  );
});

test("persisted routine claims use the current instruction and recurrence", async () => {
  const me = await person();
  const now = new Date("2050-01-16T23:00:00Z");
  const routine = (
    await pool.query(
      "INSERT INTO agent_routines(user_id,instruction,rrule,next_run_at) VALUES($1,'Original instruction','FREQ=DAILY',$2) RETURNING id",
      [me.id, now],
    )
  ).rows[0].id;
  const options = { only: [me.id], ai };
  assert.equal(await scanNightShift(now, options), 1);
  const first = await queuedJob(me.id);
  await pool.query(
    "UPDATE agent_routines SET instruction='Updated instruction',rrule='FREQ=WEEKLY',updated_at=now() WHERE id=$1",
    [routine],
  );
  await complete(first.id);
  assert.equal(await scanNightShift(now, options), 1);
  const second = await queuedJob(me.id);
  assert.equal(second.run_state.request.automation.id, routine);
  assert.match(second.run_state.request.message, /Updated instruction/);
  assert.doesNotMatch(second.run_state.request.message, /Original instruction/);
  const { nextOccurrence } = await import("@orbyn/core");
  const saved = (
    await pool.query("SELECT next_run_at FROM agent_routines WHERE id=$1", [
      routine,
    ])
  ).rows[0];
  assert.equal(
    saved.next_run_at.toISOString(),
    nextOccurrence(now, "FREQ=WEEKLY", "UTC", now)!.toISOString(),
  );
});

test("a provisional morning card refreshes after a late run without another push", async () => {
  const me = await person();
  const now = new Date("2050-02-01T23:00:00Z");
  await pool.query("INSERT INTO devices(user_id,token) VALUES($1,$2)", [
    me.id,
    `ExpoPushToken[${randomUUID()}]`,
  ]);
  assert.equal(await scanNightShift(now, { only: [me.id], ai }), 1);
  const job = await queuedJob(me.id);
  const morning = new Date("2050-02-02T08:00:00Z");
  assert.equal(await queueOvernightNotices(morning, [me.id]), 1);
  const nightId = (await night(me.id)).id;
  const before = (
    await pool.query(
      "SELECT * FROM notifications WHERE ref=$1 ORDER BY channel",
      [`overnight:${nightId}`],
    )
  ).rows;
  assert.equal(before.length, 2);
  assert.match(
    before.find((notice) => notice.channel === "push").body,
    /still settling/,
  );
  await complete(job.id);
  assert.equal(await queueOvernightNotices(morning, [me.id]), 0);
  const after = (
    await pool.query(
      "SELECT * FROM notifications WHERE ref=$1 ORDER BY channel",
      [`overnight:${nightId}`],
    )
  ).rows;
  assert.deepEqual(
    after.map((notice) => notice.id),
    before.map((notice) => notice.id),
  );
  assert.match(
    after.find((notice) => notice.channel === "inapp").body,
    /1 run finished/,
  );
  assert.equal(
    after.find((notice) => notice.channel === "push").body,
    before.find((notice) => notice.channel === "push").body,
  );
});

test("morning refreshes do not starve unsent nights beyond the twenty-night batch", async () => {
  const selected: string[] = [];
  for (let n = 0; n < 25; n++) {
    const me = await person();
    selected.push(me.id);
    await pool.query(
      "INSERT INTO assistant_nights(user_id,local_day,status,summary) VALUES($1,'2050-02-01','done',$2)",
      [
        me.id,
        JSON.stringify({
          end_at: "2050-02-02T08:00:00Z",
          not_done: [{ title: "Unfinished work", reason: "The window ended" }],
        }),
      ],
    );
  }
  const now = new Date("2050-02-02T08:00:00Z");
  assert.equal(await queueOvernightNotices(now, selected), 20);
  assert.equal(await queueOvernightNotices(now, selected), 5);
  assert.equal(await queueOvernightNotices(now, selected), 0);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS count FROM assistant_nights WHERE user_id=ANY($1::uuid[]) AND notified_at IS NOT NULL",
        [selected],
      )
    ).rows[0].count,
    25,
  );
});

test("a parked personal question does not starve new night work", async () => {
  const me = await person();
  await pool.query(
    "INSERT INTO ai_jobs(user_id,state,run_state,heartbeat_at) VALUES($1,'waiting','{}',now())",
    [me.id],
  );
  const now = new Date("2050-01-02T23:00:00Z");
  assert.equal(await scanNightShift(now, { only: [me.id], ai }), 1);
  assert.ok(await queuedJob(me.id));
});

test("night goal selection respects weekly attempt limits and retry backoff", async () => {
  const me = await person();
  await pool.query("UPDATE items SET agent_state='done' WHERE id=$1", [
    me.task,
  ]);
  const goal = (
    await pool.query(
      "INSERT INTO goals(user_id,title,target) VALUES($1,'Capped goal','Finish') RETURNING id",
      [me.id],
    )
  ).rows[0].id;
  const now = new Date("2050-01-02T23:00:00Z");
  const week = (
    await pool.query(
      "SELECT date_trunc('week',$1::timestamptz AT TIME ZONE 'UTC')::date::text AS week",
      [now],
    )
  ).rows[0].week;
  await pool.query(
    "INSERT INTO goals_checkins(goal_id,user_id,week_of,status,summary,attempts,claimed_at) VALUES($1,$2,$3,'failed','Retry later',3,$4)",
    [goal, me.id, week, now],
  );
  await scanNightShift(now, { only: [me.id], ai });
  const entries = (await night(me.id)).summary.candidates;
  assert.equal(
    entries.some((entry: { id?: string }) => entry.id === goal),
    false,
  );
});

async function pagePerson() {
  const me = await person();
  await pool.query("DELETE FROM items WHERE id=$1", [me.task]);
  const prefs = {
    ...defaultNightShift(),
    enabled: true,
    start: "22:00",
    end: "08:00",
    timezone: "UTC",
  };
  for (const kind of Object.keys(prefs.kinds))
    prefs.kinds[kind as keyof typeof prefs.kinds] = false;
  prefs.kinds.follow_through = true;
  await pool.query(
    "UPDATE agent_settings SET night_shift=$2 WHERE user_id=$1",
    [me.id, JSON.stringify(prefs)],
  );
  const user = (await pool.query("SELECT * FROM users WHERE id=$1", [me.id]))
    .rows[0];
  const doc = (
    await pool.query(
      "INSERT INTO docs(user_id,title,content) VALUES($1,'Private page title',$2) RETURNING id",
      [
        me.id,
        JSON.stringify([
          { id: "summary", type: "paragraph", text: "Selected page summary" },
        ]),
      ],
    )
  ).rows[0];
  const { createMaintainedPageBinding } =
    await import("../src/modules/docs/maintenance.js");
  const binding = await transaction(async (db) =>
    createMaintainedPageBinding(
      db,
      user,
      await assistantPrincipal(user, { db }),
      doc.id,
      {
        block_ids: ["summary"],
        expected_doc_version: 1,
        instruction: "Maintain summary",
        rrule: "FREQ=DAILY",
        timezone: "UTC",
        next_run_at: "2050-01-02T22:00:00Z",
        paused: false,
      },
    ),
  );
  return { ...me, doc: doc.id, binding: binding.id };
}

test("Night queues a scoped page once, counts it and reports safe morning progress", async () => {
  const me = await pagePerson();
  const now = new Date("2050-01-02T23:00:00Z");
  const opts = { only: [me.id], ai };
  assert.equal(await scanNightShift(now, opts), 1);
  const n = await night(me.id);
  assert.equal(n.runs, 1);
  assert.ok(!JSON.stringify(n.summary).includes("Private page title"));
  assert.equal(await scanNightShift(now, opts), 0);
  const run = (
    await pool.query("SELECT * FROM assistant_page_runs WHERE night_id=$1", [
      n.id,
    ])
  ).rows[0];
  assert.equal(run.lane, "overnight");
  assert.equal(run.requires_review, true);
  assert.equal(
    (
      await pool.query("SELECT count(*)::int n FROM ai_jobs WHERE user_id=$1", [
        me.id,
      ])
    ).rows[0].n,
    0,
  );
  await pool.query("UPDATE assistant_page_runs SET state='done' WHERE id=$1", [
    run.id,
  ]);
  assert.equal(await scanNightShift(now, opts), 0);
  assert.equal((await night(me.id)).status, "done");
  const { latestNight } =
    await import("../src/modules/assistant-workspace/overnight.js");
  const shown = await transaction((db) => latestNight(db, me.id, n.id));
  assert.equal(shown?.page_runs?.length, 1);
  assert.equal(shown?.page_runs?.[0].doc_id, me.doc);
  const { buildOvernightSection } = await import("../src/worker/digest.js");
  const section = await buildOvernightSection(me.id, "2050-01-03", n.id);
  assert.ok(section?.firstLine.includes("1 run finished"));
  assert.ok(section?.markdown.join(" ").includes("Page updated"));
  assert.ok(!JSON.stringify(section).includes("Private page title"));
  await pool.query("UPDATE agent_grants SET personal=false WHERE id=$1", [
    me.grant,
  ]);
  assert.equal(
    (await transaction((db) => latestNight(db, me.id, n.id)))?.page_runs
      ?.length,
    0,
  );
  assert.equal(await buildOvernightSection(me.id, "2050-01-03", n.id), null);
});

test("page candidates obey the shared Night ten-run cap", async () => {
  const me = await pagePerson();
  const now = new Date("2050-01-02T23:00:00Z");
  await pool.query(
    "INSERT INTO assistant_nights(user_id,local_day,runs) VALUES($1,'2050-01-02',10)",
    [me.id],
  );
  assert.equal(await scanNightShift(now, { only: [me.id], ai }), 0);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM assistant_page_runs WHERE user_id=$1",
        [me.id],
      )
    ).rows[0].n,
    0,
  );
  const n = await night(me.id);
  assert.equal(n.status, "done");
  assert.ok(
    n.summary.not_done.some((entry: { reason: string }) =>
      entry.reason.includes("ten-run"),
    ),
  );
});

test("a due page cannot take the final Night slot reserved for reflection", async () => {
  const me = await pagePerson();
  const now = new Date("2050-01-02T23:00:00Z");
  await pool.query(
    "UPDATE agent_settings SET night_shift=jsonb_set(night_shift,'{kinds,reflection}','true') WHERE user_id=$1",
    [me.id],
  );
  const chat = randomUUID();
  await pool.query(
    "INSERT INTO ai_chats(id,user_id,title,origin) VALUES($1,$2,'Reflection evidence','person')",
    [chat, me.id],
  );
  await pool.query(
    "INSERT INTO ai_jobs(user_id,chat_id,turn_id,state,result,sources_checked,created_at) VALUES($1,$2,$3,'done',$4,true,$5)",
    [
      me.id,
      chat,
      randomUUID(),
      JSON.stringify({ answer: "A completed authorized draft." }),
      new Date(now.getTime() - 1000),
    ],
  );
  await pool.query(
    "INSERT INTO assistant_nights(user_id,local_day,runs) VALUES($1,'2050-01-02',9)",
    [me.id],
  );
  assert.equal(await scanNightShift(now, { only: [me.id], ai }), 1);
  const job = await queuedJob(me.id);
  assert.equal(job.run_state.request.automation.night_kind, "reflection");
  assert.equal((await night(me.id)).runs, 10);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM assistant_page_runs WHERE user_id=$1",
        [me.id],
      )
    ).rows[0].n,
    0,
  );
  await complete(job.id);
  assert.equal(await scanNightShift(now, { only: [me.id], ai }), 0);
  assert.ok(
    (await night(me.id)).summary.not_done.some(
      (entry: { kind: string }) => entry.kind === "page_update",
    ),
  );
});
