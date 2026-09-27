import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";
import nodemailer from "nodemailer";
import { helpers, trapNetwork, type Person } from "./mcp-helpers.js";

/**
 * H7: you always know what happened. Every change's answer carries the web
 * link and the phone app's link (and says them in words); "via <agent>" on
 * a task's updates, comments, Recent changes, notices, the page an agent
 * wrote and the Review inbox; one push (and in-app notice) when a job or
 * a burst of calls makes more than 20 changes; "What your agents did" in
 * the morning digest; and undoing a whole job from Connected agents.
 */

// Capture every email the digest sends.
const sent: { to: string; subject: string; text: string }[] = [];
mock.method(nodemailer, "createTransport", () => ({
  sendMail: async (m: { to: string; subject: string; text: string }) => {
    sent.push({ to: m.to, subject: m.subject, text: m.text });
    return { messageId: "test" };
  },
  close: () => {},
  verify: async () => true,
}));

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { env } = await import("../src/config/env.js");
const { invalidateSettings } = await import("../src/lib/settings.js");
const { limiter, strikes } =
  await import("../src/modules/mcp-server/routes.js");
const { scanAgentJobs, finishedJobs } =
  await import("../src/worker/agent-jobs.js");
const { buildMorning, buildAgentSection, scanDigests } =
  await import("../src/worker/digest.js");
const { appLinkFor } = await import("../src/capabilities/refs.js");
const { AGENT_TOOLSETS, agentJobText, agentWorkWords, groupAgentActivity } =
  await import("@orbyn/core");

const app = await buildApp();
const h = helpers(app);
const network = await trapNetwork();
const ALL = [...AGENT_TOOLSETS];
const base = () => env.APP_URL.replace(/\/+$/, "");

let olga: Person;
let mo: Person;
let crew = "";
const keys: Record<string, string> = {};
const grants: Record<string, string> = {};

type Result = {
  content: { type: string; text: string }[];
  structuredContent?: any;
  isError?: boolean;
  _meta?: Record<string, any>;
};

async function tool(
  key: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Result> {
  limiter.reset();
  strikes.reset();
  const r = await h.tool(key, name, args);
  assert.ok(r, `${name}: no result`);
  return r as Result;
}
const ok = (r: Result, what = "call") => {
  assert.ok(!r.isError, `${what}: ${r.content?.[0]?.text}`);
  return r.structuredContent;
};
const idOf = (typed: string) =>
  typed.replace(/^[\w]+:(\/\/\w+\/)?/, "").slice(0, 36);
const later = (minutes: number) => new Date(Date.now() + minutes * 60_000);
const titles = (n: number, tag: string) =>
  Array.from({ length: n }, (_, i) => ({ title: `${tag} ${i + 1}` }));

/** Each done entry opens on the web and in the app, the same thing. */
function linked(r: Result, what: string) {
  const s = ok(r, what);
  const done = (s.done ?? s.steps?.flatMap((x: any) => x.done)) as any[];
  assert.ok(done?.length, `${what}: something was done`);
  for (const d of done) {
    assert.ok(d.url.startsWith(`${base()}/app`), `${what}: web ${d.url}`);
    assert.equal(
      d.app_url,
      `orbyn://${d.url.slice(`${base()}/app/`.length) || "today"}`,
      `${what}: app link`,
    );
  }
  // The summary ends with the links, in words.
  const text = r.content[0].text;
  const tail = text.slice(text.lastIndexOf("Links:"));
  assert.ok(text.includes("Links:"), `${what}: ${text}`);
  assert.match(tail, /on the web: https?:\/\//);
  assert.match(tail, /in the Orbyn app: orbyn:\/\//);
  return s;
}

/**
 * The notices about big jobs a person has (in the app), from one of their
 * connections or any. Agent keys go by "Agent key", as in project history.
 */
const jobNotices = async (who: Person, grant?: string) =>
  (
    await pool.query<{ title: string; body: string; ref: string }>(
      `SELECT title, body, ref FROM notifications
        WHERE user_id = $1 AND kind = 'agent' AND channel = 'inapp'
          AND title LIKE '%finished a big job'
          AND ($2::text IS NULL OR ref = 'grant:' || $2)
        ORDER BY created_at`,
      [who.id, grant ?? null],
    )
  ).rows;

async function setMail(on: boolean) {
  if (on)
    await pool.query(
      `INSERT INTO system_settings (key, value) VALUES ('smtp', $1)
         ON CONFLICT (key) DO UPDATE SET value = $1`,
      [JSON.stringify({ host: "smtp.test", port: 587, from: "orbyn@test" })],
    );
  else await pool.query("DELETE FROM system_settings WHERE key='smtp'");
  invalidateSettings();
}

before(async () => {
  await migrate();
  olga = await h.register("h7-olga", "Olga");
  mo = await h.register("h7-mo", "Mo");
  crew = await h.team(olga, "Biology", [[mo, "member"]]);
  const make = async (name: string, who: Person, body = {}) => {
    const k = await h.agentKey(who, {
      name: `Agent ${name}`,
      access: "write",
      toolsets: ALL,
      team_ids: [crew],
      ...body,
    });
    keys[name] = k.key;
    grants[name] = k.id;
  };
  for (const n of ["links", "job", "burst", "plan", "off", "via", "undo"])
    await make(n, olga);
  await make("suggest", olga, { trust: "suggest" });
  await make("mo", mo);
  // Nothing earlier in this file's database run counts as a new job.
  await pool.query(
    "UPDATE agent_activity SET reported_at = now() WHERE reported_at IS NULL",
  );
});

after(async () => {
  await pool.query("DELETE FROM system_settings WHERE key='smtp'");
  invalidateSettings();
  const { closeLive } = await import("../src/modules/docs/live.js");
  await closeLive();
  network.restore();
  await app.close();
  await pool.end();
});

// --- 1. Links ---------------------------------------------------------------

test("links: the app link is the web link's path on orbyn://", () => {
  assert.equal(
    appLinkFor(`${base()}/app/doc/0b7c1f7e-1111-4111-8111-111111111111#b12`),
    "orbyn://doc/0b7c1f7e-1111-4111-8111-111111111111#b12",
  );
  assert.equal(appLinkFor(`${base()}/app/today`), "orbyn://today");
  assert.equal(appLinkFor(`${base()}/app`), "orbyn://today");
  assert.equal(appLinkFor("orbyn://task/x"), "orbyn://task/x");
  assert.equal(appLinkFor("https://elsewhere.test/app/task/x"), "");
  assert.equal(appLinkFor(""), "");
});

test("links: every write family answers with web and app links, said in words", async () => {
  const k = keys.links;
  const tasks = linked(
    await tool(k, "create_tasks", { tasks: titles(2, "Linked") }),
    "create_tasks",
  );
  const [a, b] = tasks.done;
  linked(
    await tool(k, "update_tasks", {
      changes: [{ id: a.id, version: a.version, title: "Linked one" }],
    }),
    "update_tasks",
  );
  linked(
    await tool(k, "link", {
      action: "link",
      kind: "depends_on",
      from: b.id,
      to: a.id,
    }),
    "link",
  );
  linked(
    await tool(k, "complete_tasks", {
      tasks: [
        {
          id: b.id,
          version: (
            await pool.query("SELECT version FROM items WHERE id = $1", [
              idOf(b.id),
            ])
          ).rows[0].version,
        },
      ],
    }),
    "complete_tasks",
  );
  const page = linked(
    await tool(k, "create_doc", {
      title: "Linked notes",
      markdown: "First ^bone\n\nSecond ^btwo",
    }),
    "create_doc",
  );
  const docId = idOf(page.done[0].id);
  linked(
    await tool(k, "edit_doc", {
      doc: page.done[0].id,
      version: page.done[0].version,
      edits: [{ op: "append", markdown: "Third" }],
    }),
    "edit_doc",
  );
  linked(
    await tool(k, "organize", {
      changes: [{ do: "aliases", id: `doc:${docId}`, add: ["Linked"] }],
    }),
    "organize",
  );
  linked(
    await tool(k, "create_project", { name: "Linked project" }),
    "create_project",
  );
  linked(
    await tool(k, "save_view", { name: "Linked view", source: "tasks" }),
    "save_view",
  );
  linked(
    await tool(k, "update_study", {
      cards: {
        page: `doc:${docId}`,
        items: [{ q: "Linked?", a: "Yes" }],
      },
    }),
    "update_study",
  );
  linked(
    await tool(k, "add_progress", { task: a.id, note: "Halfway" }),
    "add_progress",
  );
  const plan = linked(
    await tool(k, "apply_plan", {
      steps: [
        {
          id: "notes",
          tool: "create_doc",
          args: { title: "Plan notes", markdown: "Plan" },
        },
        {
          id: "todo",
          tool: "create_tasks",
          args: { tasks: [{ title: "Plan task" }] },
        },
      ],
    }),
    "apply_plan",
  );
  assert.equal(plan.status, "done");
  // save_source: the page it was saved for, both ways.
  const src = ok(
    await tool(k, "save_source", {
      url: "https://example.org/linked",
      title: "Linked source",
      doc: `doc:${docId}`,
      lines: ["^bone"],
    }),
  );
  assert.equal(src.url, `${base()}/app/doc/${docId}`);
  assert.equal(src.app_url, `orbyn://doc/${docId}`);
  const bare = ok(
    await tool(k, "save_source", {
      url: "https://example.org/bare",
      title: "No page",
    }),
  );
  assert.equal(bare.url, null);
  assert.equal(bare.app_url, null);
  // A refusal carries no links (nothing was done).
  const none = await tool(keys.links, "update_tasks", {
    changes: [{ id: a.id, version: 1, title: "Stale" }],
  });
  assert.ok(!(none.content[0].text ?? "").includes("in the Orbyn app"));
});

// --- 2. via <agent> -----------------------------------------------------------

test("via: a task's updates, comments, Recent changes, notices, the Review inbox and an agent's page", async () => {
  const k = keys.via;
  const name = "Agent key";
  // A team task and a progress update on it.
  const t = ok(
    await tool(k, "create_tasks", {
      tasks: [{ title: "Via task", team: crew }],
    }),
  ).done[0];
  ok(await tool(k, "add_progress", { task: t.id, note: "Started it" }));
  const detail = (
    await h.call(olga.token, "GET", `/items/${idOf(t.id)}`)
  ).json();
  const update = detail.updates.find((u: any) => u.body === "Started it");
  assert.equal(update.via_agent, name);
  // A person's own update is theirs alone.
  await h.call(olga.token, "POST", `/items/${idOf(t.id)}/updates`, {
    body: "By hand",
  });
  const again = (
    await h.call(olga.token, "GET", `/items/${idOf(t.id)}`)
  ).json();
  const mine = again.updates.find((u: any) => u.body === "By hand");
  if (mine) assert.equal(mine.via_agent ?? null, null);

  // A comment on a page.
  const page = ok(
    await tool(k, "create_doc", { title: "Via page", markdown: "Words ^bw" }),
  ).done[0];
  ok(
    await tool(k, "comment_on_doc", {
      doc: page.id,
      body: "Check this line",
      line: "^bw",
    }),
  );
  const comments = JSON.stringify(
    (await h.call(olga.token, "GET", `/docs/${idOf(page.id)}/comments`)).json(),
  );
  assert.match(comments, /"via_agent":"Agent key"/);

  // Recent changes: the agent's team change shows, with "hide mine" on.
  const changes = (
    await h.call(olga.token, "GET", `/changes?team_id=${crew}`)
  ).json().changes;
  const change = changes.find((c: any) => c.object_id === idOf(t.id));
  assert.ok(change, "the agent's change is news even with mine hidden");
  assert.equal(change.via_agent, name);
  // The same person's change by hand doesn't fold into the agent's.
  await h.call(olga.token, "PATCH", `/items/${idOf(t.id)}`, {
    title: "Via task (by hand)",
  });
  const rows = (
    await pool.query(
      "SELECT via_grant_id FROM team_changes WHERE object_id = $1 ORDER BY at",
      [idOf(t.id)],
    )
  ).rows;
  assert.equal(rows[0].via_grant_id, grants.via);

  // The page an agent wrote says so until the person writes in it.
  const read = (
    await h.call(olga.token, "GET", `/docs/${idOf(page.id)}`)
  ).json();
  assert.equal(read.via_agent, name);
  await pool.query("UPDATE docs SET content = content WHERE id = $1", [
    idOf(page.id),
  ]);
  assert.equal(
    (await h.call(olga.token, "GET", `/docs/${idOf(page.id)}`)).json()
      .via_agent,
    null,
  );
  // An agenda page an agent wrote (on the agenda's own connection).
  const agenda = ok(
    await tool(k, "create_doc", { title: "today", kind: "agenda" }),
    "agenda",
  ).done[0];
  assert.equal(
    (await h.call(olga.token, "GET", `/docs/${idOf(agenda.id)}`)).json()
      .via_agent,
    name,
  );

  // A notice the agent's change caused (a question it asked) says via.
  ok(
    await tool(k, "ask_person", {
      question: "Move the lab to Friday?",
      choices: ["Yes", "No"],
    }),
  );
  const notices = (await h.call(olga.token, "GET", "/notifications")).json();
  const asked = notices.find((n: any) => n.kind === "question");
  assert.equal(asked.via_agent, name);
  // A reminder is about the thing, never labelled.
  const reminders = notices.filter((n: any) => n.kind === "reminder");
  for (const n of reminders) assert.equal(n.via_agent ?? null, null);

  // The Review inbox names the agent that suggested it.
  ok(
    await tool(keys.suggest, "create_tasks", {
      tasks: [{ title: "Suggested" }],
    }),
  );
  const inbox = (await h.call(olga.token, "GET", "/proposals")).json();
  assert.match(JSON.stringify(inbox), /Agent key/);
});

// --- 3. The push for big jobs ---------------------------------------------------

test("push: a burst of 20 changes is quiet, 21 is one notice, once", async () => {
  const k = keys.job;
  ok(await tool(k, "create_tasks", { tasks: titles(20, "Twenty") }));
  assert.equal(await scanAgentJobs(later(3)), 0);
  assert.equal((await jobNotices(olga)).length, 0);
  ok(await tool(k, "create_tasks", { tasks: titles(21, "Twenty-one") }));
  // Still at work (less than two minutes quiet): not yet.
  await scanAgentJobs(new Date());
  assert.equal((await jobNotices(olga)).length, 0);
  assert.equal(await scanAgentJobs(later(3)), 1);
  const [n] = await jobNotices(olga);
  assert.equal(n.title, "Agent key finished a big job");
  assert.match(n.body, /^Agent key added 21 tasks\. /);
  assert.match(n.body, /Settings → Connected agents/);
  assert.equal(n.ref, `grant:${grants.job}`);
  // Looked at once: scanning again sends nothing more.
  assert.equal(await scanAgentJobs(later(4)), 0);
  assert.equal((await jobNotices(olga)).length, 1);
  // The notice says which agent, in the app's list.
  const listed = (await h.call(olga.token, "GET", "/notifications"))
    .json()
    .find((x: any) => x.ref === `grant:${grants.job}`);
  assert.equal(listed.via_agent, "Agent key");
});

test("push: calls under two minutes apart are one burst; further apart, two", async () => {
  const k = keys.burst;
  const before = (await jobNotices(olga)).length;
  ok(await tool(k, "create_tasks", { tasks: titles(11, "Burst a") }));
  ok(await tool(k, "create_tasks", { tasks: titles(10, "Burst b") }));
  assert.equal(await scanAgentJobs(later(3)), 1, "11 + 10 in one burst");
  const last = (await jobNotices(olga)).at(-1)!;
  assert.equal(last.ref, `grant:${grants.burst}`);
  assert.match(last.body, /^Agent key added 21 tasks/);
  // The same, but ten minutes apart: two bursts of 11 and 10, no push.
  ok(await tool(k, "create_tasks", { tasks: titles(11, "Apart a") }));
  await pool.query(
    `UPDATE agent_activity SET at = at - interval '10 minutes'
      WHERE grant_id = $1 AND reported_at IS NULL`,
    [grants.burst],
  );
  ok(await tool(k, "create_tasks", { tasks: titles(10, "Apart b") }));
  assert.equal(await scanAgentJobs(later(3)), 0);
  assert.equal((await jobNotices(olga)).length, before + 1);
});

test("push: an apply_plan job over 20 changes is one notice; 20 isn't", async () => {
  const k = keys.plan;
  const plan = (n: number, tag: string) => ({
    steps: [
      {
        id: "first",
        tool: "create_tasks",
        args: { tasks: titles(Math.ceil(n / 2), `${tag} a`) },
      },
      {
        id: "second",
        tool: "create_tasks",
        args: { tasks: titles(Math.floor(n / 2), `${tag} b`) },
      },
    ],
  });
  const before = (await jobNotices(olga)).length;
  ok(await tool(k, "apply_plan", plan(20, "Plan twenty")));
  assert.equal(await scanAgentJobs(later(3)), 0);
  ok(await tool(k, "apply_plan", plan(21, "Plan twenty-one")));
  // A plan is finished when it's made: no wait for the quiet.
  assert.equal(await scanAgentJobs(later(0.1)), 1);
  const notices = await jobNotices(olga);
  assert.equal(notices.length, before + 1);
  // The plan's own row isn't counted again on top of its steps.
  assert.equal(notices.at(-1)!.ref, `grant:${grants.plan}`);
  assert.match(notices.at(-1)!.body, /^Agent key added 21 tasks\./);
});

test("push: a team job names the team; the person can turn the push off", async () => {
  const before = (await jobNotices(olga)).length;
  ok(
    await tool(keys.off, "create_tasks", {
      tasks: titles(21, "Team").map((t) => ({ ...t, team: crew })),
    }),
  );
  assert.equal(await scanAgentJobs(later(3)), 1);
  assert.match(
    (await jobNotices(olga)).at(-1)!.body,
    /^Agent key added 21 tasks in Biology\./,
  );
  const off = await h.call(olga.token, "PUT", "/planner/prefs", {
    digest: { agent_push: false },
  });
  assert.equal(off.statusCode, 200, off.body);
  ok(await tool(keys.off, "create_tasks", { tasks: titles(25, "Muted") }));
  assert.equal(await scanAgentJobs(later(3)), 0);
  assert.equal((await jobNotices(olga)).length, before + 1);
  // Looked at while off: turning it back on doesn't tell of old work.
  await h.call(olga.token, "PUT", "/planner/prefs", {
    digest: { agent_push: true },
  });
  assert.equal(await scanAgentJobs(later(3)), 0);
});

test("push: one push per job for each phone, beside the in-app notice", async () => {
  await pool.query("INSERT INTO devices (token, user_id) VALUES ($1, $2)", [
    `ExponentPushToken[h7-${mo.id.slice(0, 8)}]`,
    mo.id,
  ]);
  ok(await tool(keys.mo, "create_tasks", { tasks: titles(22, "Mo") }));
  assert.equal(await scanAgentJobs(later(3)), 1);
  const rows = (
    await pool.query<{ channel: string; n: number }>(
      `SELECT channel, count(*)::int AS n FROM notifications
        WHERE user_id = $1 AND kind = 'agent' GROUP BY channel`,
      [mo.id],
    )
  ).rows;
  assert.deepEqual(Object.fromEntries(rows.map((r) => [r.channel, r.n])), {
    inapp: 1,
    push: 1,
  });
});

test("push: the finished-job split, plans whole and bursts by the gap", () => {
  const t0 = Date.parse("2026-09-27T10:00:00Z");
  const row = (id: string, min: number, job: string | null, changes = 1) => ({
    id,
    at: new Date(t0 + min * 60_000),
    user_id: "u",
    client_name: "Claude",
    tool: "create_tasks",
    request_id: job,
    team_id: null,
    changes,
    kinds: { "added:task": changes },
  });
  const rows = [
    row("1", 0, "r1"),
    row("2", 1, "r2"),
    row("3", 5, "plan_x", 30),
    row("4", 9, "r3"),
    row("5", 10, "r4"),
  ];
  const at = (min: number) => new Date(t0 + min * 60_000);
  const soon = finishedJobs(rows, at(11));
  // The plan is whole; 1–2 is a closed burst; 4–5 still open.
  assert.deepEqual(
    soon.jobs.map((j) => j.rows.map((r) => r.id)),
    [["3"], ["1", "2"]],
  );
  assert.deepEqual(
    soon.open.map((r) => r.id),
    ["4", "5"],
  );
  const quiet = finishedJobs(rows, at(13));
  assert.deepEqual(
    quiet.jobs.map((j) => j.rows.map((r) => r.id)),
    [["3"], ["1", "2"], ["4", "5"]],
  );
});

test("words: a job in plain words", () => {
  assert.equal(
    agentJobText(
      "Claude",
      { "added:card": 12, "added:task": 3, "changed:doc": 1 },
      "Biology",
    ),
    "Claude added 12 cards and 3 tasks, and changed 1 page in Biology.",
  );
  assert.equal(agentWorkWords({ "finished:task": 1 }), "finished 1 task");
  assert.equal(agentJobText("Claude", {}), "Claude made no changes.");
  const jobs = groupAgentActivity([
    {
      id: "3",
      at: "2026-09-27T10:02:00Z",
      job: "j2",
      changes: 2,
      kinds: { "added:task": 2 },
      undoable: true,
    } as any,
    {
      id: "2",
      at: "2026-09-27T10:01:00Z",
      job: "j1",
      changes: 1,
      kinds: { "added:doc": 1 },
      undoable: true,
    } as any,
    {
      id: "1",
      at: "2026-09-27T10:00:00Z",
      job: "j1",
      changes: 3,
      kinds: { "added:card": 3 },
      undoable: false,
    } as any,
    {
      id: "0",
      at: "2026-09-27T09:00:00Z",
      job: null,
      changes: 0,
      kinds: null,
      undoable: false,
    } as any,
  ]);
  assert.deepEqual(
    jobs.map((j) => [j.id, j.rows.length, j.changes, j.undoable]),
    [
      ["job:j2", 1, 2, true],
      ["job:j1", 2, 4, true],
      ["row:0", 1, 0, false],
    ],
  );
  assert.deepEqual(jobs[1].kinds, { "added:doc": 1, "added:card": 3 });
});

// --- 4. The daily digest ------------------------------------------------------

test("digest: no agent activity, no section", async () => {
  const quiet = await h.register("h7-quiet", "Quinn");
  assert.deepEqual(await buildAgentSection(quiet.id, new Date()), []);
  await pool.query(
    `INSERT INTO agent_settings (user_id, name, persona, named_at)
     VALUES ($1, 'Mira', '', now())`,
    [quiet.id],
  );
  const m = await buildMorning(quiet.id, "Quinn", new Date(), "UTC");
  assert.ok(!m.lines.some((l) => /What your agents did/.test(l)));
  assert.match(m.lines[0], /Mira here with your day ahead/);
});

test("digest: what each agent did, the top items with links, what waits, and where to undo", async () => {
  const lines = await buildAgentSection(olga.id, later(1));
  const text = lines.join("\n");
  assert.equal(lines[0], "What your agents did:");
  // One line per connection (keys go by "Agent key").
  assert.match(text, /• Agent key added \d+ tasks/);
  assert.match(text, /Agent key suggested a change for your review/);
  assert.ok(lines.filter((l) => l.startsWith("• Agent key")).length >= 7, text);
  assert.match(text, /Things they touched:/);
  assert.match(
    text,
    new RegExp(`${base()}/app/(task|doc|project)/[0-9a-f-]{36}`),
  );
  assert.match(text, /Waiting for you: 1 question and 1 suggestion to review/);
  assert.match(
    text,
    new RegExp(
      `Undo any change, or a whole job, in Settings → Connected agents: ${base()}/app/agents`,
    ),
  );
  // Undone changes aren't told.
  const other = await h.register("h7-undone", "Una");
  const k = await h.agentKey(other, { access: "write", toolsets: ALL });
  ok(await tool(k.key, "create_tasks", { tasks: [{ title: "Gone" }] }));
  await pool.query(
    "UPDATE agent_activity SET undone_at = now() WHERE grant_id = $1",
    [k.id],
  );
  assert.deepEqual(await buildAgentSection(other.id, later(1)), []);
});

test("digest: the morning email has the section, and the off switch leaves it out", async () => {
  await setMail(true);
  const put = async (digest: Record<string, unknown>) =>
    assert.equal(
      (
        await h.call(olga.token, "PUT", "/planner/prefs", {
          timezone: "UTC",
          digest: { morning: true, morning_time: "00:00", ...digest },
        })
      ).statusCode,
      200,
    );
  await put({});
  await pool.query("DELETE FROM digest_sends WHERE user_id = $1", [olga.id]);
  sent.length = 0;
  await scanDigests(new Date());
  const mail = sent.find((m) => m.to === olga.email);
  assert.ok(mail, "the morning digest went out");
  assert.match(mail.text, /What your agents did:/);
  await put({ agents: false });
  const prefs = (await h.call(olga.token, "GET", "/planner/prefs")).json();
  assert.equal(prefs.digest.agents, false);
  await pool.query("DELETE FROM digest_sends WHERE user_id = $1", [olga.id]);
  sent.length = 0;
  await scanDigests(new Date());
  const off = sent.find((m) => m.to === olga.email);
  assert.ok(off);
  assert.doesNotMatch(off.text, /What your agents did/);
  await put({ agents: true, morning: false });
  await setMail(false);
});

// --- 5. Undoing a whole job -----------------------------------------------------

test("job undo: 401, 403 for keys, 404 for another's or unknown, then all of it, then 409", async () => {
  const r = ok(
    await tool(keys.undo, "apply_plan", {
      steps: [
        {
          id: "a",
          tool: "create_tasks",
          args: { tasks: titles(2, "Undo me") },
        },
        {
          id: "b",
          tool: "create_doc",
          args: { title: "Undo page", markdown: "x" },
        },
      ],
    }),
  );
  const job = r.job as string;
  const url = (grant: string, j = job) =>
    `/me/agents/${grant}/jobs/${encodeURIComponent(j)}/undo`;
  // Activity lists the job, its changes in words and its links.
  const activity = (
    await h.call(olga.token, "GET", `/me/agents/${grants.undo}/activity`)
  ).json();
  const step = activity.find((a: any) => a.job === job && a.changes === 2);
  assert.ok(step, "the plan's step, with its job and count");
  assert.deepEqual(step.kinds, { "added:task": 2 });
  assert.equal(step.links.length, 2);
  assert.equal(step.links[0].kind, "task");
  assert.match(step.links[0].title, /^Undo me/);

  assert.equal((await h.call(null, "POST", url(grants.undo))).statusCode, 401);
  const apiKey = (
    await h.call(olga.token, "POST", "/me/api-keys", { name: "h7 rest" })
  ).json().key;
  assert.equal(
    (await h.call(apiKey, "POST", url(grants.undo))).statusCode,
    403,
  );
  // Someone else can't, even with the right ids.
  assert.equal(
    (await h.call(mo.token, "POST", url(grants.undo))).statusCode,
    404,
  );
  // Another of Olga's connections, or a job that isn't one.
  assert.equal(
    (await h.call(olga.token, "POST", url(grants.links))).statusCode,
    404,
  );
  assert.equal(
    (await h.call(olga.token, "POST", url(grants.undo, "plan_nope")))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await h.call(
        olga.token,
        "POST",
        `/me/agents/not-a-grant/jobs/${job}/undo`,
      )
    ).statusCode,
    404,
  );
  const done = await h.call(olga.token, "POST", url(grants.undo));
  assert.equal(done.statusCode, 200, done.body);
  assert.equal(done.json().undone, 2);
  const left = (
    await pool.query(
      "SELECT count(*)::int AS n FROM items WHERE user_id = $1 AND title LIKE 'Undo me%'",
      [olga.id],
    )
  ).rows[0].n;
  assert.equal(left, 0);
  const page = (
    await pool.query(
      "SELECT deleted_at FROM docs WHERE user_id = $1 AND title = 'Undo page'",
      [olga.id],
    )
  ).rows[0];
  assert.ok(page.deleted_at, "the page went to the Trash");
  assert.equal(
    (await h.call(olga.token, "POST", url(grants.undo))).statusCode,
    409,
  );
  assert.deepEqual(network.calls, []);
});
