import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { runDueTemplates } = await import("../src/modules/templates/routes.js");

const app = await buildApp();
type Json = Record<string, any>;
const call = (
  token: string | null,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
) =>
  app.inject({
    method,
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

async function newUser(name: string) {
  const r = await call(null, "POST", "/auth/register", {
    email: `tpl-${randomUUID()}@example.com`,
    password: "a-long-test-password",
    name,
  });
  return { token: r.json().token as string, id: r.json().user.id as string };
}

let owner: { token: string; id: string };
let member: { token: string; id: string };
let stranger: { token: string; id: string };
let team = "";

before(async () => {
  await migrate();
  owner = await newUser("Owner");
  member = await newUser("Member");
  stranger = await newUser("Stranger");
  team = (
    await pool.query<{ id: string }>(
      "INSERT INTO teams (name, created_by) VALUES ('Template crew', $1) RETURNING id",
      [owner.id],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO team_members (team_id, user_id, role) VALUES ($1,$2,'owner'),($1,$3,'member')",
    [team, owner.id, member.id],
  );
});
after(async () => {
  await app.close();
  await pool.end();
});

const retro = {
  name: "Crew retro",
  tasks: [
    { id: "a", title: "Collect notes", estimate_minutes: 20, due_in_days: 0 },
    {
      id: "b",
      title: "Run it",
      estimate_minutes: 60,
      due_in_days: 1,
      depends_on: ["a"],
    },
  ],
  page: {
    title: "Retro",
    content: [{ type: "heading", level: 2, text: "Went well" }],
  },
};

test("everyone starts with the starters", async () => {
  assert.equal((await call(null, "GET", "/templates")).statusCode, 401);
  const all: Json[] = (await call(member.token, "GET", "/templates")).json();
  const ids = all.filter((t) => t.source === "starter").map((t) => t.id);
  for (const id of ["starter:sprint", "starter:retro", "starter:okr"])
    assert.ok(ids.includes(id), id);
  assert.ok(all.every((t) => t.source !== "starter" || !t.can_edit));
});

test("starting from a template is a proposal to review, then a project with its page", async () => {
  const proposal = await call(
    owner.token,
    "POST",
    "/templates/starter:retro/use",
    {
      title: "September retro",
    },
  );
  assert.equal(proposal.statusCode, 200, proposal.body);
  const p = proposal.json();
  assert.equal(p.project.title, "September retro");
  assert.equal(p.project.tasks.length, 3);
  assert.equal(p.project.page.title, "Retrospective");
  // Nothing exists yet.
  const before = (
    await pool.query(
      "SELECT count(*)::int AS n FROM projects WHERE user_id = $1",
      [owner.id],
    )
  ).rows[0].n;
  assert.equal(before, 0);

  const applied = await call(
    owner.token,
    "POST",
    `/ai/proposals/${p.id}/apply`,
  );
  assert.equal(applied.statusCode, 200, applied.body);
  const project = (
    await pool.query<{ id: string; doc_id: string | null }>(
      "SELECT id, doc_id FROM projects WHERE user_id = $1 AND name = 'September retro'",
      [owner.id],
    )
  ).rows[0];
  assert.ok(project.doc_id, "the brief page is made with the project");
  const doc = (
    await pool.query("SELECT title, project_id FROM docs WHERE id = $1", [
      project.doc_id,
    ])
  ).rows[0];
  assert.equal(doc.title, "Retrospective");
  assert.equal(doc.project_id, project.id);
  const deps = (
    await pool.query(
      `SELECT count(*)::int AS n FROM item_dependencies d
         JOIN items i ON i.id = d.item_id WHERE i.project_id = $1`,
      [project.id],
    )
  ).rows[0].n;
  assert.equal(deps, 2);
});

test("OKR key results carry a number to reach, and progress follows it", async () => {
  const p = (
    await call(owner.token, "POST", "/templates/starter:okr/use", {})
  ).json();
  await call(owner.token, "POST", `/ai/proposals/${p.id}/apply`);
  const kr = (await call(owner.token, "GET", "/items"))
    .json()
    .find((i: Json) => i.title === "Key result 1");
  assert.equal(kr.target_value, 100);
  assert.equal(kr.current_value, 0);
  // Moving the number moves progress.
  const saved = await call(owner.token, "PUT", `/items/${kr.id}`, {
    title: kr.title,
    kind: "task",
    version: kr.version,
    current_value: 40,
    value_unit: "signups",
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().progress, 40);
  assert.equal(saved.json().value_unit, "signups");
});

test("owners and admins make a team's templates; everyone on it uses them", async () => {
  const denied = await call(member.token, "POST", "/templates", {
    ...retro,
    team_id: team,
  });
  assert.equal(denied.statusCode, 403);
  const made = await call(owner.token, "POST", "/templates", {
    ...retro,
    team_id: team,
  });
  assert.equal(made.statusCode, 201, made.body);
  const t = made.json();
  assert.equal(t.source, "team");
  assert.equal(t.can_edit, true);
  const seen: Json[] = (await call(member.token, "GET", "/templates")).json();
  const theirs = seen.find((x) => x.id === t.id)!;
  assert.equal(theirs.can_edit, false);
  // The member starts a team project from it.
  const use = await call(member.token, "POST", `/templates/${t.id}/use`, {});
  assert.equal(use.statusCode, 200, use.body);
  assert.equal(use.json().project.team_id, team);
  // But can't change or delete it.
  assert.equal(
    (await call(member.token, "PUT", `/templates/${t.id}`, { name: "Mine" }))
      .statusCode,
    403,
  );
  assert.equal(
    (await call(member.token, "DELETE", `/templates/${t.id}`)).statusCode,
    403,
  );
  // Someone outside can't see it at all.
  assert.equal(
    (await call(stranger.token, "POST", `/templates/${t.id}/use`, {}))
      .statusCode,
    404,
  );
});

test("a template's tasks must fit together", async () => {
  const loop = await call(owner.token, "POST", "/templates", {
    ...retro,
    tasks: [
      {
        id: "a",
        title: "A",
        estimate_minutes: 20,
        due_in_days: 0,
        depends_on: ["b"],
      },
      {
        id: "b",
        title: "B",
        estimate_minutes: 20,
        due_in_days: 0,
        depends_on: ["a"],
      },
    ],
  });
  assert.equal(loop.statusCode, 422);
  const noTasks = await call(owner.token, "POST", "/templates", {
    ...retro,
    tasks: [],
  });
  assert.equal(noTasks.statusCode, 422);
});

test("a project can be saved as a template", async () => {
  const project = (
    await pool.query<{ id: string }>(
      "SELECT id FROM projects WHERE user_id = $1 AND name = 'September retro'",
      [owner.id],
    )
  ).rows[0];
  const made = await call(
    owner.token,
    "POST",
    `/templates/from-project/${project.id}`,
  );
  assert.equal(made.statusCode, 201, made.body);
  const t = made.json();
  assert.equal(t.name, "September retro");
  assert.equal(t.page.title, "Retrospective");
  assert.ok(t.tasks.length >= 3);
  // Order carries over.
  assert.ok(t.tasks.some((x: Json) => x.depends_on.length > 0));
  assert.equal(
    (
      await call(
        stranger.token,
        "POST",
        `/templates/from-project/${project.id}`,
      )
    ).statusCode,
    404,
  );
});

test("a template with a rhythm says when it's ready to start", async () => {
  const made = (
    await call(owner.token, "POST", "/templates", {
      ...retro,
      name: "Fortnightly retro",
      rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=FR",
    })
  ).json();
  assert.ok(made.next_at);
  // Its time has come.
  await pool.query(
    "UPDATE project_templates SET next_at = now() - interval '1 minute' WHERE id = $1",
    [made.id],
  );
  assert.ok((await runDueTemplates()) >= 1);
  const notice = (
    await pool.query(
      "SELECT title, ref FROM notifications WHERE user_id = $1 AND kind = 'template'",
      [owner.id],
    )
  ).rows[0];
  assert.equal(notice.ref, made.id);
  assert.match(notice.title, /Fortnightly retro is ready/);
  // And it moved on to the next time.
  const next = (
    await pool.query("SELECT next_at FROM project_templates WHERE id = $1", [
      made.id,
    ])
  ).rows[0].next_at;
  assert.ok(next > new Date());
});
