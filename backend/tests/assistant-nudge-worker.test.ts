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
const { reminderNudgeStale } = await import("../src/worker/delivery.js");
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
  await pool.query("UPDATE assistant_nudges SET stopped = true WHERE id = $1", [
    ledger.id,
  ]);
  assert.equal(
    await transaction((db) => reminderNudgeStale(db, notice, now)),
    true,
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
      "INSERT INTO habits(user_id,name,cadence,duration_minutes) VALUES($1,'Read',1,30) RETURNING id",
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
