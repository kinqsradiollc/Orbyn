import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import "./setup.js";
import { helpers } from "./mcp-helpers.js";
import {
  OrbynClient,
  performLocalReminderAction as performReminderAction,
} from "@orbyn/api-client";
import type { ReminderNudgeCard } from "@orbyn/core";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { reminderNudgeCandidates } =
  await import("../src/worker/reminder-nudges.js");
const { buildApp } = await import("../src/app.js");
const app = await buildApp();
const h = helpers(app);
const users: string[] = [];
before(async () => {
  await migrate();
});
after(async () => {
  await app.close();
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [users]);
  await pool.end();
});
async function fixture() {
  const me = await h.register("nudge-actions");
  users.push(me.id);
  const response = await h.call(me.token, "POST", "/items", {
    title: "Action task",
    kind: "task",
    status: "todo",
    priority: "medium",
    due_at: "2050-01-10T17:00:00Z",
    estimate_minutes: 30,
  });
  assert.equal(response.statusCode, 201, response.body);
  const item = response.json();
  const client = new OrbynClient({
    baseUrl: "http://orbyn.test",
    getToken: () => me.token,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const headers = Object.fromEntries(new Headers(init?.headers));
      const result = await app.inject({
        method: init?.method ?? "GET",
        url: url.pathname + url.search,
        headers,
        ...(init?.body ? { payload: String(init.body) } : {}),
      });
      return new Response(result.body || null, {
        status: result.statusCode,
        headers: result.headers as Record<string, string>,
      });
    },
  });
  const card: ReminderNudgeCard = {
    id: randomUUID(),
    key: `task:${item.id}`,
    entity_kind: "task",
    entity_id: item.id,
    actions: ["done", "move", "skip", "book"],
  };
  return { me, item, card, client };
}
test("Done and Move use normal item writes and Undo preserves the original task", async () => {
  const { item, card, client } = await fixture();
  const done = await performReminderAction(client, card, "done");
  assert.equal((await client.getItem(item.id)).status, "done");
  await done.undo();
  assert.equal((await client.getItem(item.id)).status, "todo");
  const moved = await performReminderAction(client, card, "move", {
    day: "2050-01-09",
  });
  assert.equal(
    (await client.getItem(item.id)).due_at,
    "2050-01-09T17:00:00.000Z",
  );
  await moved.undo();
  assert.equal(
    new Date((await client.getItem(item.id)).due_at!).toISOString(),
    "2050-01-10T17:00:00.000Z",
  );
});
test("Undo refuses to overwrite a later item edit", async () => {
  const { item, card, client } = await fixture();
  const receipt = await performReminderAction(client, card, "done");
  const current = await client.getItem(item.id);
  const { itemBody } = await import("@orbyn/core");
  await client.updateItem(item.id, {
    ...itemBody(current),
    title: "Edited later",
  });
  await assert.rejects(receipt.undo(), { statusCode: 409 });
  assert.equal((await client.getItem(item.id)).title, "Edited later");
});
test("Book time creates a real free working session and Undo removes it", async () => {
  const { item, card, client } = await fixture();
  const day = new Date("2050-01-03T12:00:00Z");
  while ([0, 6].includes(day.getUTCDay())) day.setUTCDate(day.getUTCDate() + 1);
  const receipt = await performReminderAction(client, card, "book", {
    day: day.toISOString().slice(0, 10),
    minutes: 45,
  });
  const sessions = (await client.itemSessions(item.id)).sessions;
  assert.equal(sessions.length, 1);
  assert.equal(
    (Date.parse(sessions[0].end_at) - Date.parse(sessions[0].start_at)) / 60000,
    45,
  );
  await receipt.undo();
  assert.equal((await client.itemSessions(item.id)).sessions.length, 0);
});
test("Skip updates only the saved reminder turn and Undo restores it without editing work", async () => {
  const { item, card, client, me } = await fixture();
  await pool.query(
    "INSERT INTO assistant_nudges(id,user_id,nudge_key,entity_kind,entity_id,local_day) VALUES($1,$2,$3,'task',$4,'2050-01-02')",
    [card.id, me.id, card.key, card.entity_id],
  );
  const chatId = randomUUID();
  await pool.query(
    `INSERT INTO ai_chats(id, user_id, title, origin, turns) VALUES($1, $2, 'Reminders', 'reminders', $3)`,
    [
      chatId,
      me.id,
      JSON.stringify([
        {
          role: "assistant",
          turn_id: card.id,
          text: "Task reminder",
          outcome: "info",
          nudge: card,
        },
      ]),
    ],
  );
  const receipt = await performReminderAction(client, card, "skip", {
    chatId,
    turnId: card.id,
  });
  assert.equal((await client.aiChat(chatId)).turns[0].outcome, "discarded");
  assert.equal((await client.getItem(item.id)).status, "todo");
  await receipt.undo();
  assert.equal((await client.aiChat(chatId)).turns[0].outcome, "info");
});

test("promise actions update the existing record and Undo restores it", async () => {
  const { client, card } = await fixture();
  const record = await client.createWorkRecord({
    kind: "promise",
    title: "Promise to test",
    due_at: "2050-01-10T17:00:00Z",
  });
  const promise = {
    ...card,
    entity_kind: "record" as const,
    entity_id: record.id,
    actions: ["done", "move", "skip"] as ReminderNudgeCard["actions"],
  };
  const done = await performReminderAction(client, promise, "done");
  assert.equal((await client.getWorkRecord(record.id)).status, "done");
  await done.undo();
  assert.equal((await client.getWorkRecord(record.id)).status, record.status);
  const moved = await performReminderAction(client, promise, "move", {
    day: "2050-01-09",
  });
  assert.equal(
    new Date((await client.getWorkRecord(record.id)).due_at!).toISOString(),
    "2050-01-09T17:00:00.000Z",
  );
  await moved.undo();
  assert.equal((await client.getWorkRecord(record.id)).due_at, record.due_at);
});
test("a started booked session cannot be removed by reminder Undo", async () => {
  const { client, card, item } = await fixture();
  const receipt = await performReminderAction(client, card, "book", {
    day: "2050-01-03",
    minutes: 30,
  });
  const block = (await client.itemSessions(item.id)).sessions[0];
  await pool.query("UPDATE time_blocks SET started_at = now() WHERE id = $1", [
    block.id,
  ]);
  await assert.rejects(receipt.undo(), { statusCode: 409 });
  assert.equal((await client.itemSessions(item.id)).sessions.length, 1);
});
test("invalid days and unavailable choices fail without changing work", async () => {
  const { client, card, item } = await fixture();
  await assert.rejects(
    performReminderAction(client, card, "move", { day: "2050-02-30" }),
    { statusCode: 422 },
  );
  await assert.rejects(
    performReminderAction(client, { ...card, actions: ["skip"] }, "done"),
    { statusCode: 422 },
  );
  assert.equal((await client.getItem(item.id)).status, "todo");
});

test("Move preserves all-day midnight boundaries over Melbourne DST", async () => {
  const { client, card, item } = await fixture();
  const { itemBody } = await import("@orbyn/core");
  const before = await client.updateItem(item.id, {
    ...itemBody(await client.getItem(item.id)),
    timezone: "Australia/Melbourne",
    all_day: true,
    due_at: "2026-10-02T14:00:00Z",
    end_at: "2026-10-03T14:00:00Z",
  });
  const moved = await performReminderAction(client, card, "move", {
    day: "2026-10-04",
  });
  const after = await client.getItem(item.id);
  assert.equal(
    new Date(after.due_at!).toISOString(),
    "2026-10-03T14:00:00.000Z",
  );
  assert.equal(
    new Date(after.end_at!).toISOString(),
    "2026-10-04T13:00:00.000Z",
  );
  await moved.undo();
  assert.equal((await client.getItem(item.id)).due_at, before.due_at);
});
test("routine Move uses the existing routine endpoint and Undo restores the next run", async () => {
  const { client, card } = await fixture();
  const routine = await client.createAgentRoutine({
    instruction: "Review my week",
    rrule: "FREQ=WEEKLY;BYDAY=FR",
    timezone: "UTC",
    next_run_at: "2050-01-07T17:00:00Z",
  });
  const routineCard = {
    ...card,
    entity_kind: "routine" as const,
    entity_id: routine.id,
    actions: ["move", "skip"] as ReminderNudgeCard["actions"],
  };
  const receipt = await performReminderAction(client, routineCard, "move", {
    day: "2050-01-08",
  });
  assert.equal(
    new Date(
      (await client.listAgentRoutines()).find((r) => r.id === routine.id)!
        .next_run_at,
    ).toISOString(),
    "2050-01-08T17:00:00.000Z",
  );
  await receipt.undo();
  assert.equal(
    (await client.listAgentRoutines()).find((r) => r.id === routine.id)!
      .next_run_at,
    routine.next_run_at,
  );
});

test("ordinary action endpoints enforce sign-in, team write access, valid JSON and rate limits", async () => {
  const { client, item, me, card } = await fixture();
  const viewer = await h.register("nudge-viewer");
  users.push(viewer.id);
  assert.equal(
    (await h.call(null, "PUT", `/items/${item.id}`, {})).statusCode,
    401,
  );
  const team = await h.team(me, "Reminder team", [[viewer, "viewer"]]);
  const { itemBody } = await import("@orbyn/core");
  const moved = await client.updateItem(item.id, {
    ...itemBody(await client.getItem(item.id)),
    team_id: team,
  });
  assert.equal(
    (
      await h.call(viewer.token, "PUT", `/items/${item.id}`, {
        ...itemBody(moved),
        status: "done",
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "PUT",
        url: `/items/${item.id}`,
        headers: {
          authorization: `Bearer ${me.token}`,
          "content-type": "application/json",
        },
        payload: "{",
      })
    ).statusCode,
    400,
  );
  const statuses: number[] = [];
  for (let n = 0; n < 31; n++)
    statuses.push(
      (
        await app.inject({
          method: "POST",
          url: `/me/assistant/reminder-nudges/${card.id}/stop`,
          headers: { authorization: `Bearer ${me.token}` },
          remoteAddress: "10.98.4.3",
        })
      ).statusCode,
    );
  assert.ok(statuses.includes(429));
});

test("goal Done and Move use ordinary goal writes and restore through Undo", async () => {
  const { client, card } = await fixture();
  const goal = await client.createGoal({
    title: "Goal action test",
    target_date: "2050-01-10",
  });
  const goalCard = {
    ...card,
    entity_kind: "goal" as const,
    entity_id: goal.id,
    actions: ["done", "move", "skip"] as ReminderNudgeCard["actions"],
  };
  const done = await performReminderAction(client, goalCard, "done");
  assert.equal(
    (await client.listGoals()).find((g) => g.id === goal.id)!.status,
    "done",
  );
  await done.undo();
  const moved = await performReminderAction(client, goalCard, "move", {
    day: "2050-01-09",
  });
  assert.equal(
    (await client.listGoals()).find((g) => g.id === goal.id)!.target_date,
    "2050-01-09",
  );
  await moved.undo();
  assert.equal(
    (await client.listGoals()).find((g) => g.id === goal.id)!.target_date,
    goal.target_date,
  );
});
test("comment Done resolves the existing thread and Undo restores it", async () => {
  const { client, card, me } = await fixture();
  const doc = (
    await pool.query(
      "INSERT INTO docs(user_id,title) VALUES($1,'Comment action') RETURNING id",
      [me.id],
    )
  ).rows[0].id;
  const comment = (
    await pool.query(
      "INSERT INTO doc_comments(doc_id,user_id,body) VALUES($1,$2,'Comment action') RETURNING id",
      [doc, me.id],
    )
  ).rows[0].id;
  const commentCard = {
    ...card,
    entity_kind: "comment" as const,
    entity_id: comment,
    source_id: doc,
    actions: ["done", "skip"] as ReminderNudgeCard["actions"],
  };
  const receipt = await performReminderAction(client, commentCard, "done");
  assert.ok(
    (await client.listDocComments(doc)).find((c) => c.id === comment)!
      .resolved_at,
  );
  await receipt.undo();
  assert.equal(
    (await client.listDocComments(doc)).find((c) => c.id === comment)!
      .resolved_at,
    null,
  );
});
test("habit Done records a real check-in with optimistic Undo and enforces the API shield", async () => {
  const { client, card, me } = await fixture();
  const other = await h.register("habit-other");
  users.push(other.id);
  const habit = (
    await pool.query(
      "INSERT INTO habits(user_id,name,cadence,duration_minutes) VALUES($1,'Habit action',1,30) RETURNING id",
      [me.id],
    )
  ).rows[0].id;
  const block = (
    await pool.query(
      "INSERT INTO habit_blocks(user_id,habit_id,start_at,end_at) VALUES($1,$2,now()-interval '1 hour',now()-interval '30 minutes') RETURNING id",
      [me.id, habit],
    )
  ).rows[0].id;
  const habitCard = {
    ...card,
    entity_kind: "habit" as const,
    entity_id: habit,
    source_id: block,
    actions: ["done", "skip"] as ReminderNudgeCard["actions"],
  };
  const receipt = await performReminderAction(client, habitCard, "done");
  assert.equal((await client.getHabitBlock(block)).outcome, "done");
  await receipt.undo();
  assert.equal((await client.getHabitBlock(block)).outcome, null);
  const current = await client.getHabitBlock(block);
  const again = await performReminderAction(client, habitCard, "done");
  const changed = await client.getHabitBlock(block);
  await client.checkInHabitBlock(block, {
    outcome: "skipped",
    version: changed.version,
  });
  await assert.rejects(again.undo(), { statusCode: 409 });
  const url = `/planner/habits/blocks/${block}/check-in`;
  assert.equal(
    (
      await h.call(null, "POST", url, {
        outcome: "done",
        version: current.version,
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await h.call(other.token, "POST", url, {
        outcome: "done",
        version: current.version,
      })
    ).statusCode,
    404,
  );
  const readKey = {
    key: (
      await h.call(me.token, "POST", "/me/api-keys", { name: "Habit check-in" })
    ).json().key,
  };
  assert.equal(
    (
      await h.call(readKey.key, "POST", url, {
        outcome: "done",
        version: current.version,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url,
        headers: {
          authorization: `Bearer ${me.token}`,
          "content-type": "application/json",
        },
        payload: "{",
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (await h.call(me.token, "POST", url, { outcome: "unknown", version: 1 }))
      .statusCode,
    422,
  );
  const statuses: number[] = [];
  for (let n = 0; n < 31; n++)
    statuses.push(
      (
        await app.inject({
          method: "POST",
          url,
          headers: { authorization: `Bearer ${me.token}` },
          payload: { outcome: "done", version: current.version },
          remoteAddress: "10.98.4.4",
        })
      ).statusCode,
    );
  assert.ok(statuses.includes(429));
});
test("exam Book uses the non-AI revision planner and Undo removes its untouched work", async () => {
  const { client, card, me } = await fixture();
  const day = new Date();
  day.setUTCDate(day.getUTCDate() + 1);
  day.setUTCHours(12, 0, 0, 0);
  while ([0, 6].includes(day.getUTCDay())) day.setUTCDate(day.getUTCDate() + 1);
  const starts = new Date(day);
  starts.setUTCDate(starts.getUTCDate() + 5);
  const key = `own:${randomUUID()}`;
  const exam = (
    await pool.query(
      "INSERT INTO study_exams(user_id,exam_key,title,starts_at,own) VALUES($1,$2,'Exam action',$3,true) RETURNING id",
      [me.id, key, starts],
    )
  ).rows[0].id;
  const examCard = {
    ...card,
    entity_kind: "exam" as const,
    entity_id: exam,
    exam_key: key,
    actions: ["skip", "book"] as ReminderNudgeCard["actions"],
  };
  const receipt = await performReminderAction(client, examCard, "book", {
    day: day.toISOString().slice(0, 10),
    minutes: 30,
  });
  assert.equal(
    (
      await pool.query(
        "SELECT study_exam_id FROM items WHERE user_id=$1 AND title='Revise for Exam action'",
        [me.id],
      )
    ).rows[0].study_exam_id,
    exam,
  );
  await pool.query(
    "UPDATE study_exams SET title='Renamed exam action' WHERE id=$1",
    [exam],
  );
  assert.ok(
    (await reminderNudgeCandidates(me.id, "UTC")).every(
      (c) => c.entity_id !== exam,
    ),
    "renaming the exam preserves its booked revision time",
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM items WHERE user_id=$1 AND title='Revise for Exam action'",
        [me.id],
      )
    ).rows[0].n,
    1,
  );
  await receipt.undo();
  assert.ok(
    (await reminderNudgeCandidates(me.id, "UTC")).some(
      (c) => c.entity_id === exam,
    ),
    "undoing the booking makes the unbooked exam eligible again",
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM items WHERE user_id=$1 AND title='Revise for Exam action'",
        [me.id],
      )
    ).rows[0].n,
    0,
  );
});

test("partial goal and routine updates contain only the fields the person sent", async () => {
  const { goalUpdate, agentRoutineUpdate } = await import("@orbyn/core");
  assert.deepEqual(goalUpdate.parse({ status: "done" }), { status: "done" });
  assert.deepEqual(goalUpdate.parse({ target_date: "2050-01-08" }), {
    target_date: "2050-01-08",
  });
  assert.deepEqual(
    agentRoutineUpdate.parse({ next_run_at: "2050-01-08T06:00:00Z" }),
    { next_run_at: "2050-01-08T06:00:00Z" },
  );
});

test("habit Book follows its saved schedule and guarded Undo refuses an answered session", async () => {
  const { me, client, card } = await fixture();
  const habit = (
    await pool.query(
      "INSERT INTO habits(user_id,name,cadence,duration_minutes,days,window_start,window_end) VALUES($1,'Book habit',1,45,ARRAY[0,1,2,3,4,5,6],'08:00','17:00') RETURNING id",
      [me.id],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO habits(user_id,name,cadence,duration_minutes,days,window_start,window_end,position) VALUES($1,'Other habit',1,45,ARRAY[0,1,2,3,4,5,6],'08:00','17:00',-1)",
    [me.id],
  );
  const targeted = await client.planHabits({
    start_date: "2050-01-11",
    days: 1,
    habit_ids: [habit],
  });
  assert.ok(targeted.blocks.length > 0);
  assert.ok(targeted.blocks.every((block) => block.habit_id === habit));
  await assert.rejects(
    () => client.planHabits({ days: 1, habit_ids: [randomUUID()] }),
    (error: any) => error.status === 404,
  );
  const habitCard = {
    ...card,
    entity_kind: "habit" as const,
    entity_id: habit,
    actions: ["book"] as ReminderNudgeCard["actions"],
  };
  const receipt = await performReminderAction(client, habitCard, "book", {
    day: "2050-01-11",
  });
  const session = (
    await pool.query("SELECT * FROM habit_blocks WHERE habit_id=$1", [habit])
  ).rows[0];
  assert.equal(
    (session.end_at.getTime() - session.start_at.getTime()) / 60_000,
    45,
  );
  await receipt.undo();
  assert.equal(
    (await pool.query("SELECT 1 FROM habit_blocks WHERE habit_id=$1", [habit]))
      .rowCount,
    0,
  );
  const again = await performReminderAction(client, habitCard, "book", {
    day: "2050-01-11",
  });
  const current = (
    await pool.query("SELECT * FROM habit_blocks WHERE habit_id=$1", [habit])
  ).rows[0];
  await client.checkInHabitBlock(current.id, {
    outcome: "done",
    version: current.version,
  });
  await assert.rejects(
    () => again.undo(),
    (error: any) => error.status === 409,
  );
  assert.equal(
    (
      await pool.query("SELECT outcome FROM habit_blocks WHERE id=$1", [
        current.id,
      ])
    ).rows[0].outcome,
    "done",
  );
});

test("goal Book selects current linked unfinished work and Undo removes only its session", async () => {
  const { me, client, item, card } = await fixture();
  const project = await client.createProject({ name: "Goal booking project" });
  await pool.query(
    "UPDATE items SET project_id=$2,estimate_minutes=45 WHERE id=$1",
    [item.id, project.id],
  );
  const goal = await client.createGoal({
    title: "Book goal work",
    project_id: project.id,
    target_date: "2050-01-12",
  });
  const goalCard: ReminderNudgeCard = {
    ...card,
    entity_kind: "goal",
    entity_id: goal.id,
    actions: ["book"],
  };
  const unauthenticated = await app.inject({
    method: "GET",
    url: `/me/goals/${goal.id}/work`,
  });
  assert.equal(unauthenticated.statusCode, 401);
  const stranger = await h.register("goal-book-stranger");
  users.push(stranger.id);
  assert.equal(
    (await h.call(stranger.token, "GET", `/me/goals/${goal.id}/work`))
      .statusCode,
    404,
  );
  assert.equal(
    (await h.call(me.token, "GET", "/me/goals/invalid/work")).statusCode,
    422,
  );
  const work = await client.goalWork(goal.id);
  assert.deepEqual(
    work.map((task) => task.id),
    [item.id],
  );
  const receipt = await performReminderAction(client, goalCard, "book", {
    day: "2050-01-11",
    minutes: 30,
  });
  const sessions = (await client.itemSessions(item.id)).sessions;
  assert.equal(sessions.length, 1);
  assert.equal(
    (Date.parse(sessions[0].end_at) - Date.parse(sessions[0].start_at)) / 60000,
    30,
  );
  assert.equal((await client.goalWork(goal.id))[0].remaining_minutes, 15);
  await receipt.undo();
  assert.equal((await client.itemSessions(item.id)).sessions.length, 0);
  await pool.query("UPDATE items SET status='done' WHERE id=$1", [item.id]);
  assert.deepEqual(await client.goalWork(goal.id), []);
  await assert.rejects(
    () =>
      performReminderAction(client, goalCard, "book", { day: "2050-01-11" }),
    (error: any) => error.status === 409,
  );
  await pool.query("UPDATE projects SET assistant_off=true WHERE id=$1", [
    project.id,
  ]);
  await assert.rejects(
    () => client.goalWork(goal.id),
    (error: any) => error.status === 404,
  );
});

test("session Undo rejects an edit inserted after its client precheck", async () => {
  const { client, card, item } = await fixture();
  const receipt = await performReminderAction(client, card, "book", {
    day: "2050-01-03",
  });
  const block = (await client.itemSessions(item.id)).sessions[0];
  const remove = client.deleteBlock.bind(client);
  client.deleteBlock = async (id, revision) => {
    await pool.query("UPDATE time_blocks SET outcome='done' WHERE id=$1", [id]);
    return remove(id, revision);
  };
  await assert.rejects(receipt.undo(), { statusCode: 409 });
  assert.equal(
    (
      await pool.query("SELECT outcome FROM time_blocks WHERE id=$1", [
        block.id,
      ])
    ).rows[0].outcome,
    "done",
  );
});

test("routine and goal Undo reject edits inserted after their client prechecks", async () => {
  const { client, card } = await fixture();
  const routine = await client.createAgentRoutine({
    instruction: "Original routine",
    rrule: "FREQ=DAILY",
    timezone: "UTC",
    next_run_at: "2050-01-08T12:00:00Z",
  });
  const moved = await performReminderAction(
    client,
    {
      ...card,
      entity_kind: "routine",
      entity_id: routine.id,
      actions: ["move"],
    },
    "move",
    { day: "2050-01-09" },
  );
  const saveRoutine = client.updateAgentRoutine.bind(client);
  client.updateAgentRoutine = async (id, input) => {
    // Leave updated_at unchanged to prove the server revision is the guard.
    await pool.query(
      "UPDATE agent_routines SET instruction='Concurrent routine edit' WHERE id=$1",
      [id],
    );
    return saveRoutine(id, input);
  };
  await assert.rejects(moved.undo(), { statusCode: 409 });
  const savedRoutine = (
    await pool.query(
      "SELECT instruction,next_run_at FROM agent_routines WHERE id=$1",
      [routine.id],
    )
  ).rows[0];
  assert.equal(savedRoutine.instruction, "Concurrent routine edit");
  assert.equal(
    savedRoutine.next_run_at.toISOString(),
    "2050-01-09T12:00:00.000Z",
  );
  const goal = await client.createGoal({
    title: "Original goal",
    target_date: "2050-01-10",
  });
  const done = await performReminderAction(
    client,
    { ...card, entity_kind: "goal", entity_id: goal.id, actions: ["done"] },
    "done",
  );
  const saveGoal = client.updateGoal.bind(client);
  client.updateGoal = async (id, input) => {
    await pool.query(
      "UPDATE goals SET title='Concurrent goal edit' WHERE id=$1",
      [id],
    );
    return saveGoal(id, input);
  };
  await assert.rejects(done.undo(), { statusCode: 409 });
  const savedGoal = (
    await pool.query("SELECT title,status FROM goals WHERE id=$1", [goal.id])
  ).rows[0];
  assert.equal(savedGoal.title, "Concurrent goal edit");
  assert.equal(savedGoal.status, "done");
});

test("comment Undo rejects an intervening edit even when resolution is unchanged", async () => {
  const { client, card, me } = await fixture();
  const doc = (
    await pool.query(
      "INSERT INTO docs(user_id,title) VALUES($1,'Atomic comment') RETURNING id",
      [me.id],
    )
  ).rows[0].id;
  const comment = (
    await pool.query(
      "INSERT INTO doc_comments(doc_id,user_id,body) VALUES($1,$2,'Original comment') RETURNING id",
      [doc, me.id],
    )
  ).rows[0].id;
  const receipt = await performReminderAction(
    client,
    {
      ...card,
      entity_kind: "comment",
      entity_id: comment,
      source_id: doc,
      actions: ["done"],
    },
    "done",
  );
  await pool.query(
    "UPDATE doc_comments SET body='Concurrent comment edit' WHERE id=$1",
    [comment],
  );
  await assert.rejects(receipt.undo(), { statusCode: 409 });
  const saved = (
    await pool.query("SELECT body,resolved_at FROM doc_comments WHERE id=$1", [
      comment,
    ])
  ).rows[0];
  assert.equal(saved.body, "Concurrent comment edit");
  assert.ok(saved.resolved_at);
});

test("guarded revision-task deletion preserves an intervening session edit or insertion", async () => {
  const { client, item, me } = await fixture();
  const block = await client.createBlockOnDay({
    item_id: item.id,
    day: "2050-01-03",
    minutes: 30,
  });
  assert.ok(block.revision);
  const version = (await client.getItem(item.id)).version;
  await pool.query(
    "UPDATE time_blocks SET start_at=start_at+interval '1 minute',end_at=end_at+interval '1 minute' WHERE id=$1",
    [block.id],
  );
  await assert.rejects(
    client.deleteItem(item.id, version, {
      expectedBlocks: [{ id: block.id, revision: block.revision! }],
    }),
    { statusCode: 409 },
  );
  assert.ok(
    (await pool.query("SELECT 1 FROM items WHERE id=$1", [item.id])).rowCount,
  );
  const latest = (
    await pool.query("SELECT revision FROM time_blocks WHERE id=$1", [block.id])
  ).rows[0].revision;
  await pool.query(
    "INSERT INTO time_blocks(item_id,user_id,start_at,end_at) VALUES($1,$2,'2050-01-04T10:00:00Z','2050-01-04T10:30:00Z')",
    [item.id, me.id],
  );
  await assert.rejects(
    client.deleteItem(item.id, version, {
      expectedBlocks: [{ id: block.id, revision: latest }],
    }),
    { statusCode: 409 },
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS count FROM time_blocks WHERE item_id=$1",
        [item.id],
      )
    ).rows[0].count,
    2,
  );
});
