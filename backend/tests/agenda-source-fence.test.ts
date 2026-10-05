import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { lockAgendaSources } = await import("../src/lib/agenda-source-fence.js");
const owners: string[] = [];
const teams: string[] = [];
const tables = [
  "users",
  "items",
  "item_overrides",
  "item_attendees",
  "time_blocks",
  "planner_prefs",
  "places",
  "habits",
  "habit_blocks",
  "calendar_subscriptions",
  "external_events",
  "docs",
  "study_cards",
  "study_reviews",
  "study_exams",
  "projects",
  "teams",
  "team_members",
];
before(() => migrate());
after(async () => {
  await pool.query("DELETE FROM teams WHERE id=ANY($1::uuid[])", [teams]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [owners]);
  await pool.end();
});
async function person() {
  const id = randomUUID();
  owners.push(id);
  await pool.query(
    "INSERT INTO users(id,email,password_hash,name,email_verified) VALUES($1,$2,'fixture','Fence reader',true)",
    [id, `${id}@fixture.invalid`],
  );
  return id;
}
async function fixture() {
  const owner = await person();
  const team = randomUUID(),
    item = randomUUID(),
    doc = randomUUID(),
    project = randomUUID(),
    habit = randomUUID(),
    subscription = randomUUID(),
    card = randomUUID();
  teams.push(team);
  await pool.query(
    "INSERT INTO teams(id,name,created_by) VALUES($1,'Fence',$2)",
    [team, owner],
  );
  await pool.query(
    "INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'owner')",
    [team, owner],
  );
  await pool.query(
    "INSERT INTO projects(id,user_id,team_id,name) VALUES($1,$2,$3,'Fence')",
    [project, owner, team],
  );
  await pool.query(
    "INSERT INTO items(id,user_id,team_id,project_id,title) VALUES($1,$2,$3,$4,'Fence')",
    [item, owner, team, project],
  );
  await pool.query("INSERT INTO docs(id,user_id,title) VALUES($1,$2,'Fence')", [
    doc,
    owner,
  ]);
  await pool.query(
    "INSERT INTO habits(id,user_id,name,cadence,duration_minutes) VALUES($1,$2,'Fence',1,30)",
    [habit, owner],
  );
  await pool.query(
    "INSERT INTO calendar_subscriptions(id,user_id,url,name) VALUES($1,$2,'https://fixture.invalid/calendar','Fence')",
    [subscription, owner],
  );
  await pool.query(
    "INSERT INTO study_cards(id,user_id,doc_id,card_key,question,answer) VALUES($1,$2,$3,'fence','Q','A')",
    [card, owner, doc],
  );
  const mutations: Record<string, [string, unknown[]]> = {
    users: ["UPDATE users SET name='Changed' WHERE id=$1", [owner]],
    items: ["UPDATE items SET title='Changed' WHERE id=$1", [item]],
    item_overrides: [
      "INSERT INTO item_overrides(item_id,occurrence,data) VALUES($1,now(),'{}')",
      [item],
    ],
    item_attendees: [
      "INSERT INTO item_attendees(item_id,email,token_hash,token_encrypted) VALUES($1,'fence@fixture.invalid',$2,'fixture')",
      [item, randomUUID()],
    ],
    time_blocks: [
      "INSERT INTO time_blocks(item_id,user_id,start_at,end_at) VALUES($1,$2,now(),now()+interval '30 minutes')",
      [item, owner],
    ],
    planner_prefs: [
      "INSERT INTO planner_prefs(user_id) VALUES($1) ON CONFLICT(user_id) DO UPDATE SET timezone='UTC'",
      [owner],
    ],
    places: [
      "INSERT INTO places(user_id,label,match,travel_minutes) VALUES($1,'Fence','Fence',10)",
      [owner],
    ],
    habits: ["UPDATE habits SET name='Changed' WHERE id=$1", [habit]],
    habit_blocks: [
      "INSERT INTO habit_blocks(habit_id,user_id,start_at,end_at) VALUES($1,$2,now(),now()+interval '30 minutes')",
      [habit, owner],
    ],
    calendar_subscriptions: [
      "UPDATE calendar_subscriptions SET name='Changed' WHERE id=$1",
      [subscription],
    ],
    external_events: [
      "INSERT INTO external_events(subscription_id,uid,starts_at,ends_at) VALUES($1,'fence',now(),now()+interval '30 minutes')",
      [subscription],
    ],
    docs: ["UPDATE docs SET title='Changed' WHERE id=$1", [doc]],
    study_cards: [
      "UPDATE study_cards SET answer='Changed' WHERE id=$1",
      [card],
    ],
    study_reviews: [
      "INSERT INTO study_reviews(user_id,card_id,rating) VALUES($1,$2,'good')",
      [owner, card],
    ],
    study_exams: [
      "INSERT INTO study_exams(user_id,exam_key,title,starts_at) VALUES($1,'fence','Fence',now())",
      [owner],
    ],
    projects: ["UPDATE projects SET name='Changed' WHERE id=$1", [project]],
    teams: ["UPDATE teams SET name='Changed' WHERE id=$1", [team]],
    team_members: [
      "DELETE FROM team_members WHERE team_id=$1 AND user_id=$2",
      [team, owner],
    ],
  };
  return { owner, team, item, mutations };
}
async function waitBlocked(pid: number, blocker: number) {
  const deadline = Date.now() + 2000;
  do {
    const row = (
      await pool.query(
        "SELECT wait_event, $2::int=ANY(pg_blocking_pids(pid)) AS blocked FROM pg_stat_activity WHERE pid=$1",
        [pid, blocker],
      )
    ).rows[0];
    if (row?.blocked && row.wait_event === "advisory") return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  } while (Date.now() < deadline);
  assert.fail("Source writer did not wait on the owner's advisory fence");
}
test("Agenda source fence covers the complete eighteen-table inventory", async () => {
  const rows = (
    await pool.query(
      "SELECT c.relname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE t.tgname='agenda_source_fence'",
    )
  ).rows;
  assert.deepEqual(rows.map((r) => r.relname).sort(), [...tables].sort());
});
for (const table of tables) {
  test(`Agenda source fence blocks ${table} changes until application ends`, async () => {
    const f = await fixture();
    const guard = await pool.connect(),
      writer = await pool.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await guard.query("BEGIN");
      await writer.query("BEGIN");
      await lockAgendaSources(guard, f.owner);
      const guardPid = (await guard.query("SELECT pg_backend_pid() AS pid"))
        .rows[0].pid;
      const writerPid = (await writer.query("SELECT pg_backend_pid() AS pid"))
        .rows[0].pid;
      pending = writer.query(...f.mutations[table]);
      // Attach rejection observation before querying the independent observer.
      void pending.catch(() => undefined);
      await waitBlocked(writerPid, guardPid);
      await guard.query("COMMIT");
      await pending;
      await writer.query("ROLLBACK");
    } finally {
      await guard.query("ROLLBACK").catch(() => undefined);
      await pending?.catch(() => undefined);
      await writer.query("ROLLBACK").catch(() => undefined);
      guard.release();
      writer.release();
    }
  });
}
test("An unrelated owner's personal writes remain independent", async () => {
  const first = await person(),
    second = await person();
  const guard = await pool.connect();
  try {
    await guard.query("BEGIN");
    await lockAgendaSources(guard, first);
    await pool.query(
      "INSERT INTO items(user_id,title) VALUES($1,'Independent')",
      [second],
    );
  } finally {
    await guard.query("ROLLBACK");
    guard.release();
  }
});
test("A shared item change fences a different team reader", async () => {
  const f = await fixture(),
    reader = await person();
  await pool.query(
    "INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'member')",
    [f.team, reader],
  );
  const guard = await pool.connect(),
    writer = await pool.connect();
  let pending: Promise<unknown> | undefined;
  try {
    await guard.query("BEGIN");
    await writer.query("BEGIN");
    await lockAgendaSources(guard, reader);
    const guardPid = (await guard.query("SELECT pg_backend_pid() AS pid"))
      .rows[0].pid;
    const writerPid = (await writer.query("SELECT pg_backend_pid() AS pid"))
      .rows[0].pid;
    pending = writer.query(
      "UPDATE items SET title='Changed shared fact' WHERE id=$1",
      [f.item],
    );
    void pending.catch(() => undefined);
    await waitBlocked(writerPid, guardPid);
    await guard.query("COMMIT");
    await pending;
  } finally {
    await guard.query("ROLLBACK").catch(() => undefined);
    await pending?.catch(() => undefined);
    await writer.query("ROLLBACK").catch(() => undefined);
    guard.release();
    writer.release();
  }
});

test("Validation waits for an earlier source transaction and then sees its committed facts", async () => {
  const f = await fixture();
  const writer = await pool.connect(),
    guard = await pool.connect();
  let pending: Promise<unknown> | undefined;
  try {
    await writer.query("BEGIN");
    await guard.query("BEGIN");
    await writer.query(
      "UPDATE items SET title='Committed before validation' WHERE id=$1",
      [f.item],
    );
    const writerPid = (await writer.query("SELECT pg_backend_pid() AS pid"))
      .rows[0].pid;
    const guardPid = (await guard.query("SELECT pg_backend_pid() AS pid"))
      .rows[0].pid;
    pending = lockAgendaSources(guard, f.owner);
    void pending.catch(() => undefined);
    await waitBlocked(guardPid, writerPid);
    await writer.query("COMMIT");
    await pending;
    assert.equal(
      (await guard.query("SELECT title FROM items WHERE id=$1", [f.item]))
        .rows[0].title,
      "Committed before validation",
    );
  } finally {
    await writer.query("ROLLBACK").catch(() => undefined);
    await pending?.catch(() => undefined);
    await guard.query("ROLLBACK").catch(() => undefined);
    guard.release();
    writer.release();
  }
});

test("A newly inserted task cannot commit across the validation/application fence", async () => {
  const owner = await person();
  const guard = await pool.connect(),
    writer = await pool.connect();
  let pending: Promise<unknown> | undefined;
  try {
    await guard.query("BEGIN");
    await writer.query("BEGIN");
    await lockAgendaSources(guard, owner);
    const guardPid = (await guard.query("SELECT pg_backend_pid() AS pid"))
      .rows[0].pid;
    const writerPid = (await writer.query("SELECT pg_backend_pid() AS pid"))
      .rows[0].pid;
    pending = writer.query(
      "INSERT INTO items(user_id,title) VALUES($1,'New phantom')",
      [owner],
    );
    void pending.catch(() => undefined);
    await waitBlocked(writerPid, guardPid);
    assert.equal(
      (
        await guard.query(
          "SELECT count(*)::int AS n FROM items WHERE user_id=$1",
          [owner],
        )
      ).rows[0].n,
      0,
    );
    await guard.query("COMMIT");
    await pending;
    await writer.query("COMMIT");
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM items WHERE user_id=$1",
          [owner],
        )
      ).rows[0].n,
      1,
    );
  } finally {
    await guard.query("ROLLBACK").catch(() => undefined);
    await pending?.catch(() => undefined);
    await writer.query("ROLLBACK").catch(() => undefined);
    guard.release();
    writer.release();
  }
});
