import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";
import { trapNetwork, type Person } from "./mcp-helpers.js";
import { type AgentClient, scenario } from "./e2e-agent-helpers.js";

/**
 * H9 guard: a project kept out of AI (assistant off) is invisible to
 * agents across every read tool. Two kept-out projects (Personal and a
 * team's) hold tasks (one with a session), a page with cards and an exam, a
 * decision and a milestone, and a visible page links into one. Every read
 * tool is called the way an agent would look (and with the kept-out ids
 * themselves); no answer names anything in them. A new read tool fails
 * this test until it is swept too.
 */

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { registry } = await import("../src/capabilities/index.js");
const { drainStudyQueue } = await import("../src/modules/study/service.js");
const { AGENT_TOOLSETS } = await import("@orbyn/core");

const app = await buildApp();
const { h, connect } = scenario(app);
const network = await trapNetwork();

let kim: Person;
let mo: Person;
let crew = "";
let agent: AgentClient;
/** Every id in the kept-out projects, and the words only they contain. */
const secret: string[] = [];
const WORDS = /Zephyr|Quokka/;
let visiblePage = "";
let secretProject = "";
let secretTask = "";
let secretPage = "";
let secretRecord = "";
let exam = "";

const day = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** Something made in the app, its id kept as secret. */
async function made(
  who: Person,
  url: string,
  body: Record<string, unknown>,
): Promise<string> {
  const r = await h.call(who.token, "POST", url, body);
  assert.ok(r.statusCode < 300, `${url}: ${r.body}`);
  const id = r.json().id as string;
  secret.push(id);
  return id;
}

before(async () => {
  await migrate();
  kim = await h.register("ko-kim", "Kim");
  mo = await h.register("ko-mo", "Mo");
  crew = await h.team(kim, "Keepout crew", [[mo, "member"]]);
  await h.call(kim.token, "PUT", "/planner/prefs", {
    timezone: "UTC",
    work_days: [0, 1, 2, 3, 4, 5, 6],
    work_start: "09:00",
    work_end: "17:00",
  });
  // A Personal project kept out, full of things.
  secretProject = await made(kim, "/projects", { name: "Zephyr project" });
  secretTask = await made(kim, "/items", {
    title: "Zephyr task",
    project_id: secretProject,
    estimate_minutes: 90,
    due_at: `${day(2)}T15:00:00.000Z`,
  });
  secretPage = await made(kim, "/docs", {
    title: "Zephyr page",
    project_id: secretProject,
    content: [
      { id: "bz1", type: "paragraph", text: "Zephyr plans in detail." },
      { id: "bz2", type: "bullet", text: "Zephyr card? :: Zephyr answer" },
    ],
  });
  secretRecord = await made(kim, "/work-records", {
    kind: "decision",
    title: "Zephyr decision",
    project_id: secretProject,
  });
  await pool.query(
    `INSERT INTO time_blocks (item_id, user_id, start_at, end_at)
     VALUES ($1, $2, $3, $4)`,
    [secretTask, kim.id, `${day(1)}T13:00:00.000Z`, `${day(1)}T14:00:00.000Z`],
  );
  await pool.query(
    `INSERT INTO project_milestones (project_id, name, due_on)
     VALUES ($1, 'Zephyr milestone', $2)`,
    [secretProject, day(5)],
  );
  // A team's project kept out, with a task assigned to Kim.
  const teamProject = await made(kim, "/projects", {
    name: "Quokka project",
    team_id: crew,
  });
  await made(mo, "/items", {
    title: "Quokka task",
    team_id: crew,
    project_id: teamProject,
    assignee_id: kim.id,
    estimate_minutes: 60,
    due_at: `${day(3)}T15:00:00.000Z`,
  });
  await made(mo, "/docs", {
    title: "Quokka notes",
    team_id: crew,
    project_id: teamProject,
    content: [{ id: "bq1", type: "paragraph", text: "Quokka roadmap." }],
  });
  await pool.query(
    `INSERT INTO ai_chats (id, user_id, project_id, title, turns, scope_kind, scope_id)
     VALUES ($1, $2, $3, 'Zephyr saved chat', $4::jsonb, 'project', $3)`,
    [
      randomUUID(),
      kim.id,
      secretProject,
      JSON.stringify([
        { role: "user", text: "Zephyr private question" },
        {
          role: "assistant",
          text: "Zephyr private answer",
          history_text: "Zephyr private provider context",
        },
      ]),
    ],
  );
  // A visible page that links into the kept-out page.
  const visible = await h.call(kim.token, "POST", "/docs", {
    title: "Visible notes",
    content: [
      {
        id: "bv1",
        type: "paragraph",
        text: `See [the other page](/app/doc/${secretPage}) for more.`,
      },
    ],
  });
  visiblePage = visible.json().id;
  await drainStudyQueue();
  agent = await connect(kim, {
    team_ids: [crew],
    toolsets: [...AGENT_TOOLSETS],
    bookings: true,
    name: "Keep-out sweep",
  });
  // An exam on the kept-out page (and a visible one), named before the
  // project was kept out.
  const named = await agent.ok("update_study", {
    exam: {
      title: "Final",
      date: day(9),
      pages: [`doc:${secretPage}`, `doc:${visiblePage}`],
    },
  });
  exam = named.done[0].id.replace(/^exam:/, "");
  for (const id of [secretProject, teamProject])
    await pool.query("UPDATE projects SET assistant_off = true WHERE id = $1", [
      id,
    ]);
});

after(async () => {
  const { closeLive } = await import("../src/modules/docs/live.js");
  await closeLive();
  assert.deepEqual(network.calls, []);
  network.restore();
  await app.close();
  await pool.end();
});

/**
 * Each read tool, called as an agent looking around (and with kept-out ids
 * where it takes one). Every read tool must be here.
 */
const SWEEP: Record<string, () => Record<string, unknown>[]> = {
  get_context: () => [{}],
  get_profile: () => [{}],
  get_chats: () => [
    {},
    { search: "Zephyr" },
    { search: "Quokka" },
    { project_id: secretProject },
  ],
  search: () => [
    { query: "Zephyr" },
    { query: "Quokka" },
    { query: "Zephyr", match: "title" },
    { query: "notes", types: ["doc", "project", "task", "record"] },
  ],
  fetch: () => [
    { id: `task:${secretTask}` },
    { id: `doc:${secretPage}` },
    { id: `project:${secretProject}` },
    { id: `record:${secretRecord}` },
    { id: "Zephyr page" },
    { id: `doc:${visiblePage}` },
  ],
  get_today: () => [{}],
  get_calendar: () => [{ days: 7, free_minutes: 30 }, { query: "Zephyr" }],
  query: () => [
    { over: "tasks", status: "any" },
    { over: "events" },
    { over: "docs" },
    { over: "projects" },
    { over: "records" },
    { over: "tasks", project: `project:${secretProject}` },
    { over: "docs", links_to: `doc:${secretPage}` },
  ],
  get_project: () => [{ project: `project:${secretProject}` }],
  find_passages: () => [{ query: "Zephyr plans" }, { query: "Quokka roadmap" }],
  plan_schedule: () => [{ days: 7 }, { tasks: [`task:${secretTask}`] }],
  get_links: () => [
    { of: `doc:${visiblePage}` },
    { of: `doc:${secretPage}` },
    { of: `person:${kim.id}` },
    { of: `date:${day(1)}` },
  ],
  list_agent_changes: () => [{}],
  get_inbox: () => [{ include_done: true }],
  get_history: () => [
    { of: "recent" },
    { of: "trash" },
    { of: "changes" },
    { of: `team:${crew}` },
    { of: `project:${secretProject}` },
    { of: `doc:${secretPage}` },
  ],
  get_work_patterns: () => [{ days: 28 }],
  what_if: () => [{ days: 7, drop: [`task:${secretTask}`] }],
  get_study: () => [
    {},
    { queue: true, ahead: true },
    { deck: `doc:${secretPage}`, queue: true, ahead: true },
    { explain: { topic: "Zephyr" } },
    { exam, queue: true, ahead: true },
  ],
  plan_revision: () => [{ exam }],
  get_follow_through: () => [{ days: 14 }],
  get_team: () => [{ team: crew }],
  find_time: () => [{ minutes: 30, team: crew }],
  get_bookings: () => [{ view: "all" }],
  list_imports: () => [{}],
};

test("every read tool is swept", () => {
  const reads = registry.all
    .filter((c) => c.mode === "read" && !c.legacyOnly)
    .map((c) => c.name)
    .sort();
  assert.deepEqual(Object.keys(SWEEP).sort(), reads);
});

test("kept-out projects are invisible to agents across every read tool", async () => {
  const leaks: string[] = [];
  for (const [name, calls] of Object.entries(SWEEP))
    for (const args of calls()) {
      const r = await agent.call(name, args);
      // The visible page's own words hold the link Kim wrote into the
      // kept-out page (its address, never its title): that is her text.
      const text = JSON.stringify(r).replaceAll(`(/app/doc/${secretPage})`, "");
      const hit =
        text.match(WORDS)?.[0] ?? secret.find((id) => text.includes(id));
      if (hit) {
        const at = text.indexOf(hit);
        leaks.push(
          `${name}(${JSON.stringify(args)}) shows ${hit}: …${text.slice(Math.max(0, at - 160), at + 80)}…`,
        );
      }
    }
  assert.deepEqual(leaks, []);
});

test("resources and completions leave kept-out projects out too", async () => {
  const list = await agent.request("resources/list");
  assert.doesNotMatch(JSON.stringify(list.body), WORDS);
  for (const uri of [
    `orbyn://project/${secretProject}`,
    `orbyn://doc/${secretPage}`,
    `orbyn://task/${secretTask}`,
    `orbyn://record/${secretRecord}`,
    "orbyn://today",
    `orbyn://day/${day(1)}`,
  ]) {
    const read = await agent.request("resources/read", { uri });
    const text = JSON.stringify(read.body);
    assert.doesNotMatch(text, WORDS, uri);
  }
  const done = await agent.request("completion/complete", {
    ref: { type: "ref/prompt", name: "catch_up_on_project" },
    argument: { name: "project", value: "Z" },
  });
  assert.doesNotMatch(JSON.stringify(done.body), WORDS);
});
