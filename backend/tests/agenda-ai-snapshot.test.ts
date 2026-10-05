import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { readAgendaAiDay, todaysAgenda } =
  await import("../src/modules/docs/agenda.js");
const { captureAgendaAiSnapshot, assertAgendaAiSnapshot } =
  await import("../src/modules/docs/agenda-ai-snapshot.js");
const owners: string[] = [];
const teams: string[] = [];
const now = new Date("2026-10-05T09:00:00Z");
before(async () => {
  await migrate();
});
after(async () => {
  await pool.query("DELETE FROM teams WHERE id=ANY($1::uuid[])", [teams]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [owners]);
  await pool.end();
});
async function person() {
  const id = randomUUID();
  owners.push(id);
  await pool.query(
    "INSERT INTO users(id,email,name,password_hash,email_verified) VALUES($1,$2,'Agenda snapshot','fixture',true)",
    [id, `${id}@fixture.invalid`],
  );
  return id;
}
async function task(
  owner: string,
  title: string,
  project: string | null = null,
) {
  return (
    await pool.query(
      "INSERT INTO items(user_id,title,project_id,kind,due_at) VALUES($1,$2,$3,'task',$4) RETURNING id",
      [owner, title, project, now],
    )
  ).rows[0].id as string;
}
async function event(
  owner: string,
  title: string,
  project: string | null = null,
) {
  return (
    await pool.query(
      "INSERT INTO items(user_id,title,project_id,kind,due_at,end_at) VALUES($1,$2,$3,'event','2026-10-05T10:00:00Z','2026-10-05T11:00:00Z') RETURNING id",
      [owner, title, project],
    )
  ).rows[0].id as string;
}
test("AI day excludes private titles and derived busy time while the human agenda retains them", async () => {
  const owner = await person();
  const project = (
    await pool.query(
      "INSERT INTO projects(user_id,name,assistant_off) VALUES($1,'Private project',true) RETURNING id",
      [owner],
    )
  ).rows[0].id;
  const allowed = await task(owner, "Allowed task");
  const privateTask = await task(owner, "Excluded task", project);
  await event(owner, "Excluded event", project);
  await pool.query(
    "INSERT INTO time_blocks(user_id,item_id,start_at,end_at,source) VALUES($1,$2,'2026-10-05T13:00:00Z','2026-10-05T14:00:00Z','manual')",
    [owner, privateTask],
  );
  const day = await readAgendaAiDay(owner, now);
  assert.deepEqual(
    day.items.map((i) => i.id),
    [allowed],
  );
  assert.equal(day.calendar.length, 0);
  assert.equal(day.setAside.length, 0);
  assert.equal(
    day.freeMinutes,
    null,
    "excluded busy time must not be advertised as free",
  );
  assert.deepEqual(day.aiPriorities, ["Allowed task"]);
  const ordinary = await todaysAgenda(owner, { now });
  assert.ok(JSON.stringify(ordinary).includes("Excluded task"));
  assert.ok(JSON.stringify(ordinary).includes("Excluded event"));
});
test("Snapshot retains task and event identities and rejects a revision-only task change", async () => {
  const owner = await person();
  const id = await task(owner, "Current task");
  const appointment = await event(owner, "Current event");
  const snapshot = await captureAgendaAiSnapshot(owner, now);
  assert.ok(
    snapshot.sources.some(
      (s) => s.kind === "task" && s.id === id && s.version !== undefined,
    ),
  );
  assert.ok(
    snapshot.sources.some(
      (s) =>
        s.kind === "task" && s.id === appointment && s.version !== undefined,
    ),
  );
  await assertAgendaAiSnapshot(owner, now, snapshot);
  await pool.query("UPDATE items SET version=version+1 WHERE id=$1", [id]);
  await assert.rejects(
    assertAgendaAiSnapshot(owner, now, snapshot),
    /source changed/,
  );
});
test("A changed habit name or placement invalidates the daily snapshot", async () => {
  const owner = await person();
  const habit = (
    await pool.query(
      "INSERT INTO habits(user_id,name,cadence,duration_minutes) VALUES($1,'Read',1,30) RETURNING id",
      [owner],
    )
  ).rows[0].id;
  const block = (
    await pool.query(
      "INSERT INTO habit_blocks(user_id,habit_id,start_at,end_at,source) VALUES($1,$2,'2026-10-05T12:00:00Z','2026-10-05T12:30:00Z','manual') RETURNING id",
      [owner, habit],
    )
  ).rows[0].id;
  const snapshot = await captureAgendaAiSnapshot(owner, now);
  assert.ok(snapshot.sources.some((s) => s.kind === "habit" && s.id === habit));
  await pool.query("UPDATE habits SET name='Write' WHERE id=$1", [habit]);
  await assert.rejects(
    assertAgendaAiSnapshot(owner, now, snapshot),
    /facts changed/,
  );
  const placed = await captureAgendaAiSnapshot(owner, now);
  await pool.query(
    "UPDATE habit_blocks SET start_at=start_at+interval '1 hour',end_at=end_at+interval '1 hour' WHERE id=$1",
    [block],
  );
  await assert.rejects(
    assertAgendaAiSnapshot(owner, now, placed),
    /facts changed/,
  );
});
test("Subscribed event identity/content and unsubscribe invalidate the snapshot", async () => {
  const owner = await person();
  const subscription = (
    await pool.query(
      "INSERT INTO calendar_subscriptions(user_id,url,name,busy) VALUES($1,'https://fixture.invalid/calendar','Fixture',true) RETURNING id",
      [owner],
    )
  ).rows[0].id;
  const external = (
    await pool.query(
      "INSERT INTO external_events(subscription_id,uid,title,starts_at,ends_at) VALUES($1,'fixture-event','Appointment','2026-10-05T15:00:00Z','2026-10-05T16:00:00Z') RETURNING id",
      [subscription],
    )
  ).rows[0].id;
  const snapshot = await captureAgendaAiSnapshot(owner, now);
  assert.ok(
    snapshot.sources.some(
      (s) => s.kind === "calendar" && s.id === subscription,
    ),
  );
  assert.ok(
    snapshot.references.some(
      (reference) =>
        reference.kind === "calendar_event" &&
        reference.calendarId === subscription &&
        reference.uid === "fixture-event",
    ),
  );
  assert.ok(!JSON.stringify(snapshot.facts).includes(subscription));
  assert.ok(!JSON.stringify(snapshot.facts).includes("fixture-event"));
  await pool.query(
    "UPDATE external_events SET uid='replacement-event' WHERE id=$1",
    [external],
  );
  await assert.rejects(
    assertAgendaAiSnapshot(owner, now, snapshot),
    /facts changed/,
  );
  const replaced = await captureAgendaAiSnapshot(owner, now);
  await pool.query("DELETE FROM calendar_subscriptions WHERE id=$1", [
    subscription,
  ]);
  await assert.rejects(
    assertAgendaAiSnapshot(owner, now, replaced),
    /source changed/,
  );
});
test("Planner preference changes invalidate the captured derived facts", async () => {
  const owner = await person();
  const snapshot = await captureAgendaAiSnapshot(owner, now);
  await pool.query(
    "INSERT INTO planner_prefs(user_id,work_end) VALUES($1,'16:00')",
    [owner],
  );
  await assert.rejects(
    assertAgendaAiSnapshot(owner, now, snapshot),
    /facts changed/,
  );
});

test("Even an empty daily snapshot is bound to its exact owner and captured time", async () => {
  const owner = await person();
  const foreign = await person();
  const snapshot = await captureAgendaAiSnapshot(owner, now);
  await assert.rejects(
    assertAgendaAiSnapshot(foreign, now, snapshot),
    /different owner or time/,
  );
  await assert.rejects(
    assertAgendaAiSnapshot(owner, new Date(now.getTime() + 1), snapshot),
    /different owner or time/,
  );
});

test("Team AI revocation removes task, event and time-block facts and rejects the captured snapshot", async () => {
  const owner = await person();
  const team = (
    await pool.query(
      "INSERT INTO teams(name,created_by) VALUES('Shared work',$1) RETURNING id",
      [owner],
    )
  ).rows[0].id;
  teams.push(team);
  await pool.query(
    "INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'owner') ON CONFLICT DO NOTHING",
    [team, owner],
  );
  const task = (
    await pool.query(
      "INSERT INTO items(user_id,team_id,title,kind,due_at) VALUES($1,$2,'Team task','task',$3) RETURNING id",
      [owner, team, now],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO items(user_id,team_id,title,kind,due_at,end_at) VALUES($1,$2,'Team event','event','2026-10-05T10:00:00Z','2026-10-05T11:00:00Z')",
    [owner, team],
  );
  await pool.query(
    "INSERT INTO time_blocks(user_id,item_id,start_at,end_at,source) VALUES($1,$2,'2026-10-05T13:00:00Z','2026-10-05T14:00:00Z','manual')",
    [owner, task],
  );
  const snapshot = await captureAgendaAiSnapshot(owner, now);
  assert.equal(snapshot.facts.free_minutes_left, 360);
  await pool.query("UPDATE teams SET assistant_allowed=false WHERE id=$1", [
    team,
  ]);
  await assert.rejects(
    assertAgendaAiSnapshot(owner, now, snapshot),
    /source changed/,
  );
  const hidden = await captureAgendaAiSnapshot(owner, now);
  assert.equal(hidden.facts.free_minutes_left, null);
  assert.deepEqual(hidden.facts.due_today, []);
  assert.deepEqual(hidden.facts.calendar, []);
  assert.deepEqual(hidden.facts.set_aside, []);
  assert.ok(!JSON.stringify(hidden.facts).includes("Team task"));
});
