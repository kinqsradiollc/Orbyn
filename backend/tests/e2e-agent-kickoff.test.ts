import { test, before, after } from "node:test";
import assert from "node:assert/strict";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";
import { trapNetwork, type Person } from "./mcp-helpers.js";
import { type AgentClient, YES, idOf, scenario } from "./e2e-agent-helpers.js";

/**
 * H9 scenario (c): a project kickoff. The agent starts a team project in
 * one apply_plan (stages, a main page, tasks in a stage with a dependency
 * between them and a milestone holding the first), previews the sessions
 * with plan_schedule and books them with its plan_token. Then the
 * ask-first list: changing a teammate's task asks the person in the chat
 * when the app shows forms (yes applies it), or waits in the Review inbox
 * with a push whose Approve applies it; inviting someone to the team asks
 * too. Full power never needs a yes for the person's own work.
 */

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { reviewCategory } = await import("../src/worker/channels/push.js");

const app = await buildApp();
const { h, connect } = scenario(app);
const network = await trapNetwork();

let olga: Person;
let mo: Person;
let carl: Person;
let crew = "";
let chat: AgentClient;
let noForms: AgentClient;

const day = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

before(async () => {
  await migrate();
  olga = await h.register("e2e-kick-olga", "Olga");
  mo = await h.register("e2e-kick-mo", "Mo");
  carl = await h.register("e2e-kick-carl", "Carl");
  crew = await h.team(olga, "Launch crew", [[mo, "member"]]);
  // Every day 9 to 5, so the preview has room whatever today is.
  await h.call(olga.token, "PUT", "/planner/prefs", {
    work_days: [0, 1, 2, 3, 4, 5, 6],
    work_start: "09:00",
    work_end: "17:00",
  });
  await pool.query(
    "INSERT INTO devices (user_id, token) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [olga.id, `ExponentPushToken[kick-${olga.id.slice(0, 8)}]`],
  );
  const toolsets = ["workspace", "planner", "teams"];
  chat = await connect(olga, {
    team_ids: [crew],
    toolsets,
    forms: true,
    name: "Kickoff (chat)",
  });
  noForms = await connect(olga, {
    kind: "oauth",
    team_ids: [crew],
    toolsets,
    name: "Kickoff (no forms)",
  });
});

after(async () => {
  const { closeLive } = await import("../src/modules/docs/live.js");
  await closeLive();
  assert.deepEqual(network.calls, [], "the kickoff never reached the network");
  network.restore();
  await app.close();
  await pool.end();
});

let project = "";
let firstTask = "";

test("kickoff: a team project, its stages, tasks with a dependency and a milestone in one job", async () => {
  const job = await chat.ok("apply_plan", {
    summary: "Kick off the launch",
    steps: [
      {
        id: "proj",
        tool: "create_project",
        args: {
          name: "Autumn launch",
          team: crew,
          summary: "Ship the autumn release.",
          deadline: `${day(13)}T17:00:00.000Z`,
          stages: [{ name: "Plan" }, { name: "Build" }, { name: "Ship" }],
          page: { title: "Launch brief", markdown: "## Goal\n\nShip it." },
        },
      },
      {
        id: "tasks",
        tool: "create_tasks",
        args: {
          tasks: [
            {
              title: "Write the launch plan",
              project: "$proj.id",
              stage_id: "$proj.stages[0].id",
              estimate_minutes: 60,
              assignee_id: olga.id,
              due_at: `${day(4)}T17:00:00.000Z`,
            },
            {
              title: "Build the landing page",
              project: "$proj.id",
              stage_id: "$proj.stages[1].id",
              estimate_minutes: 90,
              assignee_id: olga.id,
              due_at: `${day(8)}T17:00:00.000Z`,
            },
          ],
        },
      },
      {
        id: "dep",
        tool: "link",
        args: {
          action: "link",
          kind: "depends_on",
          from: "$tasks.ids[1]",
          to: "$tasks.ids[0]",
        },
      },
      {
        id: "milestone",
        tool: "update_project",
        args: {
          project: "$proj.id",
          milestones: [
            { name: "Plan agreed", due_on: day(5), tasks: ["$tasks.ids[0]"] },
          ],
        },
      },
    ],
  });
  assert.equal(job.status, "done");
  assert.equal(chat.asked.length, 0, "her own team project needs no yes");
  project = job.steps[0].done.find((d: any) => d.id.startsWith("project:")).id;
  firstTask = job.steps[1].done[0].id;
  const hub = await chat.ok("get_project", { project });
  assert.deepEqual(
    hub.stages.map((s: any) => s.name),
    ["Plan", "Build", "Ship"],
  );
  assert.equal(hub.milestones.length, 1);
  assert.equal(hub.milestones[0].name, "Plan agreed");
  assert.equal(hub.milestones[0].tasks, 1);
  const waits = (
    await pool.query(
      "SELECT 1 FROM item_dependencies WHERE item_id = $1 AND prerequisite_id = $2",
      [idOf(job.steps[1].done[1].id), idOf(firstTask)],
    )
  ).rowCount;
  assert.equal(waits, 1, "the landing page waits on the plan");
});

test("kickoff: plan_schedule previews the sessions and schedule_sessions books that plan", async () => {
  const preview = await chat.ok("plan_schedule", { project, days: 14 });
  assert.ok(preview.plan_token, JSON.stringify(preview));
  assert.ok(preview.sessions.length >= 2, JSON.stringify(preview));
  // Nothing is booked by a preview.
  const booked = async () =>
    (
      await pool.query(
        `SELECT count(*)::int AS n FROM time_blocks b JOIN items i ON i.id = b.item_id
          WHERE i.project_id = $1`,
        [idOf(project)],
      )
    ).rows[0].n;
  assert.equal(await booked(), 0);
  const made = await chat.ok("schedule_sessions", {
    plan_token: preview.plan_token,
  });
  assert.ok(["done", "partly_pending"].includes(made.status), made.status);
  assert.equal(await booked(), preview.sessions.length);
  // The plan puts the plan before the page that waits on it.
  const order = (
    await pool.query<{ title: string }>(
      `SELECT i.title FROM time_blocks b JOIN items i ON i.id = b.item_id
        WHERE i.project_id = $1 ORDER BY b.start_at`,
      [idOf(project)],
    )
  ).rows.map((r) => r.title);
  assert.equal(order[0], "Write the launch plan");
});

test("kickoff: a teammate's task asks first, in the chat (yes applies) or by push (Approve applies)", async () => {
  const mine = await h.call(mo.token, "POST", "/items", {
    title: "Mo's press list",
    team_id: crew,
    project_id: idOf(project),
  });
  assert.equal(mine.statusCode, 201, mine.body);
  const t = mine.json() as { id: string; version: number };

  // In the chat: one form naming what and why; yes applies it.
  const asked = await chat.call(
    "update_tasks",
    {
      changes: [
        {
          id: `task:${t.id}`,
          version: t.version,
          title: "Mo's press list (final)",
        },
      ],
    },
    YES,
  );
  assert.ok(!asked.isError, asked.content?.[0]?.text);
  assert.equal(chat.asked.length, 1);
  assert.match(chat.asked[0].message, /teammate|Mo/);
  const title = async () =>
    (await pool.query("SELECT title, version FROM items WHERE id = $1", [t.id]))
      .rows[0];
  assert.equal((await title()).title, "Mo's press list (final)");

  // Without forms: it waits in the Review inbox, with a push that carries
  // Approve and Decline; Approve from the phone applies it.
  const pending = await noForms.ok("update_tasks", {
    changes: [
      {
        id: `task:${t.id}`,
        version: (await title()).version,
        title: "Mo's press list (sent)",
      },
    ],
  });
  assert.equal(pending.status, "pending_review");
  assert.equal((await title()).title, "Mo's press list (final)", "not yet");
  const proposal = idOf(pending.pending.proposal_id);
  const push = (
    await pool.query(
      "SELECT kind, ref FROM notifications WHERE ref = $1 AND channel = 'push'",
      [`proposal:${proposal}`],
    )
  ).rows[0];
  assert.ok(push, "a push is queued");
  assert.equal(reviewCategory(push), true, "with Approve and Decline");
  const tapped = await h.call(
    olga.token,
    "POST",
    `/proposals/${proposal}/respond`,
    { decision: "approve" },
  );
  assert.equal(tapped.statusCode, 200, tapped.body);
  assert.deepEqual(tapped.json(), { status: "applied" });
  assert.equal((await title()).title, "Mo's press list (sent)");
  // The agent hears how it ended.
  const outcome = await noForms.ok("fetch", {
    id: `proposal:${proposal}`,
  });
  assert.match(JSON.stringify(outcome), /applied|approved/i);
});

test("kickoff: inviting someone to the team asks first, even at full power", async () => {
  const role = async () =>
    (
      await pool.query(
        "SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2",
        [crew, carl.id],
      )
    ).rows[0]?.role;
  // No form: it waits for the person.
  const waiting = await noForms.ok("organize", {
    changes: [{ do: "invite", id: crew, email: carl.email, role: "member" }],
  });
  assert.equal(waiting.status, "pending_review");
  assert.equal(await role(), undefined);
  // Declined in the chat: nothing.
  const before = chat.asked.length;
  const no = await chat.call(
    "organize",
    {
      changes: [{ do: "invite", id: crew, email: carl.email, role: "member" }],
    },
    () => ({ action: "decline" }),
  );
  assert.equal(no._meta?.["orbyn/error"]?.code, "DECLINED");
  assert.equal(await role(), undefined);
  // Yes: invited.
  const yes = await chat.call(
    "organize",
    {
      changes: [{ do: "invite", id: crew, email: carl.email, role: "member" }],
    },
    YES,
  );
  assert.ok(!yes.isError, yes.content?.[0]?.text);
  assert.equal(chat.asked.length, before + 2, "asked each time");
  assert.match(chat.asked.at(-1)!.message, /invite|Carl|Launch crew/i);
  assert.equal(await role(), "member");
});
