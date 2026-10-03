import { freshRateLimitSession } from "./rate-limit-session.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

/**
 * Saved views and your own fields (D4a):
 * - /views: named filters, sorts, groupings and layouts over tasks, pages or
 *   projects (DATA-01), yours or shared with a team, pinned and starred by
 *   each person, run as the person looking, exported as CSV;
 * - /fields: typed fields on pages and projects (ORG-02), set in the Info
 *   panel, filtered and grouped on in views, and date fields shown on the
 *   calendar as deadlines (DATA-07).
 */

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { addDays, localDateKey } = await import("@orbyn/core");

const app = await buildApp();

type Person = { token: string; email: string; id: string };
let me: Person;
let mate: Person;
let viewer: Person;
let admin: Person;
let stranger: Person;

let address = 0;
const call = (
  who: Person | null,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
) =>
  app.inject({
    method,
    url,
    remoteAddress: `10.84.0.${address++ % 250}`,
    headers: who ? { authorization: `Bearer ${who.token}` } : {},
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

const register = async (name: string): Promise<Person> => {
  const email = `saved-views-${randomUUID()}@example.com`;
  const res = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email, password: "a-long-test-password", name },
  });
  const token = res.json().token;
  const id = (
    await app.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: `Bearer ${token}` },
    })
  ).json().id;
  return { token, email, id };
};

const today = localDateKey(new Date(), "UTC");
const at = (day: string) => `${day}T12:00:00.000Z`;

let teamId = "";
let projectId = "";
let pageId = "";
let otherPageId = "";
let myTaskId = "";

before(async () => {
  await migrate();
  me = await register("Views Owner");
  mate = await register("Views Mate");
  viewer = await register("Views Viewer");
  admin = await register("Views Admin");
  stranger = await register("Views Stranger");
  teamId = (await call(me, "POST", "/teams", { name: "Physics" })).json().id;
  for (const [who, role] of [
    [mate, "member"],
    [viewer, "viewer"],
    [admin, "admin"],
  ] as const)
    await call(me, "POST", `/teams/${teamId}/members`, {
      email: who.email,
      role,
    });
  projectId = (
    await call(me, "POST", "/projects", {
      name: "Physics 101",
      team_id: teamId,
    })
  ).json().id;
  // Team tasks in the project: two due this week, one next month, one done.
  const task = async (who: Person, body: Record<string, unknown>) => {
    const res = await call(who, "POST", "/items", { kind: "task", ...body });
    assert.equal(res.statusCode, 201, res.body);
    return res.json().id as string;
  };
  await task(me, {
    title: "Lab report",
    team_id: teamId,
    project_id: projectId,
    due_at: at(addDays(today, 2)),
    estimate_minutes: 120,
  });
  await task(me, {
    title: "Problem set",
    team_id: teamId,
    project_id: projectId,
    due_at: at(addDays(today, 5)),
    estimate_minutes: 80,
  });
  await task(me, {
    title: "Final essay",
    team_id: teamId,
    project_id: projectId,
    due_at: at(addDays(today, 40)),
  });
  const done = await task(me, {
    title: "Old quiz",
    team_id: teamId,
    project_id: projectId,
  });
  const finished = await call(me, "PUT", `/items/${done}`, {
    title: "Old quiz",
    kind: "task",
    team_id: teamId,
    status: "done",
    version: 1,
  });
  assert.equal(finished.statusCode, 200, finished.body);
  // A personal task of mine: never in anyone else's rows.
  myTaskId = await task(me, {
    title: "=HYPERLINK(my own errand)",
    due_at: at(addDays(today, 1)),
  });
  pageId = (
    await call(me, "POST", "/docs", {
      title: "Lab 3 notes",
      team_id: teamId,
      project_id: projectId,
    })
  ).json().id;
  otherPageId = (
    await call(mate, "POST", "/docs", {
      title: "Reading list",
      team_id: teamId,
    })
  ).json().id;
});

after(async () => {
  await app.close();
  await pool.end();
});

test("views and fields need signing in", async () => {
  for (const [method, url] of [
    ["GET", "/views"],
    ["POST", "/views"],
    ["POST", "/views/run"],
    ["GET", "/fields"],
    ["POST", "/fields"],
    ["GET", "/fields/dates?from=2026-01-01&to=2026-01-31"],
  ] as const)
    assert.equal((await call(null, method, url, {})).statusCode, 401, url);
});

test("a definition that doesn't fit its source is refused (422)", async () => {
  const bad = [
    { source: "tasks", layout: "gallery" },
    { source: "pages", group_by: "priority" },
    { source: "tasks", group_by: `field:${randomUUID()}` },
    { source: "projects", columns: ["estimate"] },
    { source: "tasks", filters: { nonsense: true } },
  ];
  for (const definition of bad) {
    const res = await call(me, "POST", "/views", {
      name: "Bad",
      definition,
    });
    assert.equal(res.statusCode, 422, JSON.stringify(definition));
  }
  assert.equal(
    (
      await call(me, "POST", "/views", {
        name: "",
        definition: { source: "tasks" },
      })
    ).statusCode,
    422,
  );
});

test("a personal view runs its filters, order and limit", async () => {
  const res = await call(me, "POST", "/views", {
    name: "Exam week",
    definition: {
      source: "tasks",
      filters: { due_within_days: 7, project: projectId },
      group_by: "project",
      layout: "table",
    },
  });
  assert.equal(res.statusCode, 201, res.body);
  const view = res.json();
  assert.equal(view.source, "tasks");
  assert.equal(view.can_edit, true);
  assert.equal(view.pinned, false);
  assert.deepEqual(view.definition.sort, { by: "due", dir: "asc" });

  const run = await call(me, "POST", "/views/run", { id: view.id });
  assert.equal(run.statusCode, 200, run.body);
  const result = run.json();
  assert.deepEqual(
    result.rows.map((r: { title: string }) => r.title),
    ["Lab report", "Problem set"],
  );
  assert.equal(result.view.id, view.id);
  assert.equal(result.rows[0].project_name, "Physics 101");
  assert.equal(result.rows[0].item.id, result.rows[0].id);
  assert.equal(result.rows[0].can_write, true);

  const limited = (
    await call(me, "POST", "/views/run", { id: view.id, limit: 1 })
  ).json();
  assert.equal(limited.rows.length, 1);
  assert.equal(limited.truncated, true);

  // Done tasks, and a definition that isn't saved.
  const done = (
    await call(me, "POST", "/views/run", {
      definition: { source: "tasks", filters: { status: "done" } },
    })
  ).json();
  assert.deepEqual(
    done.rows.map((r: { title: string }) => r.title),
    ["Old quiz"],
  );
  assert.equal(
    (await call(me, "POST", "/views/run", { id: randomUUID() })).statusCode,
    404,
  );
});

test("a view shared with a team runs as the person looking", async () => {
  const everything = {
    source: "tasks",
    filters: { status: "any" },
    sort: { by: "title", dir: "asc" },
  };
  const shared = (
    await call(me, "POST", "/views", {
      name: "Everything",
      team_id: null,
      definition: everything,
    })
  ).json();
  // Only mine until it's shared.
  assert.equal(
    (await call(mate, "POST", "/views/run", { id: shared.id })).statusCode,
    404,
  );
  const put = await call(me, "PUT", `/views/${shared.id}`, { team_id: teamId });
  assert.equal(put.statusCode, 200, put.body);
  assert.equal(put.json().team_name, "Physics");

  const mine = (await call(me, "POST", "/views/run", { id: shared.id })).json();
  const theirs = (
    await call(mate, "POST", "/views/run", { id: shared.id })
  ).json();
  assert.ok(mine.rows.some((r: { id: string }) => r.id === myTaskId));
  assert.ok(!theirs.rows.some((r: { id: string }) => r.id === myTaskId));
  assert.equal(theirs.rows.length, mine.rows.length - 1);

  // Listed for teammates, with who may change it.
  const listed = (await call(mate, "GET", "/views")).json();
  const row = listed.find((v: { id: string }) => v.id === shared.id);
  assert.equal(row.can_edit, false);
  assert.equal(row.owner_name, "Views Owner");
  assert.ok(
    !(await call(stranger, "GET", "/views"))
      .json()
      .some((v: { id: string }) => v.id === shared.id),
  );

  // A member who didn't make it can't change it; the team's admin can.
  assert.equal(
    (await call(mate, "PUT", `/views/${shared.id}`, { name: "Mine now" }))
      .statusCode,
    403,
  );
  assert.equal(
    (await call(stranger, "PUT", `/views/${shared.id}`, { name: "Mine now" }))
      .statusCode,
    404,
  );
  const renamed = await call(admin, "PUT", `/views/${shared.id}`, {
    name: "All team work",
  });
  assert.equal(renamed.statusCode, 200, renamed.body);
  // Only its maker takes it back from the team.
  assert.equal(
    (await call(admin, "PUT", `/views/${shared.id}`, { team_id: null }))
      .statusCode,
    403,
  );
  // A view keeps its source.
  assert.equal(
    (
      await call(me, "PUT", `/views/${shared.id}`, {
        definition: { source: "pages" },
      })
    ).statusCode,
    400,
  );
  // A viewer can't share views with the team; a stranger can't at all.
  assert.equal(
    (
      await call(viewer, "POST", "/views", {
        name: "Viewer's",
        team_id: teamId,
        definition: { source: "tasks" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await call(stranger, "POST", "/views", {
        name: "Stranger's",
        team_id: teamId,
        definition: { source: "tasks" },
      })
    ).statusCode,
    404,
  );
});

test("pins and stars are each person's own, and go with the view", async () => {
  const view = (
    await call(me, "POST", "/views", {
      name: "Pinned",
      team_id: teamId,
      definition: { source: "projects" },
    })
  ).json();
  assert.equal(
    (await call(mate, "PUT", `/views/${view.id}/pin`, { pinned: true }))
      .statusCode,
    204,
  );
  const mateList = (await call(mate, "GET", "/views")).json();
  const myList = (await call(me, "GET", "/views")).json();
  assert.equal(
    mateList.find((v: { id: string }) => v.id === view.id).pinned,
    true,
  );
  assert.equal(
    myList.find((v: { id: string }) => v.id === view.id).pinned,
    false,
  );
  assert.equal(
    (await call(stranger, "PUT", `/views/${view.id}/pin`, { pinned: true }))
      .statusCode,
    404,
  );
  assert.equal(
    (await call(mate, "PUT", `/views/${view.id}/pin`, { pinned: "yes" }))
      .statusCode,
    422,
  );

  const star = await call(mate, "PUT", "/favourites", {
    kind: "view",
    target_id: view.id,
    starred: true,
  });
  assert.equal(star.statusCode, 204, star.body);
  assert.equal(
    (
      await call(stranger, "PUT", "/favourites", {
        kind: "view",
        target_id: view.id,
        starred: true,
      })
    ).statusCode,
    404,
  );
  // Only its maker (or the team's admins) deletes it; stars and pins go too.
  assert.equal(
    (await call(mate, "DELETE", `/views/${view.id}`)).statusCode,
    403,
  );
  assert.equal((await call(me, "DELETE", `/views/${view.id}`)).statusCode, 204);
  const stars = (await call(mate, "GET", "/favourites")).json();
  assert.ok(!stars.some((f: { target_id: string }) => f.target_id === view.id));
  assert.equal(
    (
      await pool.query("SELECT 1 FROM saved_view_pins WHERE view_id = $1", [
        view.id,
      ])
    ).rowCount,
    0,
  );
});

test("a view exports as CSV with its columns, formulas kept as text", async () => {
  const view = (
    await call(me, "POST", "/views", {
      name: "Due soon / mine",
      definition: {
        source: "tasks",
        filters: { team: "personal" },
        columns: ["title", "due", "days_left", "overdue"],
      },
    })
  ).json();
  const res = await call(me, "GET", `/views/${view.id}/export.csv`);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"] as string, /text\/csv/);
  assert.match(
    res.headers["content-disposition"] as string,
    /filename="Due soon mine\.csv"/,
  );
  const lines = res.body.trim().split("\r\n");
  assert.equal(lines[0], "Name,Due,Days left,Overdue");
  assert.match(lines[1], /^'=HYPERLINK\(my own errand\),/);
  assert.match(lines[1], /1 day left/);
  assert.equal(
    (await call(mate, "GET", `/views/${view.id}/export.csv`)).statusCode,
    404,
  );
  assert.equal(
    (await call(null, "GET", `/views/${view.id}/export.csv`)).statusCode,
    401,
  );
});

test("fields: defined per space, set by those who can change the page", async () => {
  // A choice field for the team's pages.
  const bad = await call(me, "POST", "/fields", {
    name: "Stage",
    type: "select",
    applies_to: "page",
    team_id: teamId,
  });
  assert.equal(bad.statusCode, 422);
  assert.equal(
    (
      await call(me, "POST", "/fields", {
        name: "Due",
        type: "text",
        applies_to: "page",
        on_calendar: true,
      })
    ).statusCode,
    422,
  );
  const stage = await call(me, "POST", "/fields", {
    name: "Stage",
    type: "select",
    applies_to: "page",
    team_id: teamId,
    options: ["Draft", "Final"],
  });
  assert.equal(stage.statusCode, 201, stage.body);
  const stageId = stage.json().id;
  assert.equal(
    (
      await call(mate, "POST", "/fields", {
        name: "stage",
        type: "text",
        applies_to: "page",
        team_id: teamId,
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await call(viewer, "POST", "/fields", {
        name: "Viewer's",
        type: "text",
        applies_to: "page",
        team_id: teamId,
      })
    ).statusCode,
    403,
  );
  const due = (
    await call(mate, "POST", "/fields", {
      name: "Essay due",
      type: "date",
      applies_to: "page",
      team_id: teamId,
      on_calendar: true,
    })
  ).json();
  const owner = (
    await call(me, "POST", "/fields", {
      name: "Owner",
      type: "person",
      applies_to: "page",
      team_id: teamId,
    })
  ).json();

  // The Info panel's read: the fields of the page's own space.
  const info = await call(
    viewer,
    "GET",
    `/fields/values?target=page&id=${pageId}`,
  );
  assert.equal(info.statusCode, 200, info.body);
  assert.deepEqual(
    info.json().fields.map((f: { name: string }) => f.name),
    ["Stage", "Essay due", "Owner"],
  );
  assert.equal(info.json().can_write, false);
  assert.equal(info.json().people.length, 4);
  assert.equal(
    (await call(stranger, "GET", `/fields/values?target=page&id=${pageId}`))
      .statusCode,
    404,
  );

  const set = (who: Person, field: string, value: unknown, id = pageId) =>
    call(who, "PUT", `/fields/${field}/value`, {
      target: "page",
      target_id: id,
      value,
    });
  assert.equal((await set(mate, stageId, "final")).statusCode, 200);
  assert.equal((await set(viewer, stageId, "Draft")).statusCode, 403);
  assert.equal((await set(stranger, stageId, "Draft")).statusCode, 404);
  assert.equal((await set(mate, stageId, "Published")).statusCode, 400);
  assert.equal((await set(mate, owner.id, stranger.id)).statusCode, 400);
  assert.equal((await set(mate, owner.id, me.id)).statusCode, 200);
  assert.equal((await set(mate, due.id, "not a date")).statusCode, 400);
  const essayDay = addDays(today, 3);
  assert.equal((await set(mate, due.id, essayDay)).statusCode, 200);
  assert.equal(
    (await set(me, due.id, addDays(today, 9), otherPageId)).statusCode,
    200,
  );
  // A project field can't go on a page, nor a team's field on my own page.
  const mine = (await call(me, "POST", "/docs", { title: "Diary" })).json().id;
  assert.equal((await set(me, stageId, "Draft", mine)).statusCode, 400);

  const values = (
    await call(viewer, "GET", `/fields/values?target=page&id=${pageId}`)
  ).json().values;
  assert.deepEqual(values, {
    [stageId]: "Final",
    [owner.id]: me.id,
    [due.id]: essayDay,
  });

  // Views filter, sort and group by fields, and name the people in them.
  const run = (
    await call(mate, "POST", "/views/run", {
      definition: {
        source: "pages",
        filters: {
          team: teamId,
          fields: [{ field: stageId, op: "is", value: "Final" }],
        },
        group_by: `field:${stageId}`,
        layout: "gallery",
      },
    })
  ).json();
  assert.deepEqual(
    run.rows.map((r: { title: string }) => r.title),
    ["Lab 3 notes"],
  );
  assert.equal(run.rows[0].fields[stageId], "Final");
  assert.ok(run.fields.some((f: { id: string }) => f.id === due.id));
  assert.ok(run.people.some((p: { id: string }) => p.id === me.id));
  const byDate = (
    await call(mate, "POST", "/views/run", {
      definition: {
        source: "pages",
        filters: { team: teamId },
        sort: { by: `field:${due.id}`, dir: "desc" },
      },
    })
  ).json();
  assert.deepEqual(
    byDate.rows.slice(0, 2).map((r: { title: string }) => r.title),
    ["Reading list", "Lab 3 notes"],
  );

  // Date fields on the calendar, for those who can open the page.
  const dates = (
    await call(
      viewer,
      "GET",
      `/fields/dates?from=${today}&to=${addDays(today, 7)}`,
    )
  ).json();
  assert.deepEqual(
    dates.map((d: { title: string; field_name: string; date: string }) => [
      d.field_name,
      d.title,
      d.date,
    ]),
    [["Essay due", "Lab 3 notes", essayDay]],
  );
  assert.deepEqual(
    (
      await call(
        stranger,
        "GET",
        `/fields/dates?from=${today}&to=${addDays(today, 30)}`,
      )
    ).json(),
    [],
  );
  assert.equal(
    (await call(me, "GET", `/fields/dates?from=${today}&to=2020-01-01`))
      .statusCode,
    422,
  );

  // Taking a choice away clears it where it was chosen; only the field's
  // maker or the team's admins may.
  assert.equal(
    (await call(mate, "PUT", `/fields/${stageId}`, { options: ["Draft"] }))
      .statusCode,
    403,
  );
  const changed = await call(admin, "PUT", `/fields/${stageId}`, {
    options: ["Draft"],
  });
  assert.equal(changed.statusCode, 200, changed.body);
  assert.equal(
    (await call(me, "GET", `/fields/values?target=page&id=${pageId}`)).json()
      .values[stageId],
    undefined,
  );
  assert.equal(
    (await call(me, "PUT", `/fields/${stageId}`, { on_calendar: true }))
      .statusCode,
    400,
  );
  // Removing a field clears every value.
  assert.equal(
    (await call(mate, "DELETE", `/fields/${due.id}`)).statusCode,
    204,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM custom_field_values WHERE field_id = $1",
        [due.id],
      )
    ).rowCount,
    0,
  );
});

test("project fields show in project views", async () => {
  const budget = (
    await call(me, "POST", "/fields", {
      name: "Budget",
      type: "number",
      applies_to: "project",
      team_id: teamId,
    })
  ).json();
  const res = await call(mate, "PUT", `/fields/${budget.id}/value`, {
    target: "project",
    target_id: projectId,
    value: "1250.5",
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().value, 1250.5);
  // A page field is not for projects.
  assert.equal(
    (
      await call(mate, "PUT", `/fields/${budget.id}/value`, {
        target: "page",
        target_id: pageId,
        value: 3,
      })
    ).statusCode,
    400,
  );
  const run = (
    await call(me, "POST", "/views/run", {
      definition: {
        source: "projects",
        filters: {
          fields: [{ field: budget.id, op: "after", value: 1000 }],
        },
      },
    })
  ).json();
  assert.deepEqual(
    run.rows.map((r: { title: string; task_count: number }) => [
      r.title,
      r.task_count,
      r.done_count,
    ]),
    [["Physics 101", 4, 1]],
  );
  assert.equal(run.rows[0].fields[budget.id], 1250.5);
});

test("setting a field counts as a change to the page, its version kept", async () => {
  const note = await call(me, "POST", "/fields", {
    name: "Reviewer note",
    type: "text",
    applies_to: "page",
  });
  assert.equal(note.statusCode, 201, note.body);
  const page = (
    await call(me, "POST", "/docs", { title: "Field touch" })
  ).json();
  await pool.query(
    "UPDATE docs SET updated_at = now() - interval '30 days' WHERE id = $1",
    [page.id],
  );
  const set = await call(me, "PUT", `/fields/${note.json().id}/value`, {
    target: "page",
    target_id: page.id,
    value: "Looks good",
  });
  assert.equal(set.statusCode, 200, set.body);
  assert.deepEqual(set.json(), {
    field_id: note.json().id,
    value: "Looks good",
  });
  const after = (
    await pool.query<{ updated_at: Date; version: number }>(
      "SELECT updated_at, version FROM docs WHERE id = $1",
      [page.id],
    )
  ).rows[0];
  assert.ok(Date.now() - after.updated_at.getTime() < 60_000);
  assert.equal(after.version, page.version);
  // "Changed in the last 7 days" now finds it.
  const run = (
    await call(me, "POST", "/views/run", {
      definition: {
        source: "pages",
        filters: { updated_within_days: 7, text: "Field touch" },
      },
    })
  ).json();
  assert.deepEqual(
    run.rows.map((r: { id: string }) => r.id),
    [page.id],
  );
  // The zone the rows' days were read in comes back, for the apps.
  assert.equal(typeof run.time_zone, "string");
});

test("a view run for a connection limited to some spaces reads only those", async () => {
  const { runView } = await import("../src/modules/views/service.js");
  const { fullDefinition } = await import("@orbyn/core");
  const def = fullDefinition({ source: "tasks", filters: { status: "any" } });
  const teams = (r: { rows: { team_id: string | null }[] }) =>
    new Set(r.rows.map((x) => x.team_id));
  const every = await runView(pool, me.id, def);
  assert.deepEqual(teams(every), new Set([null, teamId]));
  const personal = await runView(pool, me.id, def, {
    spaces: { personal: true, teamIds: [] },
  });
  assert.deepEqual(teams(personal), new Set([null]));
  const team = await runView(pool, me.id, def, {
    spaces: { personal: false, teamIds: [teamId] },
  });
  assert.deepEqual(teams(team), new Set([teamId]));
});

test("views and fields answer 429 past the per-minute limit", async () => {
  const { settings, cachedSettings } = await import("../src/lib/settings.js");
  await settings();
  const live = cachedSettings();
  const was = live.rate_limit_per_minute;
  const limitedToken = await freshRateLimitSession(me.token);
  live.rate_limit_per_minute = 2;
  const from = (url: string) =>
    app.inject({
      method: "GET",
      url,
      remoteAddress: "10.84.9.9",
      headers: { authorization: `Bearer ${limitedToken}` },
    });
  try {
    assert.equal((await from("/views")).statusCode, 200);
    assert.equal((await from("/fields")).statusCode, 200);
    assert.equal((await from("/views")).statusCode, 429);
  } finally {
    live.rate_limit_per_minute = was;
  }
});
