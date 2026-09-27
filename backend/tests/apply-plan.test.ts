import { test, before, after } from "node:test";
import assert from "node:assert/strict";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";
import {
  helpers,
  trapNetwork,
  bearer,
  META_KEYS,
  MODERN,
  type Person,
} from "./mcp-helpers.js";

/**
 * H5: one call, whole job. apply_plan checks every step first (refusing a
 * wrong plan whole, with a report per step), runs the steps in one
 * transaction with $refs to earlier results, all or nothing; asks once for
 * the whole plan (in the chat, or as one Review inbox proposal that makes
 * it all when approved); records it as one job that undo takes back; and
 * replays a retried client_ref. Plus the new prompts, offered by toolset.
 */

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { limiter, strikes } =
  await import("../src/modules/mcp-server/routes.js");
const { registry } = await import("../src/capabilities/index.js");
const { describe } = await import("../src/capabilities/registry.js");
const { PLAN_TOOLS } = await import("../src/capabilities/plan-run.js");
const { AGENT_TOOLSETS } = await import("@orbyn/core");

const app = await buildApp();
const h = helpers(app);
const network = await trapNetwork();

let olga: Person;
let mo: Person;
let crew = "";
const keys: Record<string, string> = {};
const grants: Record<string, string> = {};
const ALL = [...AGENT_TOOLSETS];

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

/** A 2026-07-28 tools/call with the client's capabilities (and a retry). */
async function modern(
  key: string,
  name: string,
  args: Record<string, unknown>,
  caps: Record<string, unknown>,
  retry?: { state: string; responses: Record<string, unknown> },
) {
  limiter.reset();
  strikes.reset();
  const r = await h.post(
    {
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: {
        name,
        arguments: args,
        ...(retry
          ? { requestState: retry.state, inputResponses: retry.responses }
          : {}),
        _meta: {
          [META_KEYS.version]: MODERN,
          [META_KEYS.client]: { name: "test", version: "1" },
          [META_KEYS.caps]: caps,
        },
      },
    },
    {
      ...bearer(key),
      "mcp-protocol-version": MODERN,
      "mcp-method": "tools/call",
      "mcp-name": name,
    },
  );
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}

const FORM = { elicitation: { form: {} } };
const code = (r: Result) => r._meta?.["orbyn/error"]?.code as string;
const ok = (r: Result, what = "call") => {
  assert.ok(!r.isError, `${what}: ${r.content?.[0]?.text}`);
  return r.structuredContent;
};
const idOf = (typed: string) => typed.replace(/^\w+:/, "").slice(0, 36);
const docsTitled = async (title: string) =>
  (
    await pool.query<{ id: string; deleted_at: Date | null; content: any[] }>(
      "SELECT id, deleted_at, content FROM docs WHERE title = $1 AND user_id = $2",
      [title, olga.id],
    )
  ).rows;
const tasksTitled = async (title: string) =>
  (
    await pool.query<{ id: string; title: string }>(
      "SELECT id, title FROM items WHERE title = $1 AND user_id = $2",
      [title, olga.id],
    )
  ).rows;
const proposalsOf = async (grant: string) =>
  (
    await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM proposals WHERE grant_id = $1",
      [grant],
    )
  ).rows[0].n;

/** A review session's half hour, `days` ahead at 09:00 UTC. */
const slot = (days: number) => {
  const d = new Date(Date.now() + days * 86_400_000);
  d.setUTCHours(9, 0, 0, 0);
  return {
    start_at: d.toISOString(),
    end_at: new Date(d.getTime() + 30 * 60_000).toISOString(),
  };
};

/** A lecture turned into notes, cards, tasks, a link and a first review. */
const lecture = (tag: string, earlier: string, days = 2) => ({
  summary: `Lecture ${tag} into notes`,
  steps: [
    {
      id: "notes",
      tool: "create_doc",
      args: {
        title: `Cells ${tag}`,
        markdown: `## Energy ^energy\n\nMitochondria make ATP [src: Lecture 5 slides, slide 12] ^atp\n\nSee [[Biology basics ${tag}]].`,
      },
    },
    {
      id: "cards",
      tool: "update_study",
      args: {
        cards: {
          page: "$notes.id",
          items: [
            {
              q: "What makes ATP?",
              a: "Mitochondria",
              from: "$notes.lines.atp",
            },
            { cloze: "{{Mitochondria}} make ATP", from: "$notes.lines.atp" },
          ],
        },
      },
    },
    {
      id: "tasks",
      tool: "create_tasks",
      args: {
        tasks: [
          { title: `Review: Cells ${tag}`, estimate_minutes: 30 },
          { title: `Read chapter 5 ${tag}`, notes: "From {$notes.uri}" },
        ],
      },
    },
    {
      id: "rel",
      tool: "link",
      args: { action: "link", kind: "related", from: "$notes.id", to: earlier },
    },
    {
      id: "review",
      tool: "schedule_sessions",
      args: { sessions: [{ task: "$tasks.ids[0]", ...slot(days) }] },
    },
  ],
});

/** A page of the person's own the lecture links to. */
const earlierPage = async (key: string, tag: string) =>
  ok(
    await tool(key, "create_doc", {
      title: `Biology basics ${tag}`,
      markdown: "Cells are small.",
    }),
  ).done[0].id as string;

/** A task of Mo's in the crew: a teammate's work for Olga. */
const mosTask = async (title: string) =>
  (
    await h.call(mo.token, "POST", "/items", { title, team_id: crew })
  ).json() as { id: string; version: number };

before(async () => {
  await migrate();
  olga = await h.register("plan-olga", "Olga");
  mo = await h.register("plan-mo", "Mo");
  crew = await h.team(olga, "Plan crew", [[mo, "member"]]);
  const make = async (name: string, body: Record<string, unknown>) => {
    const k = await h.agentKey(olga, { team_ids: [crew], ...body });
    keys[name] = k.key;
    grants[name] = k.id;
  };
  await make("full", { access: "write", toolsets: ALL });
  await make("ask", { access: "write", toolsets: ALL, trust: "ask" });
  await make("suggest", { access: "write", toolsets: ALL, trust: "suggest" });
  await make("core", { access: "write" });
});

after(async () => {
  const { closeLive } = await import("../src/modules/docs/live.js");
  await closeLive();
  assert.deepEqual(network.calls, [], "plans never reach the network");
  network.restore();
  await app.close();
  await pool.end();
});

test("a lecture-style plan (page, cards, tasks, link, session) applies at once as one job", async () => {
  const earlier = await earlierPage(keys.full, "A");
  const r = ok(await tool(keys.full, "apply_plan", lecture("A", earlier)));
  assert.equal(r.status, "done");
  assert.match(r.job, /^plan_[\w-]{16}$/);
  assert.deepEqual(
    r.steps.map((s: any) => s.id),
    ["notes", "cards", "tasks", "rel", "review"],
  );
  for (const s of r.steps) assert.ok(s.done.length, `${s.id} made something`);
  const [doc] = await docsTitled("Cells A");
  assert.ok(doc && !doc.deleted_at);
  const text = JSON.stringify(doc.content);
  assert.match(text, /What makes ATP\?/);
  assert.match(text, /orbyn:\/\/doc\/[0-9a-f-]{36}#atp/, "cards cite the line");
  // The task's notes had the page's address put in.
  const read = (
    await pool.query(
      "SELECT notes FROM items WHERE title = 'Read chapter 5 A' AND user_id = $1",
      [olga.id],
    )
  ).rows[0];
  assert.match(read.notes, new RegExp(`orbyn://doc/${doc.id}`));
  const [review] = await tasksTitled("Review: Cells A");
  const sessions = (
    await pool.query("SELECT 1 FROM time_blocks WHERE item_id = $1", [
      review.id,
    ])
  ).rowCount;
  assert.equal(sessions, 1);
  // The related link, both ways.
  const links = ok(await tool(keys.full, "get_links", { of: earlier }));
  assert.ok(
    JSON.stringify(links).includes(doc.id),
    "the earlier page links back",
  );
  // One job: every step's change carries it.
  const changes = ok(
    await tool(keys.full, "list_agent_changes", { limit: 20 }),
  ).changes.filter((c: any) => c.job === r.job);
  assert.deepEqual(changes.map((c: any) => c.tool).sort(), [
    "apply_plan",
    "create_doc",
    "create_tasks",
    "link",
    "schedule_sessions",
    "update_study",
  ]);
  // Projects and their stages are reachable from later steps.
  const proj = ok(
    await tool(keys.full, "apply_plan", {
      steps: [
        {
          id: "proj",
          tool: "create_project",
          args: {
            name: "Thesis A",
            stages: [{ name: "Read" }, { name: "Write" }],
          },
        },
        {
          id: "t",
          tool: "create_tasks",
          args: {
            tasks: [
              {
                title: "Outline A",
                project: "$proj.id",
                stage_id: "$proj.stages[1].id",
              },
            ],
          },
        },
      ],
    }),
  );
  const outline = (
    await pool.query(
      `SELECT s.name FROM items i JOIN project_stages s ON s.id = i.stage_id
        WHERE i.title = 'Outline A' AND i.user_id = $1`,
      [olga.id],
    )
  ).rows[0];
  assert.equal(outline.name, "Write");
  assert.equal(proj.steps[1].done.length, 1);
});

test("undo with the job id takes the whole plan back, last step first", async () => {
  const earlier = await earlierPage(keys.full, "U");
  const r = ok(await tool(keys.full, "apply_plan", lecture("U", earlier, 3)));
  const [review] = await tasksTitled("Review: Cells U");
  const undone = ok(await tool(keys.full, "undo", { job: r.job }));
  assert.equal(undone.undone.length, 5, JSON.stringify(undone));
  const [doc] = await docsTitled("Cells U");
  assert.ok(doc.deleted_at, "the page went to Trash");
  assert.equal((await tasksTitled("Review: Cells U")).length, 0);
  assert.equal((await tasksTitled("Read chapter 5 U")).length, 0);
  assert.equal(
    (
      await pool.query("SELECT 1 FROM time_blocks WHERE item_id = $1", [
        review.id,
      ])
    ).rowCount,
    0,
  );
  // Once only.
  const again = await tool(keys.full, "undo", { job: r.job });
  assert.equal(again.isError, true);
});

test("a failing late step rolls everything back, with a report per step", async () => {
  const r = await tool(keys.full, "apply_plan", {
    steps: [
      {
        id: "notes",
        tool: "create_doc",
        args: { title: "Rolled back page", markdown: "Hi" },
      },
      {
        id: "tasks",
        tool: "create_tasks",
        args: { tasks: [{ title: "Rolled back task" }] },
      },
      {
        id: "bad",
        tool: "update_tasks",
        args: {
          changes: [
            {
              id: "task:00000000-0000-4000-8000-000000000000",
              version: 1,
              title: "x",
            },
          ],
        },
      },
    ],
  });
  assert.equal(r.isError, true);
  assert.equal(code(r), "NOT_FOUND");
  assert.match(r.content[0].text, /Step bad \(update_tasks\) failed/);
  const report = r._meta?.["orbyn/data"]?.steps;
  assert.deepEqual(
    report.map((s: any) => s.status),
    ["rolled_back", "rolled_back", "failed"],
  );
  assert.equal((await docsTitled("Rolled back page")).length, 0);
  assert.equal((await tasksTitled("Rolled back task")).length, 0);
  // A ref to a field the earlier step doesn't have fails the same way.
  const missing = await tool(keys.full, "apply_plan", {
    steps: [
      {
        id: "notes",
        tool: "create_doc",
        args: { title: "Missing anchor page", markdown: "Hi ^here" },
      },
      {
        id: "cards",
        tool: "update_study",
        args: {
          cards: {
            page: "$notes.id",
            items: [{ q: "Q?", a: "A", from: "$notes.lines.nowhere" }],
          },
        },
      },
    ],
  });
  assert.equal(code(missing), "INVALID");
  assert.equal((await docsTitled("Missing anchor page")).length, 0);
});

test("an invalid plan is refused before anything is written", async () => {
  const before = (await tasksTitled("Never made")).length;
  const r = await tool(keys.core, "apply_plan", {
    steps: [
      {
        id: "a",
        tool: "create_tasks",
        args: { tasks: [{ title: "Never made", notes: "$b.id" }] },
      },
      {
        id: "b",
        tool: "create_doc",
        args: { title: "Never made page", markdown: "x" },
      },
      {
        id: "c",
        tool: "link",
        args: {
          action: "link",
          kind: "related",
          from: "$nope.id",
          to: "$b.id",
        },
      },
      {
        id: "d",
        tool: "update_study",
        args: { exam: { title: "Needs the study toolset" } },
      },
      { id: "e", tool: "create_tasks", args: { tasks: [] } },
      {
        id: "f",
        tool: "create_doc",
        args: {
          title: "Elsewhere",
          markdown: "x",
          team: "00000000-0000-4000-8000-000000000001",
        },
      },
      { id: "b", tool: "create_doc", args: { title: "Twice", markdown: "x" } },
    ],
  });
  assert.equal(r.isError, true);
  assert.equal(code(r), "INVALID");
  const report = r._meta?.["orbyn/data"]?.steps;
  const by = Object.fromEntries(
    report.map((s: any, i: number) => [`${s.id}${i}`, s]),
  );
  assert.match(by.a0.error, /\$b is a later step/);
  assert.equal(by.b1.status, "ok");
  assert.match(by.c2.error, /\$nope names no step/);
  assert.match(by.d3.error, /can't use update_study/);
  assert.equal(by.e4.status, "invalid");
  assert.match(by.f5.error, /isn't reachable/);
  assert.match(by.b6.error, /two steps are called b/);
  assert.equal((await tasksTitled("Never made")).length, before);
  assert.equal((await docsTitled("Never made page")).length, 0);
  // Tools a plan can't use, too many steps, and step client_refs.
  const undo = await tool(keys.full, "apply_plan", {
    steps: [{ id: "u", tool: "undo", args: { job: "x" } }],
  });
  assert.equal(code(undo), "INVALID");
  const many = await tool(keys.full, "apply_plan", {
    steps: Array.from({ length: 51 }, (_, i) => ({
      id: `s${i}`,
      tool: "create_tasks",
      args: { tasks: [{ title: `t${i}` }] },
    })),
  });
  assert.equal(code(many), "INVALID");
  const ref = await tool(keys.full, "apply_plan", {
    steps: [
      {
        id: "x",
        tool: "create_tasks",
        args: { tasks: [{ title: "x" }], client_ref: "inner" },
      },
    ],
  });
  assert.equal(code(ref), "INVALID");
  assert.match(ref.content[0].text, /client_ref for the whole plan/);
  const unfinished = await tool(keys.full, "apply_plan", {
    steps: [
      {
        id: "x",
        tool: "append_doc",
        args: { title: "Long", markdown: "Part one" },
      },
    ],
  });
  assert.equal(code(unfinished), "INVALID");
  assert.match(unfinished.content[0].text, /finish: true/);
});

test("an ask-first step asks once for the whole plan in the chat: yes applies all, no none", async () => {
  const theirs = await mosTask("Mo's plan task");
  const args = {
    summary: "Notes and Mo's task",
    steps: [
      {
        id: "notes",
        tool: "create_doc",
        args: { title: "Asked plan page", markdown: "Hi" },
      },
      {
        id: "fix",
        tool: "update_tasks",
        args: {
          changes: [
            {
              id: `task:${theirs.id}`,
              version: theirs.version,
              title: "Mo's plan task, renamed",
            },
          ],
        },
      },
    ],
  };
  const before = await proposalsOf(grants.full);
  const first = await modern(keys.full, "apply_plan", args, FORM);
  assert.equal(first.result.resultType, "input_required");
  const request = first.result.inputRequests.confirm;
  assert.equal(Object.keys(first.result.inputRequests).length, 1, "one ask");
  assert.match(request.params.message, /Asked plan page/);
  assert.match(request.params.message, /teammate/);
  assert.equal((await docsTitled("Asked plan page")).length, 0);
  assert.equal(await proposalsOf(grants.full), before);
  // No: nothing at all.
  const no = await modern(keys.full, "apply_plan", args, FORM, {
    state: first.result.requestState,
    responses: { confirm: { action: "decline" } },
  });
  assert.equal(no.result._meta["orbyn/error"].code, "DECLINED");
  assert.equal((await docsTitled("Asked plan page")).length, 0);
  // Yes: every step.
  const yes = await modern(keys.full, "apply_plan", args, FORM, {
    state: first.result.requestState,
    responses: { confirm: { action: "accept", content: { confirm: true } } },
  });
  assert.ok(!yes.result.isError, JSON.stringify(yes.result));
  assert.equal(yes.result.structuredContent.status, "done");
  assert.equal((await docsTitled("Asked plan page")).length, 1);
  const renamed = (
    await pool.query("SELECT title FROM items WHERE id = $1", [theirs.id])
  ).rows[0];
  assert.equal(renamed.title, "Mo's plan task, renamed");
  // A connection that asks for everything asks once too.
  const ask = await modern(
    keys.ask,
    "apply_plan",
    {
      steps: [
        {
          id: "a",
          tool: "create_tasks",
          args: { tasks: [{ title: "Ask A" }] },
        },
        {
          id: "b",
          tool: "create_tasks",
          args: { tasks: [{ title: "Ask B" }] },
        },
      ],
    },
    FORM,
  );
  assert.equal(ask.result.resultType, "input_required");
  assert.match(
    ask.result.inputRequests.confirm.params.message,
    /Ask A[\s\S]*Ask B/,
  );
  assert.equal((await tasksTitled("Ask A")).length, 0);
});

test("without a form the whole plan waits as one proposal, made all at once when approved", async () => {
  const theirs = await mosTask("Mo's inbox task");
  const plan = {
    summary: "Inbox plan",
    steps: [
      {
        id: "notes",
        tool: "create_doc",
        args: { title: "Inbox plan page", markdown: "Hi ^top" },
      },
      {
        id: "t",
        tool: "create_tasks",
        args: { tasks: [{ title: "Inbox plan task", notes: "{$notes.uri}" }] },
      },
      {
        id: "fix",
        tool: "update_tasks",
        args: {
          changes: [
            {
              id: `task:${theirs.id}`,
              version: theirs.version,
              title: "Mo's inbox task, renamed",
            },
          ],
        },
      },
    ],
  };
  const before = await proposalsOf(grants.full);
  const r = ok(await tool(keys.full, "apply_plan", plan));
  assert.equal(r.status, "pending_review");
  assert.equal(await proposalsOf(grants.full), before + 1, "one proposal");
  assert.equal((await docsTitled("Inbox plan page")).length, 0);
  assert.equal((await tasksTitled("Inbox plan task")).length, 0);
  const id = idOf(r.pending.proposal_id);
  // The inbox shows each step.
  const item = (await h.call(olga.token, "GET", `/proposals/${id}`)).json();
  assert.equal(item.changes.length, 1);
  assert.equal(item.changes[0].rows.length, 3);
  assert.equal(item.changes[0].stale, false);
  // Approved: every step, as the agent, under the plan's job.
  const yes = await h.call(olga.token, "POST", `/proposals/${id}/apply`, {});
  assert.equal(yes.statusCode, 200, yes.body);
  const [doc] = await docsTitled("Inbox plan page");
  assert.ok(doc);
  const [task] = await tasksTitled("Inbox plan task");
  assert.ok(task);
  const renamed = (
    await pool.query("SELECT title FROM items WHERE id = $1", [theirs.id])
  ).rows[0];
  assert.equal(renamed.title, "Mo's inbox task, renamed");
  const jobRows = (
    await pool.query(
      "SELECT tool FROM agent_activity WHERE request_id = $1 ORDER BY id",
      [r.job],
    )
  ).rows.map((x) => x.tool);
  // The call that filed it, then each step and the approved plan.
  assert.deepEqual(jobRows, [
    "apply_plan",
    "create_doc",
    "create_tasks",
    "update_tasks",
    "apply_plan",
  ]);
  // One undo takes it all back.
  const undone = ok(await tool(keys.full, "undo", { job: r.job }));
  assert.equal(undone.undone.length, 3);
  assert.ok((await docsTitled("Inbox plan page"))[0].deleted_at);
  assert.equal((await tasksTitled("Inbox plan task")).length, 0);
  // Declined: nothing.
  const other = ok(
    await tool(keys.full, "apply_plan", {
      ...plan,
      steps: [
        {
          id: "notes",
          tool: "create_doc",
          args: { title: "Declined plan page", markdown: "x" },
        },
        {
          id: "fix",
          tool: "update_tasks",
          args: {
            changes: [
              {
                id: `task:${theirs.id}`,
                version: (
                  await pool.query("SELECT version FROM items WHERE id = $1", [
                    theirs.id,
                  ])
                ).rows[0].version,
                title: "Never",
              },
            ],
          },
        },
      ],
    }),
  );
  const no = await h.call(
    olga.token,
    "POST",
    `/proposals/${idOf(other.pending.proposal_id)}/decline`,
    {},
  );
  assert.equal(no.statusCode, 204);
  assert.equal((await docsTitled("Declined plan page")).length, 0);
  // A suggest-only connection's plan waits the same way, and approving it
  // makes it directly.
  const sug = ok(
    await tool(keys.suggest, "apply_plan", {
      steps: [
        {
          id: "n",
          tool: "create_doc",
          args: { title: "Suggested plan page", markdown: "x" },
        },
        {
          id: "t",
          tool: "create_tasks",
          args: { tasks: [{ title: "Suggested plan task" }] },
        },
      ],
    }),
  );
  assert.equal(sug.status, "pending_review");
  assert.equal(await proposalsOf(grants.suggest), 1, "one proposal, not two");
  const approve = await h.call(
    olga.token,
    "POST",
    `/proposals/${idOf(sug.pending.proposal_id)}/apply`,
    {},
  );
  assert.equal(approve.statusCode, 200, approve.body);
  assert.equal((await docsTitled("Suggested plan page")).length, 1);
  assert.equal((await tasksTitled("Suggested plan task")).length, 1);
  // A revoked connection's plan can't be approved any more.
  const later = ok(
    await tool(keys.ask, "apply_plan", {
      steps: [
        {
          id: "n",
          tool: "create_doc",
          args: { title: "Orphan plan", markdown: "x" },
        },
      ],
    }),
  );
  await pool.query("UPDATE agent_grants SET revoked_at = now() WHERE id = $1", [
    grants.ask,
  ]);
  const orphan = await h.call(
    olga.token,
    "POST",
    `/proposals/${idOf(later.pending.proposal_id)}/apply`,
    {},
  );
  assert.equal(orphan.statusCode, 409);
  assert.equal((await docsTitled("Orphan plan")).length, 0);
});

test("a retried plan with the same client_ref answers as before and changes nothing twice", async () => {
  const args = {
    client_ref: "lecture-7",
    steps: [
      {
        id: "n",
        tool: "create_doc",
        args: { title: "Idempotent plan page", markdown: "x" },
      },
    ],
  };
  const first = ok(await tool(keys.full, "apply_plan", args));
  limiter.reset();
  const again = await h.tool(keys.full, "apply_plan", args);
  assert.deepEqual(again!.structuredContent, first);
  assert.equal((again as Result)._meta?.["orbyn/replayed"], true);
  assert.equal((await docsTitled("Idempotent plan page")).length, 1);
});

test("budgets: apply_plan is in core and every toolset combination stays within 60 tools", () => {
  const cap = registry.get("apply_plan")!;
  assert.equal(cap.toolset, "core");
  assert.ok(JSON.stringify(describe(cap)).length < 2600);
  for (const name of PLAN_TOOLS) {
    const step = registry.get(name);
    assert.ok(step, name);
    assert.notEqual(step!.mode, "read", `${name} changes things`);
  }
  assert.ok(
    registry.all.filter((c) => !c.legacyOnly).length <= 60,
    "60 tools at most with every toolset",
  );
});

test("the new prompts are listed by toolset and say to use one apply_plan", async () => {
  const names = async (key: string) =>
    (await h.legacy(key, "prompts/list")).body.result.prompts.map(
      (p: any) => p.name,
    );
  const core = await names(keys.core);
  assert.ok(core.includes("meeting_to_actions"));
  for (const n of ["lecture_to_notes", "research_brief", "exam_prep"])
    assert.ok(!core.includes(n), `${n} needs the study toolset`);
  const full = await names(keys.full);
  for (const n of [
    "lecture_to_notes",
    "research_brief",
    "exam_prep",
    "meeting_to_actions",
  ])
    assert.ok(full.includes(n), n);
  const got = (
    await h.legacy(keys.full, "prompts/get", {
      name: "lecture_to_notes",
      arguments: { lecture: "Lecture 5: Cells", exam: "Biology final" },
    })
  ).body.result;
  const text = got.messages[0].content.text;
  assert.match(text, /ONE apply_plan call/);
  assert.match(text, /Lecture 5: Cells/);
  assert.match(text, /\[src: /);
  assert.match(text, /get_context/);
  const missing = await h.legacy(keys.full, "prompts/get", {
    name: "exam_prep",
    arguments: {},
  });
  assert.equal(missing.body.error.code, -32602);
  // Arguments complete from what the connection can see.
  const done = (
    await h.legacy(keys.full, "completion/complete", {
      ref: { type: "ref/prompt", name: "lecture_to_notes" },
      argument: { name: "project", value: "Thes" },
    })
  ).body.result.completion;
  assert.ok(done.values.includes("Thesis A"), JSON.stringify(done));
});
