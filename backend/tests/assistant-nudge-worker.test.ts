import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import "./setup.js";
import { DEFAULT_REMINDER_NUDGES } from "@orbyn/core";
const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { assistantPrincipal } =
  await import("../src/modules/agents/assistant.js");
const { postReminderNudge, reminderNudgeCandidates } =
  await import("../src/worker/reminder-nudges.js");
const { reminderNudgeStale, deferQuietReminderNudge } =
  await import("../src/worker/delivery.js");
const people: string[] = [];
const now = new Date("2050-01-02T15:00:00Z");
before(async () => {
  await migrate();
});
after(async () => {
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [people]);
  await pool.end();
});
async function person(chat = true) {
  const id = randomUUID();
  people.push(id);
  await pool.query(
    "INSERT INTO users(id, email, password_hash, name) VALUES($1, $2, 'test', 'Nudge tester')",
    [id, `nudge-${id}@example.test`],
  );
  await assistantPrincipal({ id, name: "Nudge tester", role: "member" });
  await pool.query(
    "INSERT INTO agent_settings(user_id, reminder_nudges) VALUES($1, $2)",
    [id, JSON.stringify({ ...DEFAULT_REMINDER_NUDGES, chat })],
  );
  const tasks: string[] = [];
  for (let n = 0; n < 4; n++)
    tasks.push(
      (
        await pool.query(
          "INSERT INTO items(user_id, title, due_at) VALUES($1, $2, $3) RETURNING id",
          [id, `Overdue ${n}`, new Date("2049-12-30T12:00:00Z")],
        )
      ).rows[0].id,
    );
  return { id, tasks };
}
test("concurrent senders reserve at most three per local day and keep one pinned personal chat", async () => {
  const me = await person();
  const candidates = await reminderNudgeCandidates(me.id, "UTC", now);
  for (let attempt = 0; attempt < 3; attempt++)
    await Promise.all(
      candidates.map((c) => postReminderNudge(me.id, "UTC", c, now)),
    );
  for (const candidate of candidates)
    await postReminderNudge(me.id, "UTC", candidate, now);
  const rows = (
    await pool.query("SELECT * FROM assistant_nudges WHERE user_id = $1", [
      me.id,
    ])
  ).rows;
  assert.equal(rows.length, 3);
  assert.equal(new Set(rows.map((r) => r.nudge_key)).size, 3);
  const chats = (
    await pool.query(
      "SELECT * FROM ai_chats WHERE user_id = $1 AND origin = 'reminders'",
      [me.id],
    )
  ).rows;
  assert.equal(chats.length, 1);
  assert.equal(chats[0].pinned, true);
  assert.equal(chats[0].turns.length, 3);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS count FROM notifications WHERE user_id = $1 AND channel = 'email'",
        [me.id],
      )
    ).rows[0].count,
    3,
  );
});
test("chat-off delivery resolves the ledger and cancels completed or stopped sources", async () => {
  const me = await person(false);
  const candidate = (await reminderNudgeCandidates(me.id, "UTC", now))[0];
  assert.equal(await postReminderNudge(me.id, "UTC", candidate, now), true);
  const ledger = (
    await pool.query("SELECT * FROM assistant_nudges WHERE user_id = $1", [
      me.id,
    ])
  ).rows[0];
  const notice = {
    user_id: me.id,
    ref: `nudge:${ledger.id}`,
    channel: "email",
  };
  assert.equal(
    await transaction((db) => reminderNudgeStale(db, notice, now)),
    false,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS count FROM ai_chats WHERE user_id = $1",
        [me.id],
      )
    ).rows[0].count,
    0,
  );
  await pool.query("UPDATE items SET status = 'done' WHERE id = $1", [
    candidate.entity_id,
  ]);
  assert.equal(
    await transaction((db) => reminderNudgeStale(db, notice, now)),
    true,
  );
  await pool.query("UPDATE items SET status = 'todo' WHERE id = $1", [
    candidate.entity_id,
  ]);
  // A newer reminder can be stopped while an older notice is still queued.
  await pool.query(
    `INSERT INTO assistant_nudges(user_id, nudge_key, entity_kind, entity_id, local_day, stopped)
     VALUES($1, $2, $3, $4, $5, true)`,
    [
      me.id,
      ledger.nudge_key,
      ledger.entity_kind,
      ledger.entity_id,
      ledger.local_day,
    ],
  );
  assert.equal(
    await transaction((db) => reminderNudgeStale(db, notice, now)),
    true,
  );
  await pool.query(
    "DELETE FROM assistant_nudges WHERE user_id = $1 AND stopped",
    [me.id],
  );
  await pool.query("UPDATE assistant_nudges SET stopped = true WHERE id = $1", [
    ledger.id,
  ]);
  assert.equal(
    await transaction((db) => reminderNudgeStale(db, notice, now)),
    true,
  );
});
test("delayed delivery waits through local quiet hours without losing the notice or spending attempts", async () => {
  const me = await person(false);
  const candidate = (await reminderNudgeCandidates(me.id, "UTC", now))[0];
  assert.equal(await postReminderNudge(me.id, "UTC", candidate, now), true);
  const notice = (
    await pool.query(
      "SELECT * FROM notifications WHERE user_id = $1 AND channel = 'email'",
      [me.id],
    )
  ).rows[0];
  const quiet = new Date("2050-01-02T22:01:00Z");
  assert.equal(
    await transaction((db) => deferQuietReminderNudge(db, notice, quiet)),
    true,
  );
  const deferred = (
    await pool.query("SELECT * FROM notifications WHERE id = $1", [notice.id])
  ).rows[0];
  assert.equal(deferred.state, "pending");
  assert.equal(deferred.attempts, notice.attempts);
  assert.equal(deferred.available_at.toISOString(), "2050-01-02T22:16:00.000Z");
  assert.equal(
    await transaction((db) =>
      deferQuietReminderNudge(db, notice, new Date("2050-01-03T08:00:00Z")),
    ),
    false,
  );
  await pool.query(
    "INSERT INTO planner_prefs(user_id, timezone) VALUES($1, 'Australia/Melbourne') ON CONFLICT(user_id) DO UPDATE SET timezone = EXCLUDED.timezone",
    [me.id],
  );
  // The same UTC clock is daytime in Melbourne, so the local window wins.
  assert.equal(
    await transaction((db) => deferQuietReminderNudge(db, notice, quiet)),
    false,
  );
});
test("posting rechecks ownership, completion and kept-out projects after selection", async () => {
  const me = await person();
  const other = await person();
  const candidates = await reminderNudgeCandidates(me.id, "UTC", now);
  assert.equal(
    await postReminderNudge(other.id, "UTC", candidates[0], now),
    false,
  );
  await pool.query("UPDATE items SET status = 'done' WHERE id = $1", [
    candidates[0].entity_id,
  ]);
  assert.equal(
    await postReminderNudge(me.id, "UTC", candidates[0], now),
    false,
  );
  const project = (
    await pool.query(
      "INSERT INTO projects(user_id, name, assistant_off) VALUES($1, 'Kept out', true) RETURNING id",
      [me.id],
    )
  ).rows[0].id;
  await pool.query("UPDATE items SET project_id = $2 WHERE id = $1", [
    candidates[1].entity_id,
    project,
  ]);
  assert.equal(
    await postReminderNudge(me.id, "UTC", candidates[1], now),
    false,
  );
});
test("the same thing is deduplicated when its reminder category changes", async () => {
  const me = await person();
  const candidate = (await reminderNudgeCandidates(me.id, "UTC", now))[0];
  assert.equal(await postReminderNudge(me.id, "UTC", candidate, now), true);
  await pool.query("UPDATE items SET due_at = $2 WHERE id = $1", [
    candidate.entity_id,
    new Date("2050-01-02T17:00:00Z"),
  ]);
  const changed = (await reminderNudgeCandidates(me.id, "UTC", now)).find(
    (c) => c.entity_id === candidate.entity_id,
  )!;
  assert.equal(changed.category, "due");
  assert.equal(changed.key, candidate.key);
  assert.equal(await postReminderNudge(me.id, "UTC", changed, now), false);
});

test("goal, exam, mentioned comment and missed habit candidates are personal and respect source state", async () => {
  const me = await person();
  const other = await person();
  const goal = (
    await pool.query(
      "INSERT INTO goals(user_id,title,target_date) VALUES($1,'Goal deadline','2050-01-04') RETURNING id",
      [me.id],
    )
  ).rows[0].id;
  const exam = (
    await pool.query(
      "INSERT INTO study_exams(user_id,exam_key,title,starts_at,own) VALUES($1,'own:nudge-exam','Exam deadline','2050-01-04T12:00:00Z',true) RETURNING id",
      [me.id],
    )
  ).rows[0].id;
  const doc = (
    await pool.query(
      "INSERT INTO docs(user_id,title) VALUES($1,'Mentioned page') RETURNING id",
      [me.id],
    )
  ).rows[0].id;
  const comment = (
    await pool.query(
      "INSERT INTO doc_comments(doc_id,user_id,body,created_at) VALUES($1,$2,'Needs attention','2049-12-30T12:00:00Z') RETURNING id",
      [doc, other.id],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO doc_comment_mentions(comment_id,user_id) VALUES($1,$2)",
    [comment, me.id],
  );
  const habit = (
    await pool.query(
      "INSERT INTO habits(user_id,name,cadence,duration_minutes,created_at) VALUES($1,'Read',1,30,'2050-01-02T00:00:00Z') RETURNING id",
      [me.id],
    )
  ).rows[0].id;
  const block = (
    await pool.query(
      "INSERT INTO habit_blocks(user_id,habit_id,start_at,end_at) VALUES($1,$2,'2050-01-02T09:00:00Z','2050-01-02T09:30:00Z') RETURNING id",
      [me.id, habit],
    )
  ).rows[0].id;
  const candidates = await reminderNudgeCandidates(me.id, "UTC", now);
  for (const id of [goal, exam, comment, habit])
    assert.ok(
      candidates.some((c) => c.entity_id === id),
      id,
    );
  assert.equal(candidates.find((c) => c.entity_id === habit)!.source_id, block);
  assert.equal(candidates.find((c) => c.entity_id === comment)!.source_id, doc);
  assert.equal(
    candidates.find((c) => c.entity_id === exam)!.exam_key,
    "own:nudge-exam",
  );
  const strangers = await reminderNudgeCandidates(other.id, "UTC", now);
  assert.ok(
    strangers.every((c) => ![goal, exam, comment, habit].includes(c.entity_id)),
  );
  await pool.query("UPDATE goals SET status='paused' WHERE id=$1", [goal]);
  await pool.query("UPDATE doc_comments SET resolved_at=now() WHERE id=$1", [
    comment,
  ]);
  await pool.query("UPDATE habit_blocks SET outcome='done' WHERE id=$1", [
    block,
  ]);
  const after = await reminderNudgeCandidates(me.id, "UTC", now);
  assert.ok(after.every((c) => ![goal, comment, habit].includes(c.entity_id)));
});
test("kept-out exam decks and goal plans never become reminder candidates", async () => {
  const me = await person();
  const project = (
    await pool.query(
      "INSERT INTO projects(user_id,name,assistant_off) VALUES($1,'Private',true) RETURNING id",
      [me.id],
    )
  ).rows[0].id;
  const doc = (
    await pool.query(
      "INSERT INTO docs(user_id,title,project_id) VALUES($1,'Private notes',$2) RETURNING id",
      [me.id, project],
    )
  ).rows[0].id;
  const goal = (
    await pool.query(
      "INSERT INTO goals(user_id,title,target_date,plan_doc_id) VALUES($1,'Private goal','2050-01-04',$2) RETURNING id",
      [me.id, doc],
    )
  ).rows[0].id;
  const exam = (
    await pool.query(
      "INSERT INTO study_exams(user_id,exam_key,title,starts_at,doc_ids,own) VALUES($1,'own:private','Private exam','2050-01-04T12:00:00Z',$2,true) RETURNING id",
      [me.id, [doc]],
    )
  ).rows[0].id;
  assert.ok(
    (await reminderNudgeCandidates(me.id, "UTC", now)).every(
      (c) => ![goal, exam].includes(c.entity_id),
    ),
  );
});

test("missed habit periods include unbooked targets and old check-ins, without nudging new or completed habits", async () => {
  const me = await person();
  const other = await person();
  const at = new Date("2026-09-28T15:00:00Z"); // Monday after a completed weekly period.
  const habit = async (
    name: string,
    period: string,
    cadence = 1,
    created = "2026-09-01T00:00:00Z",
    user = me.id,
  ) =>
    (
      await pool.query(
        `INSERT INTO habits(user_id,name,period,cadence,duration_minutes,days,created_at)
      VALUES($1,$2,$3,$4,30,ARRAY[1,2,3,4,5]::smallint[],$5) RETURNING id`,
        [user, name, period, cadence, created],
      )
    ).rows[0].id;
  const daily = await habit("Unbooked weekdays", "day");
  const weekly = await habit("Two weekly sessions", "week", 2);
  const checked = await habit("Completed week", "week", 2);
  const fresh = await habit("Just started", "day", 1, "2026-09-28T00:00:00Z");
  const foreign = await habit(
    "Someone else",
    "week",
    1,
    "2026-09-01T00:00:00Z",
    other.id,
  );
  const paused = await habit("Paused habit", "day");
  await pool.query("UPDATE habits SET active=false WHERE id=$1", [paused]);
  const block = (
    await pool.query(
      `INSERT INTO habit_blocks(user_id,habit_id,start_at,end_at)
    VALUES($1,$2,'2026-09-24T09:00:00Z','2026-09-24T09:30:00Z') RETURNING id`,
      [me.id, weekly],
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO habit_blocks(user_id,habit_id,start_at,end_at,outcome)
    SELECT $1,$2,day,day+interval '30 minutes','done'
    FROM unnest(ARRAY['2026-09-21T09:00:00Z'::timestamptz,'2026-09-22T09:00:00Z'::timestamptz]) day`,
    [me.id, checked],
  );
  const cards = await reminderNudgeCandidates(me.id, "UTC", at);
  assert.deepEqual(cards.find((c) => c.entity_id === daily)?.actions, [
    "skip",
    "book",
  ]);
  assert.match(
    cards.find((c) => c.entity_id === daily)!.text,
    /0 of 1.*last scheduled day/,
  );
  assert.equal(cards.find((c) => c.entity_id === weekly)?.source_id, block);
  assert.deepEqual(cards.find((c) => c.entity_id === weekly)?.actions, [
    "done",
    "skip",
    "book",
  ]);
  assert.ok(
    cards.every(
      (c) => ![checked, fresh, foreign, paused].includes(c.entity_id),
    ),
  );
  await pool.query("UPDATE habit_blocks SET outcome='done' WHERE id=$1", [
    block,
  ]);
  assert.match(
    (await reminderNudgeCandidates(me.id, "UTC", at)).find(
      (c) => c.entity_id === weekly,
    )!.text,
    /1 of 2/,
  );
  await pool.query(
    `INSERT INTO habit_blocks(user_id,habit_id,start_at,end_at,outcome)
    VALUES($1,$2,'2026-09-25T09:00:00Z','2026-09-25T09:30:00Z','done')`,
    [me.id, weekly],
  );
  assert.ok(
    (await reminderNudgeCandidates(me.id, "UTC", at)).every(
      (c) => c.entity_id !== weekly,
    ),
  );
});

test("missed weekly habits use the local period boundary across Melbourne DST", async () => {
  const me = await person();
  const habit = (
    await pool.query(
      `INSERT INTO habits(user_id,name,cadence,period,duration_minutes,created_at)
    VALUES($1,'DST weekly target',1,'week',30,'2026-09-01T00:00:00Z') RETURNING id`,
      [me.id],
    )
  ).rows[0].id;
  // Monday at 00:30 after the spring transition belongs to the new local week.
  await pool.query(
    `INSERT INTO habit_blocks(user_id,habit_id,start_at,end_at,outcome)
    VALUES($1,$2,'2026-10-04T13:30:00Z','2026-10-04T14:00:00Z','done')`,
    [me.id, habit],
  );
  const at = new Date("2026-10-05T12:00:00Z");
  assert.ok(
    (await reminderNudgeCandidates(me.id, "UTC", at)).every(
      (c) => c.entity_id !== habit,
    ),
  );
  assert.match(
    (await reminderNudgeCandidates(me.id, "Australia/Melbourne", at)).find(
      (c) => c.entity_id === habit,
    )!.text,
    /0 of 1.*last week/,
  );
});

test("calendar exams get stable Study identities, respect kept-out projects and disappear with their source", async () => {
  const me = await person(false);
  const other = await person();
  const sub = (
    await pool.query(
      `INSERT INTO calendar_subscriptions(user_id,url,name,kind,busy,last_fetched_at)
    VALUES($1,$2,'Exam feed','exams',true,now()) RETURNING id`,
      [me.id, `https://example.test/${randomUUID()}.ics`],
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO external_events(subscription_id,uid,title,starts_at,ends_at,timezone)
    VALUES($1,'exam','Algorithms final exam','2050-01-04T09:00:00Z','2050-01-04T12:00:00Z','UTC')`,
    [sub],
  );
  const project = (
    await pool.query(
      "INSERT INTO projects(user_id,name,assistant_off) VALUES($1,'Private exam project',true) RETURNING id",
      [me.id],
    )
  ).rows[0].id;
  const hidden = (
    await pool.query(
      `INSERT INTO items(user_id,title,kind,due_at,end_at,project_id)
    VALUES($1,'Private final exam','event','2050-01-05T09:00:00Z','2050-01-05T10:00:00Z',$2) RETURNING id`,
      [me.id, project],
    )
  ).rows[0].id;
  const visible = (
    await pool.query(
      `INSERT INTO items(user_id,title,kind,due_at,end_at)
    VALUES($1,'Physics final exam','event','2050-01-05T09:00:00Z','2050-01-05T10:00:00Z') RETURNING id`,
      [me.id],
    )
  ).rows[0].id;
  const candidates = await reminderNudgeCandidates(me.id, "UTC", now);
  const exam = candidates.find((c) =>
    c.text.includes("Algorithms final exam"),
  )!;
  assert.ok(exam);
  assert.ok(candidates.some((c) => c.exam_key?.startsWith(`item:${visible}|`)));
  assert.ok(
    candidates.every((c) => !c.exam_key?.startsWith(`item:${hidden}|`)),
  );
  assert.ok(
    (await reminderNudgeCandidates(other.id, "UTC", now)).every(
      (c) => c.entity_id !== exam.entity_id,
    ),
  );
  const doc = (
    await pool.query(
      "INSERT INTO docs(user_id,title,content) VALUES($1,'Exam notes','[]'::jsonb) RETURNING id",
      [me.id],
    )
  ).rows[0].id;
  await pool.query(
    "UPDATE study_exams SET doc_ids=ARRAY[$2::uuid],target='Pass comfortably' WHERE id=$1",
    [exam.entity_id, doc],
  );
  assert.equal(await postReminderNudge(me.id, "UTC", exam, now), true);
  const ledger = (
    await pool.query(
      "SELECT id FROM assistant_nudges WHERE user_id=$1 AND entity_id=$2",
      [me.id, exam.entity_id],
    )
  ).rows[0];
  await pool.query("UPDATE assistant_nudges SET stopped=true WHERE id=$1", [
    ledger.id,
  ]);
  await pool.query(
    "UPDATE external_events SET title='Renamed algorithms exam' WHERE subscription_id=$1 AND uid='exam'",
    [sub],
  );
  const renamed = (await reminderNudgeCandidates(me.id, "UTC", now)).find(
    (c) => c.entity_id === exam.entity_id,
  )!;
  assert.match(renamed.text, /Renamed algorithms exam/);
  assert.equal(renamed.exam_key, exam.exam_key);
  const row = (
    await pool.query("SELECT doc_ids,target FROM study_exams WHERE id=$1", [
      exam.entity_id,
    ])
  ).rows[0];
  assert.deepEqual(row.doc_ids, [doc]);
  assert.equal(row.target, "Pass comfortably");
  assert.equal(
    await postReminderNudge(
      me.id,
      "UTC",
      renamed,
      new Date(now.getTime() + 86400000),
    ),
    false,
  );
  await pool.query(
    "DELETE FROM external_events WHERE subscription_id=$1 AND uid='exam'",
    [sub],
  );
  assert.ok(
    (await reminderNudgeCandidates(me.id, "UTC", now)).every(
      (c) => c.entity_id !== exam.entity_id,
    ),
  );
  // Even an unstopped queued notice is stale after its source disappears.
  await pool.query("UPDATE assistant_nudges SET stopped=false WHERE id=$1", [
    ledger.id,
  ]);
  assert.equal(
    await transaction((db) =>
      reminderNudgeStale(
        db,
        { user_id: me.id, ref: `nudge:${ledger.id}`, channel: "email" },
        now,
      ),
    ),
    true,
  );
});

test("waiting reminders stop exposing chats when their project is kept out or no longer visible", async () => {
  const me = await person();
  const other = await person();
  const project = (
    await pool.query(
      "INSERT INTO projects(user_id,name) VALUES($1,'Waiting project') RETURNING id",
      [me.id],
    )
  ).rows[0].id;
  const chat = (
    await pool.query(
      "INSERT INTO ai_chats(user_id,project_id,id,title,turns) VALUES($1,$2,$3,'Private waiting request','[]') RETURNING id",
      [me.id, project, randomUUID()],
    )
  ).rows[0].id;
  const job = (
    await pool.query(
      "INSERT INTO ai_jobs(user_id,chat_id,state,heartbeat_at) VALUES($1,$2,'waiting',$3) RETURNING id",
      [me.id, chat, new Date(now.getTime() - 4 * 60 * 60_000)],
    )
  ).rows[0].id;
  const candidate = (await reminderNudgeCandidates(me.id, "UTC", now)).find(
    (c) => c.entity_id === job,
  );
  assert.ok(candidate);
  await pool.query("UPDATE projects SET assistant_off=true WHERE id=$1", [
    project,
  ]);
  assert.ok(
    !(await reminderNudgeCandidates(me.id, "UTC", now)).some(
      (c) => c.entity_id === job,
    ),
  );
  assert.equal(await postReminderNudge(me.id, "UTC", candidate, now), false);
  await pool.query(
    "UPDATE projects SET assistant_off=false,user_id=$2 WHERE id=$1",
    [project, other.id],
  );
  assert.ok(
    !(await reminderNudgeCandidates(me.id, "UTC", now)).some(
      (c) => c.entity_id === job,
    ),
  );
  await pool.query("UPDATE projects SET user_id=$2 WHERE id=$1", [
    project,
    me.id,
  ]);
  assert.ok(
    (await reminderNudgeCandidates(me.id, "UTC", now)).some(
      (c) => c.entity_id === job,
    ),
  );
});
