import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { localDateKey, type ActivitySummary, type Item } from "@orbyn/core";
import "./setup.js";

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const app = await buildApp();
const users: string[] = [];
const teams: string[] = [];
const zone = "Australia/Melbourne";
const call = (
  token: string | null,
  method: "GET" | "POST" | "PUT",
  url: string,
  payload?: object,
) =>
  app.inject({
    method,
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(payload ? { payload } : {}),
  });
async function account() {
  const response = await call(null, "POST", "/auth/register", {
    email: `activity-${randomUUID()}@example.test`,
    password: "synthetic-activity-test-password",
    name: "Activity test",
  });
  assert.equal(response.statusCode, 201, response.body);
  const { token, user } = response.json();
  users.push(user.id);
  await pool.query(
    "INSERT INTO planner_prefs(user_id,timezone) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET timezone=EXCLUDED.timezone",
    [user.id, zone],
  );
  return { token: token as string, id: user.id as string };
}
async function summary(token: string, days = 30) {
  const response = await call(
    token,
    "GET",
    `/me/activity-summary?days=${days}`,
  );
  assert.equal(response.statusCode, 200, response.body);
  return response.json<ActivitySummary>();
}
async function task(token: string, team_id: string | null = null) {
  const response = await call(token, "POST", "/items", {
    kind: "task",
    title: `Private title ${randomUUID()}`,
    team_id,
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json<Item>();
}

before(() => migrate());
after(async () => {
  try {
    if (teams.length)
      await pool.query("DELETE FROM teams WHERE id=ANY($1::uuid[])", [teams]);
    if (users.length)
      await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
  } finally {
    await app.close();
    await pool.end();
  }
});

test("personal activity authenticates, bounds its range and never invents completion history", async () => {
  assert.equal(
    (await call(null, "GET", "/me/activity-summary")).statusCode,
    401,
  );
  const user = await account();
  for (const days of [0, 14, 366])
    assert.equal(
      (await call(user.token, "GET", `/me/activity-summary?days=${days}`))
        .statusCode,
      422,
    );
  for (const days of [30, 90, 365]) {
    const value = await summary(user.token, days);
    assert.equal(value.timezone, zone);
    assert.equal(value.days.length, days);
    const recorded = localDateKey(
      new Date(value.completion_history_since),
      zone,
    );
    assert.deepEqual(value.totals, {
      completions: 0,
      focus_minutes: 0,
      active_days: 0,
    });
    for (const day of value.days) {
      assert.equal(day.completions, day.day < recorded ? null : 0);
      assert.equal(day.focus_minutes, 0);
      assert.deepEqual(Object.keys(day).sort(), [
        "completions",
        "day",
        "focus_minutes",
      ]);
    }
  }
});

test("actual completion transitions and idempotent focus uploads count on the local start day", async () => {
  const user = await account();
  const stranger = await account();
  let item = await task(user.token);
  for (const status of ["done", "done", "todo", "done"] as const) {
    const response = await call(user.token, "PUT", `/items/${item.id}`, {
      title: item.title,
      kind: "task",
      status,
      version: item.version,
    });
    assert.equal(response.statusCode, 200, response.body);
    item = response.json<Item>();
  }
  const recorded = await pool.query(
    "SELECT count(*)::int AS n FROM item_completions WHERE user_id=$1 AND item_id=$2",
    [user.id, item.id],
  );
  assert.equal(
    recorded.rows[0].n,
    2,
    "an unchanged done state does not count again; reopening then completing does",
  );
  const dates = (
    await pool.query<{ today: string; start_day: string; midnight: Date }>(
      "SELECT (now() AT TIME ZONE $1)::date::text AS today, ((now() AT TIME ZONE $1)::date - 2)::text AS start_day, (((now() AT TIME ZONE $1)::date - 1)::timestamp AT TIME ZONE $1) AS midnight",
      [zone],
    )
  ).rows[0];
  const midnight = dates.midnight.getTime();
  const session = {
    id: randomUUID(),
    item_id: item.id,
    kind: "work",
    started_at: new Date(midnight - 10 * 60000).toISOString(),
    ended_at: new Date(midnight + 25 * 60000).toISOString(),
    planned_minutes: 35,
    minutes: 35,
    completed: true,
  };
  assert.equal(
    (await call(user.token, "POST", "/focus/sessions", session)).statusCode,
    201,
  );
  assert.equal(
    (await call(user.token, "POST", "/focus/sessions", session)).statusCode,
    200,
  );
  assert.equal(
    (
      await call(user.token, "POST", "/focus/sessions", {
        ...session,
        id: randomUUID(),
        item_id: null,
        kind: "short_break",
      })
    ).statusCode,
    201,
  );
  const value = await summary(user.token);
  assert.equal(
    value.days.find((day) => day.day === dates.today)!.completions,
    2,
  );
  assert.equal(
    value.days.find((day) => day.day === dates.start_day)!.focus_minutes,
    35,
    "all work minutes belong to the local start day across midnight",
  );
  assert.deepEqual(value.totals, {
    completions: 2,
    focus_minutes: 35,
    active_days: 2,
  });
  assert.ok(
    !JSON.stringify(value).includes(item.title),
    "summaries expose no item content",
  );
  assert.deepEqual((await summary(stranger.token)).totals, {
    completions: 0,
    focus_minutes: 0,
    active_days: 0,
  });
});

test("activity rechecks current team visibility and deletion removes completion records", async () => {
  const owner = await account();
  const member = await account();
  const team = (
    await pool.query<{ id: string }>(
      "INSERT INTO teams(name,created_by) VALUES('Activity test team',$1) RETURNING id",
      [owner.id],
    )
  ).rows[0].id;
  teams.push(team);
  await pool.query(
    "INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'member')",
    [team, owner.id, member.id],
  );
  const item = await task(owner.token, team);
  await pool.query(
    "INSERT INTO item_completions(user_id,item_id) VALUES($1,$2)",
    [member.id, item.id],
  );
  await pool.query(
    "INSERT INTO focus_sessions(id,user_id,item_id,kind,started_at,ended_at,planned_minutes,minutes,completed) VALUES($1,$2,$3,'work',now()-interval '10 minutes',now(),10,10,true)",
    [randomUUID(), member.id, item.id],
  );
  assert.equal((await summary(member.token)).totals.completions, 1);
  assert.equal((await summary(member.token)).totals.focus_minutes, 10);
  await pool.query("DELETE FROM team_members WHERE team_id=$1 AND user_id=$2", [
    team,
    member.id,
  ]);
  assert.deepEqual((await summary(member.token)).totals, {
    completions: 0,
    focus_minutes: 0,
    active_days: 0,
  });
  await pool.query("DELETE FROM items WHERE id=$1", [item.id]);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM item_completions WHERE item_id=$1",
        [item.id],
      )
    ).rows[0].n,
    0,
  );
});

test("recurring completions count each occurrence and connected changes count for the person", async () => {
  const user = await account();
  const created = await call(user.token, "POST", "/items", {
    kind: "task",
    title: "Recurring activity",
    due_at: new Date().toISOString(),
    rrule: "FREQ=DAILY",
    timezone: zone,
  });
  assert.equal(created.statusCode, 201, created.body);
  let item = created.json<Item>();
  for (let i = 0; i < 2; i++) {
    const result = await call(user.token, "PUT", `/items/${item.id}`, {
      kind: "task",
      title: item.title,
      status: "done",
      due_at: item.due_at,
      rrule: "FREQ=DAILY",
      timezone: zone,
      version: item.version,
    });
    assert.equal(result.statusCode, 200, result.body);
    item = result.json<Item>();
    assert.notEqual(item.status, "done", "the next occurrence remains open");
  }
  const { transaction } = await import("../src/db/pool.js");
  const { actAs } = await import("../src/lib/actor.js");
  const { mutate } = await import("../src/modules/items/service.js");
  const grant = (
    await pool.query<{ id: string }>(
      "INSERT INTO agent_grants(user_id,kind,name,access,personal,toolsets) VALUES($1,'key','Activity connected test','write',true,ARRAY['core']) RETURNING id",
      [user.id],
    )
  ).rows[0].id;
  const personal = await task(user.token);
  await transaction(async (db) => {
    await actAs(db, user.id, grant);
    await mutate(
      db,
      { id: user.id, role: "member" },
      {
        operation: "update",
        item_id: personal.id,
        version: personal.version,
        data: { kind: "task", title: personal.title, status: "done" },
      },
    );
  });
  assert.equal((await summary(user.token)).totals.completions, 3);
  assert.equal(
    (await summary(user.token)).totals.active_days,
    1,
    "same-day records deduplicate active days",
  );
});

test("DST focus intervals use the configured local start date", async () => {
  const user = await account();
  // Melbourne's 2026 spring transition jumps from 02:00 to 03:00 on 4 October.
  const id = randomUUID();
  await pool.query(
    "INSERT INTO focus_sessions(id,user_id,kind,started_at,ended_at,planned_minutes,minutes,completed) VALUES($1,$2,'work',$3,$4,40,40,true)",
    [id, user.id, "2026-10-03T15:50:00Z", "2026-10-03T16:30:00Z"],
  );
  const { activitySummary } = await import("../src/modules/focus/activity.js");
  // Execute the real aggregation SQL with a fixed clock, without changing the shared database clock.
  const fixed = {
    query: (text: string, values?: unknown[]) =>
      pool.query(
        text.replaceAll("now()", "TIMESTAMPTZ '2026-10-05T00:00:00Z'"),
        values,
      ),
  } as unknown as import("../src/db/pool.js").Queryable;
  const value = await activitySummary(fixed, user.id, 30);
  assert.equal(
    value.days.find((d) => d.day === "2026-10-04")!.focus_minutes,
    40,
  );
  assert.equal(
    value.days.find((d) => d.day === "2026-10-03")!.focus_minutes,
    0,
  );
  assert.equal(value.totals.active_days, 1);
});

test("snapshot restore preserves completion identities and timestamps", async () => {
  const user = await account();
  const item = await task(user.token);
  const timestamp = "2026-10-01T13:37:42.123Z";
  const record = (
    await pool.query<{ id: string }>(
      "INSERT INTO item_completions(user_id,item_id,created_at) VALUES($1,$2,$3) RETURNING id",
      [user.id, item.id, timestamp],
    )
  ).rows[0];
  const { transaction } = await import("../src/db/pool.js");
  const { snapshot, restoreSnapshot } =
    await import("../src/capabilities/snapshot.js");
  await transaction(async (db) => {
    const saved = await snapshot(db, "item", [item.id]);
    await db.query("DELETE FROM items WHERE id=$1", [item.id]);
    const actor = (
      await db.query<import("../src/lib/auth.js").UserRow>(
        "SELECT * FROM users WHERE id=$1",
        [user.id],
      )
    ).rows[0];
    await restoreSnapshot(db, saved, actor);
  });
  const restored = (
    await pool.query<{ created_at: Date }>(
      "SELECT created_at FROM item_completions WHERE id=$1",
      [record.id],
    )
  ).rows[0];
  assert.equal(restored.created_at.toISOString(), timestamp);
});

test("personal export resolves duplicate titles and subtasks offline without exposing other scopes", async () => {
  const user = await account();
  const stranger = await account();
  const a = await task(user.token),
    b = await task(user.token),
    other = await task(stranger.token);
  await pool.query(
    "UPDATE items SET title='Same title' WHERE id=ANY($1::uuid[])",
    [[a.id, b.id]],
  );
  const childResponse = await call(user.token, "POST", "/items", {
    kind: "task",
    title: "Completed child",
    parent_id: a.id,
  });
  assert.equal(childResponse.statusCode, 201, childResponse.body);
  const child = childResponse.json<Item>();
  const team = (
    await pool.query<{ id: string }>(
      "INSERT INTO teams(name,created_by) VALUES('Export excluded team',$1) RETURNING id",
      [user.id],
    )
  ).rows[0].id;
  teams.push(team);
  await pool.query(
    "INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'owner')",
    [team, user.id],
  );
  const shared = await task(user.token, team);
  await pool.query(
    "INSERT INTO item_completions(user_id,item_id) VALUES($1,$2)",
    [user.id, shared.id],
  );
  const timestamp = "2026-10-02T10:11:12.123Z";
  for (const id of [a.id, b.id, child.id])
    await pool.query(
      "INSERT INTO item_completions(user_id,item_id,created_at) VALUES($1,$2,$3)",
      [user.id, id, timestamp],
    );
  await pool.query(
    "INSERT INTO item_completions(user_id,item_id) VALUES($1,$2)",
    [stranger.id, other.id],
  );
  const response = await call(user.token, "GET", "/me/export");
  assert.equal(response.statusCode, 200, response.body);
  const archive =
    response.json<
      import("../src/modules/organize/portability.js").ExportArchive
    >();
  assert.deepEqual(
    new Set(archive.items.map((i) => i.id)),
    new Set([a.id, b.id]),
  );
  assert.equal(archive.completion_history!.length, 3);
  for (const completion of archive.completion_history!) {
    assert.equal(completion.item.id, completion.item_id);
    assert.equal(completion.created_at, timestamp);
    assert.ok(completion.item.title);
  }
  assert.equal(
    archive.completion_history!.find((c) => c.item_id === child.id)!.item
      .parent_id,
    a.id,
  );
  assert.ok(!JSON.stringify(archive).includes(other.id));
  assert.ok(!JSON.stringify(archive).includes(shared.id));
  const legacy = {
    ...archive,
    items: archive.items.map(({ id, ...item }) => item),
  };
  delete legacy.completion_history;
  const preview = await call(user.token, "POST", "/me/import", {
    format: "orbyn",
    data: JSON.stringify(legacy),
    dry_run: true,
  });
  assert.equal(preview.statusCode, 200, preview.body);
  assert.equal(preview.json().created, 2);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM item_completions WHERE user_id=$1",
        [user.id],
      )
    ).rows[0].n,
    4,
    "preview never manufactures completion history",
  );
});
