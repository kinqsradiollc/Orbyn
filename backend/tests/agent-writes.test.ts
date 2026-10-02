import { test, before, after } from "node:test";
import assert from "node:assert/strict";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";
import {
  META_KEYS,
  MODERN,
  bearer,
  helpers,
  trapNetwork,
  type Person,
} from "./mcp-helpers.js";

/**
 * A3: outside agents' changes and the Review inbox. Every write tool
 * against the permission matrix (access level, team role, team policy,
 * spaces), the risk tiers and where each change goes (made directly, as
 * suggestions, or to review), client_ref idempotency, Undo, staleness, and
 * that only a person signed in to Orbyn's own apps approves.
 */

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { registry } = await import("../src/capabilities/index.js");
const { SWEEP_RULES } = await import("../src/lib/sweep.js");
const { limiter, strikes } =
  await import("../src/modules/mcp-server/routes.js");

const app = await buildApp();
const h = helpers(app);
const network = await trapNetwork();

let olga: Person;
let mo: Person;
let vi: Person;
let otto: Person;
let crew = "";
let quiet = "";
const keys: Record<string, string> = {};
const grants: Record<string, string> = {};

const WRITES = [
  "create_tasks",
  "update_tasks",
  "complete_tasks",
  "edit_checklist",
  "schedule_sessions",
  "reschedule_sessions",
  "create_doc",
  "edit_doc",
  "link",
  "create_project",
  "propose_changes",
];

type Result = {
  content: { type: string; text: string }[];
  structuredContent?: any;
  isError?: boolean;
  _meta?: Record<string, any>;
};

/** A tool call; resets the per-connection rate limit so the file never trips it. */
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

const code = (r: Result) => r._meta?.["orbyn/error"]?.code as string;

const ok = (r: Result, what = "call") => {
  assert.ok(!r.isError, `${what}: ${r.content?.[0]?.text}`);
  return r.structuredContent;
};

const soon = (days: number, hour = 10) => {
  const d = new Date(Date.now() + days * 86_400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

const itemRow = async (id: string) =>
  (await pool.query("SELECT * FROM items WHERE id = $1", [id])).rows[0];

const lastActivity = async (grant: string) =>
  (
    await pool.query(
      "SELECT * FROM agent_activity WHERE grant_id = $1 ORDER BY id DESC LIMIT 1",
      [grant],
    )
  ).rows[0];

const idOf = (typed: string) => typed.replace(/^\w+:/, "").slice(0, 36);

before(async () => {
  await migrate();
  olga = await h.register("aw-olga", "Olga");
  mo = await h.register("aw-mo", "Mo");
  vi = await h.register("aw-vi", "Vi");
  otto = await h.register("aw-otto", "Otto");
  crew = await h.team(olga, "Crew", [
    [mo, "member"],
    [vi, "viewer"],
  ]);
  quiet = await h.team(olga, "Quiet");
  const make = async (
    name: string,
    who: Person,
    body: Record<string, unknown>,
  ) => {
    const k = await h.agentKey(who, body);
    keys[name] = k.key;
    grants[name] = k.id;
  };
  await make("write", olga, { access: "write", team_ids: [crew, quiet] });
  await make("suggest", olga, { access: "suggest", team_ids: [crew] });
  await make("read", olga, { access: "read", team_ids: [crew] });
  await make("personal", olga, { access: "write", team_ids: [] });
  // Asks before every change (H1): no form in these calls, so the Review inbox.
  await make("ask", olga, {
    access: "write",
    trust: "ask",
    team_ids: [crew, quiet],
  });
  await make("mo", mo, { access: "write", team_ids: [crew] });
  await make("vi", vi, { access: "write", team_ids: [crew] });
});

after(async () => {
  const { closeLive } = await import("../src/modules/docs/live.js");
  await closeLive();
  assert.deepEqual(network.calls, [], "writes never reach the network");
  network.restore();
  await app.close();
  await pool.end();
});

test("each write tool declares a tier that matches what it does", () => {
  for (const name of WRITES) {
    const cap = registry.get(name)!;
    assert.ok(cap, name);
    assert.notEqual(cap.mode, "read", name);
    assert.equal(cap.annotations.readOnlyHint, false, name);
    if (cap.tier === "W1")
      assert.equal(cap.annotations.destructiveHint, false, `${name}: W1 adds`);
    if (cap.annotations.destructiveHint)
      assert.ok(
        cap.tier === "W2" || cap.tier === "W3",
        `${name}: edits are W2+`,
      );
    const schema = JSON.stringify(cap.input);
    assert.ok(schema, name);
  }
  assert.equal(registry.get("propose_changes")!.tier, "W3");
  assert.equal(registry.get("plan_schedule")!.mode, "read");
});

test("the permission matrix: access levels, roles, team policy and spaces", async () => {
  // A read connection can't call a single change.
  for (const name of WRITES) {
    const r = await tool(keys.read, name, {});
    assert.equal(r.isError, true, name);
    assert.equal(code(r), "FORBIDDEN", name);
  }
  // Write, in Personal: made directly.
  const made = ok(
    await tool(keys.write, "create_tasks", {
      tasks: [{ title: "Matrix personal task" }],
    }),
  );
  assert.equal(made.status, "done");
  const personalTask = idOf(made.done[0].id);
  assert.equal((await itemRow(personalTask)).user_id, olga.id);
  // A connection without Personal can't reach it.
  const noPersonal = await h.agentKey(olga, {
    access: "write",
    personal: false,
    team_ids: [crew],
  });
  const refused = await tool(noPersonal.key, "create_tasks", {
    tasks: [{ title: "Nope" }],
  });
  assert.equal(code(refused), "NOT_FOUND");
  // Someone else's task is simply not there.
  const ottoTask = (
    await h.call(otto.token, "POST", "/items", { title: "Otto's own" })
  ).json().id;
  const hidden = await tool(keys.write, "update_tasks", {
    changes: [{ id: `task:${ottoTask}`, version: 1, title: "Mine now" }],
  });
  assert.equal(code(hidden), "NOT_FOUND");
  assert.equal((await itemRow(ottoTask)).title, "Otto's own");
  // A team viewer's agent only reads there, whatever the connection says.
  const viewer = await tool(keys.vi, "create_tasks", {
    tasks: [{ title: "Viewer's try", team: crew }],
  });
  assert.equal(code(viewer), "READ_ONLY");
  // A member writes in the team directly.
  const team = ok(
    await tool(keys.mo, "create_tasks", {
      tasks: [{ title: "Crew task by Mo's agent", team: crew }],
    }),
  );
  assert.equal(team.status, "done");
  // A team capped at suggest: the same change waits for review.
  await pool.query("UPDATE teams SET agent_access = 'suggest' WHERE id = $1", [
    crew,
  ]);
  const capped = ok(
    await tool(keys.mo, "create_tasks", {
      tasks: [{ title: "Crew task, suggested", team: crew }],
    }),
  );
  assert.equal(capped.status, "pending_review");
  // Off: the team is out of reach.
  await pool.query("UPDATE teams SET agent_access = 'off' WHERE id = $1", [
    crew,
  ]);
  const off = await tool(keys.mo, "create_tasks", {
    tasks: [{ title: "Crew task, off", team: crew }],
  });
  assert.equal(code(off), "NOT_FOUND");
  await pool.query("UPDATE teams SET agent_access = 'role' WHERE id = $1", [
    crew,
  ]);
  // A suggest connection: everything becomes a proposal.
  const suggested = ok(
    await tool(keys.suggest, "create_tasks", {
      tasks: [{ title: "Suggested personal task" }],
    }),
  );
  assert.equal(suggested.status, "pending_review");
  assert.match(suggested.pending.review_url, /\/app\/review\/[0-9a-f-]{36}$/);
  const none = await pool.query(
    "SELECT 1 FROM items WHERE title = 'Suggested personal task'",
  );
  assert.equal(none.rowCount, 0, "nothing is made before approval");
  // A suggest connection doesn't even see the write-only tools.
  const complete = await tool(keys.suggest, "complete_tasks", {
    tasks: [{ id: `task:${personalTask}`, version: 1 }],
  });
  assert.equal(code(complete), "FORBIDDEN");
});

test("full power: invites, assigning and a teammate's work ask first; moves are direct with undo", async () => {
  const invite = ok(
    await tool(keys.write, "create_tasks", {
      tasks: [
        {
          title: "Launch party",
          kind: "event",
          due_at: soon(3, 18),
          end_at: soon(3, 20),
          invite: ["guest@example.com"],
        },
        { title: "Buy balloons" },
      ],
    }),
  );
  assert.equal(invite.status, "partly_pending");
  assert.equal(invite.done.length, 1);
  assert.equal(invite.pending.changes, 1);
  // Assigning a teammate notifies them: review, unless the switch is on.
  const assign = ok(
    await tool(keys.write, "create_tasks", {
      tasks: [{ title: "Mo's job", team: crew, assignee_id: mo.id }],
    }),
  );
  assert.equal(assign.status, "pending_review");
  await pool.query(
    `UPDATE agent_grants SET flags = flags || '{"notify_teammates": true}' WHERE id = $1`,
    [grants.write],
  );
  const direct = ok(
    await tool(keys.write, "create_tasks", {
      tasks: [{ title: "Mo's other job", team: crew, assignee_id: mo.id }],
    }),
  );
  assert.equal(direct.status, "done");
  await pool.query(
    `UPDATE agent_grants SET flags = flags - 'notify_teammates' WHERE id = $1`,
    [grants.write],
  );
  // At full power a task moves between Personal and a team at once, and
  // Undo moves it back.
  const task = ok(
    await tool(keys.write, "create_tasks", { tasks: [{ title: "Mover" }] }),
  ).done[0];
  const move = ok(
    await tool(keys.write, "update_tasks", {
      changes: [{ id: task.id, version: task.version, team: crew }],
    }),
  );
  assert.equal(move.status, "done");
  assert.equal((await itemRow(idOf(task.id))).team_id, crew);
  const moved = await lastActivity(grants.write);
  const back = await h.call(
    olga.token,
    "POST",
    `/me/agents/activity/${moved.id}/undo`,
  );
  assert.equal(back.statusCode, 200, back.body);
  assert.equal((await itemRow(idOf(task.id))).team_id, null);
  // A connection that asks first sends the same move to review.
  const now = await itemRow(idOf(task.id));
  const asked = ok(
    await tool(keys.ask, "update_tasks", {
      changes: [{ id: task.id, version: now.version, team: crew }],
    }),
  );
  assert.equal(asked.status, "pending_review");
  assert.equal((await itemRow(idOf(task.id))).team_id, null);
  // Deleting a teammate's task asks first.
  const mosTask = (
    await h.call(mo.token, "POST", "/items", {
      title: "Mo's crew task",
      team_id: crew,
    })
  ).json();
  const del = ok(
    await tool(keys.write, "propose_changes", {
      summary: "Tidy up",
      changes: [
        {
          type: "delete_task",
          target: `task:${mosTask.id}`,
          version: mosTask.version,
        },
      ],
    }),
  );
  assert.equal(del.status, "pending_review");
  assert.ok(await itemRow(mosTask.id), "still there until approved");
  // Its outcome is readable with fetch.
  const fetched = ok(
    await tool(keys.write, "fetch", { id: del.pending.proposal_id }),
  );
  assert.equal(fetched.metadata.status, "pending");
  // Another connection can't read it.
  const other = await tool(keys.personal, "fetch", {
    id: del.pending.proposal_id,
  });
  assert.equal(code(other), "NOT_FOUND");
  // Credentials never get written.
  const secret = await tool(keys.write, "create_tasks", {
    tasks: [{ title: `Remember ok_${"x".repeat(40)}` }],
  });
  assert.equal(code(secret), "INVALID");
});

test("client_ref: sending the same change again answers as before", async () => {
  const args = {
    tasks: [{ title: "Idempotent task" }],
    client_ref: "retry-1",
  };
  const first = await tool(keys.write, "create_tasks", args);
  const again = await tool(keys.write, "create_tasks", args);
  assert.deepEqual(again.structuredContent, first.structuredContent);
  assert.equal(again._meta?.["orbyn/replayed"], true);
  const rows = await pool.query(
    "SELECT 1 FROM items WHERE title = 'Idempotent task' AND user_id = $1",
    [olga.id],
  );
  assert.equal(rows.rowCount, 1);
  // Keyed by the connection: another one's same ref is its own.
  await tool(keys.personal, "create_tasks", args);
  const both = await pool.query(
    "SELECT 1 FROM items WHERE title = 'Idempotent task' AND user_id = $1",
    [olga.id],
  );
  assert.equal(both.rowCount, 2);
});

test("update and complete: version checks, repeats, sessions and Undo", async () => {
  const t = ok(
    await tool(keys.write, "create_tasks", {
      tasks: [
        { title: "Essay draft", notes: "Keep these notes", due_at: soon(5) },
      ],
    }),
  ).done[0];
  const changed = ok(
    await tool(keys.write, "update_tasks", {
      changes: [{ id: t.id, version: t.version, priority: "high" }],
    }),
  ).done[0];
  const row = await itemRow(idOf(t.id));
  assert.equal(row.priority, "high");
  assert.equal(row.notes, "Keep these notes", "fields left out stay");
  // A stale version is refused with the current one.
  const stale = await tool(keys.write, "update_tasks", {
    changes: [{ id: t.id, version: t.version, title: "Old" }],
  });
  assert.equal(code(stale), "VERSION_CONFLICT");
  assert.equal(stale._meta?.["orbyn/data"]?.version, changed.version);
  // Undo the edit from the activity list.
  const edit = await lastActivity(grants.write);
  const undo = await h.call(
    olga.token,
    "POST",
    `/me/agents/activity/${edit.id}/undo`,
  );
  assert.equal(undo.statusCode, 200, undo.body);
  assert.equal((await itemRow(idOf(t.id))).priority, "medium");
  const twice = await h.call(
    olga.token,
    "POST",
    `/me/agents/activity/${edit.id}/undo`,
  );
  assert.equal(twice.statusCode, 409);

  // Completing clears future sessions, and Undo puts them back.
  const now = await itemRow(idOf(t.id));
  await h.call(olga.token, "POST", "/blocks", {
    item_id: now.id,
    start_at: soon(2, 9),
    end_at: soon(2, 10),
  });
  const done = ok(
    await tool(keys.write, "complete_tasks", {
      tasks: [{ id: t.id, version: now.version }],
    }),
  );
  assert.equal(done.done[0].change, "Completed");
  assert.equal((await itemRow(now.id)).status, "done");
  const left = await pool.query(
    "SELECT 1 FROM time_blocks WHERE item_id = $1",
    [now.id],
  );
  assert.equal(left.rowCount, 0);
  const completion = await lastActivity(grants.write);
  const back = await h.call(
    olga.token,
    "POST",
    `/me/agents/activity/${completion.id}/undo`,
  );
  assert.equal(back.statusCode, 200, back.body);
  assert.equal((await itemRow(now.id)).status, "todo");
  const restored = await pool.query(
    "SELECT 1 FROM time_blocks WHERE item_id = $1",
    [now.id],
  );
  assert.equal(restored.rowCount, 1);

  // A repeating task needs the occurrence, so a retry can't complete the next.
  const weekly = (
    await h.call(olga.token, "POST", "/items", {
      title: "Weekly review",
      due_at: soon(1, 9),
      rrule: "FREQ=WEEKLY",
    })
  ).json();
  const noOccurrence = await tool(keys.write, "complete_tasks", {
    tasks: [{ id: `task:${weekly.id}`, version: weekly.version }],
  });
  assert.equal(code(noOccurrence), "INVALID");
  const wrong = await tool(keys.write, "complete_tasks", {
    tasks: [
      {
        id: `task:${weekly.id}`,
        version: weekly.version,
        occurrence: soon(8, 9),
      },
    ],
  });
  assert.equal(code(wrong), "STALE");
  ok(
    await tool(keys.write, "complete_tasks", {
      tasks: [
        {
          id: `task:${weekly.id}`,
          version: weekly.version,
          occurrence: weekly.due_at,
        },
      ],
    }),
  );
  const moved = await itemRow(weekly.id);
  assert.ok(moved.due_at.getTime() > Date.parse(weekly.due_at));
  const retry = await tool(keys.write, "complete_tasks", {
    tasks: [
      {
        id: `task:${weekly.id}`,
        version: weekly.version,
        occurrence: weekly.due_at,
      },
    ],
  });
  assert.equal(code(retry), "VERSION_CONFLICT");
});

test("edit_checklist adds and ticks steps; Undo puts the checklist back", async () => {
  const t = ok(
    await tool(keys.write, "create_tasks", {
      tasks: [{ title: "Pack", steps: ["Passport", "Charger"] }],
    }),
  ).done[0];
  const steps = (
    await pool.query(
      "SELECT id, title FROM item_steps WHERE item_id = $1 ORDER BY position",
      [idOf(t.id)],
    )
  ).rows;
  ok(
    await tool(keys.write, "edit_checklist", {
      task: t.id,
      add: ["Snacks"],
      tick: [steps[0].id],
    }),
  );
  let now = await pool.query(
    "SELECT title, done FROM item_steps WHERE item_id = $1 ORDER BY position",
    [idOf(t.id)],
  );
  assert.deepEqual(
    now.rows.map((r) => [r.title, r.done]),
    [
      ["Passport", true],
      ["Charger", false],
      ["Snacks", false],
    ],
  );
  assert.equal((await itemRow(idOf(t.id))).progress, 33);
  const unknown = await tool(keys.write, "edit_checklist", {
    task: t.id,
    tick: ["00000000-0000-4000-8000-000000000000"],
  });
  assert.equal(code(unknown), "NOT_FOUND");
  const act = await lastActivity(grants.write);
  assert.equal(act.tool, "edit_checklist");
  const undo = await h.call(
    olga.token,
    "POST",
    `/me/agents/activity/${act.id}/undo`,
  );
  assert.equal(undo.statusCode, 200, undo.body);
  now = await pool.query(
    "SELECT title, done FROM item_steps WHERE item_id = $1 ORDER BY position",
    [idOf(t.id)],
  );
  assert.deepEqual(
    now.rows.map((r) => [r.title, r.done]),
    [
      ["Passport", false],
      ["Charger", false],
    ],
  );
});

test("pages: create_doc caps size; edit_doc keeps a labelled version, team pages get suggestions", async () => {
  const big = await tool(keys.write, "create_doc", {
    title: "Too big",
    markdown: Array.from({ length: 2500 }, (_, i) => `- line ${i}`).join("\n"),
  });
  assert.equal(code(big), "INVALID");
  const made = ok(
    await tool(keys.write, "create_doc", {
      title: "Trip notes",
      markdown: "# Trip\n\nPack the red bag.\n\n- [ ] Book train",
    }),
  ).done[0];
  const doc = (
    await pool.query("SELECT * FROM docs WHERE id = $1", [idOf(made.id)])
  ).rows[0];
  assert.ok(
    doc.content.every((b: { id?: string }) => b.id),
    "every line has an id",
  );
  const line = doc.content[1].id;
  // A stale version is refused.
  const stale = await tool(keys.write, "edit_doc", {
    doc: made.id,
    version: doc.version + 5,
    edits: [{ op: "append", markdown: "More" }],
  });
  assert.equal(code(stale), "VERSION_CONFLICT");
  // An unknown line changes nothing (all or nothing).
  const unknown = await tool(keys.write, "edit_doc", {
    doc: made.id,
    version: doc.version,
    edits: [
      { op: "append", markdown: "Kept?" },
      { op: "delete", block: "bnope" },
    ],
  });
  assert.equal(code(unknown), "INVALID");
  const edited = ok(
    await tool(keys.write, "edit_doc", {
      doc: made.id,
      version: doc.version,
      edits: [
        { op: "replace", block: line, markdown: "Pack the blue bag." },
        { op: "append", markdown: "Bring snacks." },
      ],
    }),
  ).done[0];
  const after = (
    await pool.query("SELECT * FROM docs WHERE id = $1", [idOf(made.id)])
  ).rows[0];
  assert.equal(after.content[1].id, line, "the edited line keeps its id");
  assert.equal(after.content[1].text, "Pack the blue bag.");
  // The page before the edit is kept, labelled with the agent (via_grant).
  const kept = (
    await pool.query(
      "SELECT version, via_grant_id FROM doc_versions WHERE doc_id = $1",
      [doc.id],
    )
  ).rows;
  assert.deepEqual(kept, [
    { version: doc.version, via_grant_id: grants.write },
  ]);
  const history = (
    await h.call(olga.token, "GET", `/docs/${doc.id}/versions`)
  ).json();
  assert.equal(history[0].via_agent, "Agent key");
  // Undo puts the kept version back.
  const act = await lastActivity(grants.write);
  const undo = await h.call(
    olga.token,
    "POST",
    `/me/agents/activity/${act.id}/undo`,
  );
  assert.equal(undo.statusCode, 200, undo.body);
  const undone = (
    await pool.query("SELECT content, version FROM docs WHERE id = $1", [
      doc.id,
    ])
  ).rows[0];
  assert.equal(undone.content[1].text, "Pack the red bag.");
  assert.ok(undone.version > edited.version!);

  // A team page: the same kind of edit becomes suggestions.
  const teamDoc = (
    await h.call(mo.token, "POST", "/docs", {
      title: "Crew plan",
      team_id: crew,
      content: [{ id: "bcrew", type: "paragraph", text: "We fly on Friday." }],
    })
  ).json();
  const suggested = await tool(keys.write, "edit_doc", {
    doc: `doc:${teamDoc.id}`,
    version: teamDoc.version,
    edits: [{ op: "find_replace", find: "Friday", replace: "Saturday" }],
  });
  ok(suggested);
  const open = (
    await pool.query(
      "SELECT text, quote, note, status FROM doc_suggestions WHERE doc_id = $1",
      [teamDoc.id],
    )
  ).rows;
  assert.equal(open.length, 1);
  assert.equal(open[0].text, "Saturday");
  assert.match(open[0].note, /Agent key/);
  const unchanged = (
    await pool.query("SELECT content FROM docs WHERE id = $1", [teamDoc.id])
  ).rows[0];
  assert.equal(unchanged.content[0].text, "We fly on Friday.");
  // New lines on a team page can't be a suggestion: they go to review.
  const lines = ok(
    await tool(keys.write, "edit_doc", {
      doc: `doc:${teamDoc.id}`,
      version: teamDoc.version,
      edits: [{ op: "append", markdown: "Bring helmets." }],
    }),
  );
  assert.equal(lines.status, "pending_review");
});

test("sessions: plan_schedule's token is single-use and checked; moves and Undo", async () => {
  // Working hours all week, so a plan always finds room.
  await pool.query(
    `INSERT INTO planner_prefs (user_id, work_days, work_start, work_end)
       VALUES ($1, '{0,1,2,3,4,5,6}', '00:00', '23:55')
       ON CONFLICT (user_id) DO UPDATE SET work_days = EXCLUDED.work_days,
       work_start = EXCLUDED.work_start, work_end = EXCLUDED.work_end`,
    [olga.id],
  );
  const task = (
    await h.call(olga.token, "POST", "/items", {
      title: "Plan me",
      estimate_minutes: 60,
      due_at: soon(4, 17),
    })
  ).json();
  const plan = ok(
    await tool(keys.personal, "plan_schedule", {
      days: 3,
      tasks: [`task:${task.id}`],
    }),
  );
  assert.ok(plan.sessions.length >= 1, JSON.stringify(plan));
  assert.equal(
    (
      await pool.query("SELECT 1 FROM time_blocks WHERE item_id = $1", [
        task.id,
      ])
    ).rowCount,
    0,
    "a preview writes nothing",
  );
  // Another connection can't use it.
  const foreign = await tool(keys.write, "schedule_sessions", {
    plan_token: plan.plan_token,
  });
  assert.equal(code(foreign), "INVALID");
  const tampered = await tool(keys.personal, "schedule_sessions", {
    plan_token: plan.plan_token.replace(/.$/, (c: string) =>
      c === "A" ? "B" : "A",
    ),
  });
  assert.equal(code(tampered), "INVALID");
  const placed = ok(
    await tool(keys.personal, "schedule_sessions", {
      plan_token: plan.plan_token,
    }),
  );
  assert.equal(placed.status, "done");
  const blocks = (
    await pool.query(
      "SELECT id, start_at FROM time_blocks WHERE item_id = $1",
      [task.id],
    )
  ).rows;
  assert.equal(blocks.length, plan.sessions.length);
  const reuse = await tool(keys.personal, "schedule_sessions", {
    plan_token: plan.plan_token,
  });
  assert.equal(code(reuse), "STALE");
  // A plan the calendar moved on from is refused.
  const other = await tool(keys.personal, "plan_schedule", {
    days: 3,
    tasks: [`task:${task.id}`],
  });
  await h.call(olga.token, "PUT", `/items/${task.id}`, {
    title: "Plan me",
    estimate_minutes: 180,
    due_at: task.due_at,
    version: (await itemRow(task.id)).version,
  });
  const stale = await tool(keys.personal, "schedule_sessions", {
    plan_token: other.structuredContent.plan_token,
  });
  assert.equal(code(stale), "STALE");

  // Move one session, then Undo.
  const b = blocks[0];
  const start = soon(6, 8);
  const end = soon(6, 9);
  ok(
    await tool(keys.personal, "reschedule_sessions", {
      changes: [
        { session: b.id, action: "move", start_at: start, end_at: end },
      ],
    }),
  );
  const movedRow = (
    await pool.query("SELECT start_at FROM time_blocks WHERE id = $1", [b.id])
  ).rows[0];
  assert.equal(movedRow.start_at.toISOString(), start);
  const act = await lastActivity(grants.personal);
  const undo = await h.call(
    olga.token,
    "POST",
    `/me/agents/activity/${act.id}/undo`,
  );
  assert.equal(undo.statusCode, 200, undo.body);
  const backRow = (
    await pool.query("SELECT start_at FROM time_blocks WHERE id = $1", [b.id])
  ).rows[0];
  assert.equal(backRow.start_at.getTime(), b.start_at.getTime());
  // Explicit sessions are clash-checked like a plan.
  const clash = ok(
    await tool(keys.personal, "schedule_sessions", {
      sessions: [
        { task: `task:${task.id}`, start_at: start, end_at: end },
        { task: `task:${task.id}`, start_at: start, end_at: end },
      ],
    }),
  );
  assert.equal(clash.done.length, 1);
  assert.equal(clash.skipped.length, 1);
});

test("link, create_project, and the project timeline names the agent", async () => {
  const a = ok(
    await tool(keys.write, "create_tasks", {
      tasks: [{ title: "Foundations" }, { title: "Walls" }],
    }),
  ).done;
  ok(
    await tool(keys.write, "link", {
      action: "link",
      kind: "depends_on",
      from: a[1].id,
      to: a[0].id,
    }),
  );
  const dep = await pool.query(
    "SELECT 1 FROM item_dependencies WHERE item_id = $1 AND prerequisite_id = $2",
    [idOf(a[1].id), idOf(a[0].id)],
  );
  assert.equal(dep.rowCount, 1);
  const project = ok(
    await tool(keys.write, "create_project", {
      name: "House",
      team: crew,
      stages: [{ name: "Build", tasks: ["Pour slab", "Frame"] }],
      page: { markdown: "# House\n\nThe plan." },
    }),
  );
  assert.equal(project.status, "done");
  const pid = idOf(project.done[0].id);
  const tasks = await pool.query(
    "SELECT title FROM items WHERE project_id = $1 ORDER BY title",
    [pid],
  );
  assert.deepEqual(
    tasks.rows.map((r) => r.title),
    ["Frame", "Pour slab"],
  );
  // The timeline rows the agent's change wrote carry its connection.
  const timeline = await pool.query(
    "SELECT via_grant_id FROM project_activity WHERE project_id = $1",
    [pid],
  );
  assert.ok(timeline.rowCount! > 0);
  assert.ok(timeline.rows.every((r) => r.via_grant_id === grants.write));
  // A person's own change in the same project isn't labelled.
  const byHand = (
    await h.call(olga.token, "POST", "/items", {
      title: "By hand",
      team_id: crew,
      project_id: pid,
    })
  ).json();
  const mine = await pool.query(
    "SELECT via_grant_id FROM project_activity WHERE entity_id = $1",
    [byHand.id],
  );
  assert.equal(mine.rowCount, 1);
  assert.equal(mine.rows[0].via_grant_id, null);
  // More than 50 changes at once asks first (the Review inbox here).
  const huge = ok(
    await tool(keys.write, "create_project", {
      name: "Huge",
      team: crew,
      stages: [
        {
          name: "One",
          tasks: Array.from({ length: 30 }, (_, i) => `Task ${i}`),
        },
        {
          name: "Two",
          tasks: Array.from({ length: 30 }, (_, i) => `Task ${i + 30}`),
        },
      ],
    }),
  );
  assert.equal(huge.status, "pending_review");
});

test("approving needs a first-party session: keys and agents are refused, and staleness is checked", async () => {
  const t = ok(
    await tool(keys.write, "create_tasks", { tasks: [{ title: "Doomed" }] }),
  ).done[0];
  const proposed = ok(
    await tool(keys.ask, "propose_changes", {
      summary: "Delete Doomed",
      changes: [{ type: "delete_task", target: t.id, version: t.version }],
    }),
  );
  const id = idOf(proposed.pending.proposal_id);
  // Agent credentials never authenticate on the API.
  for (const k of [keys.write, keys.suggest]) {
    for (const [method, url] of [
      ["POST", `/proposals/${id}/apply`],
      ["POST", `/ai/proposals/${id}/apply`],
      ["GET", "/proposals"],
      ["POST", `/proposals/${id}/decline`],
    ] as const) {
      const r = await app.inject({
        method,
        url,
        headers: bearer(k),
        payload: {},
      });
      assert.equal(r.statusCode, 401, `${method} ${url}`);
    }
  }
  // A personal API key is refused too.
  const apiKey = (
    await h.call(olga.token, "POST", "/me/api-keys", { name: "Script" })
  ).json().key as string;
  for (const [method, url] of [
    ["POST", `/proposals/${id}/apply`],
    ["POST", `/ai/proposals/${id}/apply`],
    ["GET", `/proposals/${id}`],
    ["POST", "/me/agents/activity/1/undo"],
  ] as const) {
    const r = await app.inject({
      method,
      url,
      headers: bearer(apiKey),
      payload: {},
    });
    assert.equal(r.statusCode, 403, `${method} ${url}`);
  }
  // No one else sees it.
  const theirs = await h.call(mo.token, "GET", `/proposals/${id}`);
  assert.equal(theirs.statusCode, 404);
  // The inbox shows it with its diff.
  const inbox = (await h.call(olga.token, "GET", "/proposals")).json();
  const item = inbox.pending.find((p: { id: string }) => p.id === id);
  assert.ok(item);
  assert.equal(item.proposer, "Agent key");
  assert.match(item.changes[0].headline, /Delete “Doomed”/);
  const count = (await h.call(olga.token, "GET", "/proposals/count")).json();
  assert.ok(count.pending >= 1);
  // Changed since: stale, and approving is refused.
  const row = await itemRow(idOf(t.id));
  await h.call(olga.token, "PUT", `/items/${row.id}`, {
    title: "Doomed (edited)",
    version: row.version,
  });
  const read = (await h.call(olga.token, "GET", `/proposals/${id}`)).json();
  assert.equal(read.changes[0].stale, true);
  const refused = await h.call(
    olga.token,
    "POST",
    `/proposals/${id}/apply`,
    {},
  );
  assert.equal(refused.statusCode, 409);
  assert.ok(await itemRow(idOf(t.id)), "nothing deleted");
  // A fresh proposal applies for the person, once.
  const fresh = ok(
    await tool(keys.ask, "propose_changes", {
      summary: "Delete it now",
      changes: [
        {
          type: "delete_task",
          target: t.id,
          version: (await itemRow(idOf(t.id))).version,
        },
      ],
    }),
  );
  const fid = idOf(fresh.pending.proposal_id);
  const applied = await h.call(
    olga.token,
    "POST",
    `/proposals/${fid}/apply`,
    {},
  );
  assert.equal(applied.statusCode, 200, applied.body);
  assert.equal(await itemRow(idOf(t.id)), undefined);
  const again = await h.call(olga.token, "POST", `/proposals/${fid}/apply`, {});
  assert.equal(again.statusCode, 200);
  const status = ok(await tool(keys.ask, "fetch", { id: `proposal:${fid}` }));
  assert.equal(status.metadata.status, "applied");
  // Declining changes nothing.
  const other = ok(
    await tool(keys.write, "create_tasks", {
      tasks: [{ title: "Keep me", team: crew, assignee_id: mo.id }],
    }),
  );
  const oid = idOf(other.pending.proposal_id);
  const declined = await h.call(
    olga.token,
    "POST",
    `/proposals/${oid}/decline`,
  );
  assert.equal(declined.statusCode, 204);
  const gone = await pool.query("SELECT 1 FROM items WHERE title = 'Keep me'");
  assert.equal(gone.rowCount, 0);
});

test("the assistant's Approve still works through the proposals service", async () => {
  const p = (
    await pool.query(
      `INSERT INTO proposals (user_id, actions) VALUES ($1, $2::jsonb) RETURNING id`,
      [
        olga.id,
        JSON.stringify([
          { operation: "create", data: { title: "From the assistant" } },
        ]),
      ],
    )
  ).rows[0];
  const r = await h.call(olga.token, "POST", `/ai/proposals/${p.id}/apply`, {});
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(r.json(), { applied: true, project_id: null });
  const made = await pool.query(
    "SELECT 1 FROM items WHERE title = 'From the assistant' AND user_id = $1",
    [olga.id],
  );
  assert.equal(made.rowCount, 1);
  const row = (
    await pool.query(
      "SELECT status, source, expires_at, created_at FROM proposals WHERE id = $1",
      [p.id],
    )
  ).rows[0];
  assert.equal(row.status, "applied");
  assert.equal(row.source, "assistant");
});

test("per-source expiry, and pending proposals end with the access they came from", async () => {
  const mk = async (key: string, title: string, team?: string) =>
    ok(
      await tool(key, "create_tasks", {
        tasks: [{ title, ...(team ? { team, assignee_id: mo.id } : {}) }],
      }),
    ).pending.proposal_id.replace("proposal:", "");
  const agent = await mk(keys.suggest, "Expiry check");
  const e = (
    await pool.query(
      "SELECT expires_at - created_at AS span FROM proposals WHERE id = $1",
      [agent],
    )
  ).rows[0];
  assert.equal(e.span.hours ?? e.span.days * 24, 72);
  // A team going down to reading cancels its pending agent proposals.
  const teamOne = await mk(keys.write, "Team change", crew);
  const personalOne = await mk(keys.suggest, "Personal change");
  const put = await h.call(olga.token, "PUT", `/teams/${crew}/agent-access`, {
    agent_access: "read",
  });
  assert.equal(put.statusCode, 200);
  const status = async (id: string) =>
    (await pool.query("SELECT status FROM proposals WHERE id = $1", [id]))
      .rows[0].status;
  assert.equal(await status(teamOne), "cancelled");
  assert.equal(await status(personalOne), "pending");
  await h.call(olga.token, "PUT", `/teams/${crew}/agent-access`, {
    agent_access: "role",
  });
  // Ending the connection cancels what it proposed.
  const del = await h.call(
    olga.token,
    "DELETE",
    `/me/agents/${grants.suggest}`,
  );
  assert.equal(del.statusCode, 204);
  assert.equal(await status(personalOne), "cancelled");
  // Leaving a team cancels one's agent proposals that touch it.
  const mine = ok(
    await tool(keys.mo, "create_tasks", {
      tasks: [{ title: "Mo's team change", team: crew, assignee_id: olga.id }],
    }),
  ).pending.proposal_id.replace("proposal:", "");
  await pool.query(
    "DELETE FROM team_members WHERE team_id = $1 AND user_id = $2",
    [crew, mo.id],
  );
  assert.equal(await status(mine), "cancelled");
  await pool.query(
    "INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'member')",
    [crew, mo.id],
  );
  // The sweeper keeps a decided agent proposal a month, then lets it go.
  const rule = SWEEP_RULES.find((r) => r.key === "proposals")!;
  await pool.query(
    "UPDATE proposals SET decided_at = now() - interval '31 days' WHERE id = $1",
    [teamOne],
  );
  const doomed = await pool.query(
    `SELECT id FROM proposals WHERE id = ANY($1::uuid[]) AND (${rule.where})`,
    [[teamOne, personalOne, agent]],
  );
  assert.deepEqual(
    doomed.rows.map((r) => r.id),
    [teamOne],
  );
});

test("URL-mode elicitation: a client that opens links is sent to the review page", async () => {
  const call = (state?: string) =>
    h.post(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "create_tasks",
          arguments: {
            tasks: [{ title: "Needs a look", team: crew, assignee_id: mo.id }],
            client_ref: "elicit-1",
          },
          ...(state
            ? {
                requestState: state,
                inputResponses: { review: { action: "accept" } },
              }
            : {}),
          _meta: {
            [META_KEYS.version]: MODERN,
            [META_KEYS.client]: { name: "test", version: "1" },
            [META_KEYS.caps]: { elicitation: { url: {} } },
          },
        },
      },
      {
        ...bearer(keys.write),
        "mcp-protocol-version": MODERN,
        "mcp-method": "tools/call",
        "mcp-name": "create_tasks",
      },
    );
  limiter.reset();
  strikes.reset();
  const first = await call();
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const result = first.body.result;
  assert.equal(result.resultType, "input_required", JSON.stringify(result));
  const request = result.inputRequests.review;
  assert.equal(request.method, "elicitation/create");
  assert.equal(request.params.mode, "url");
  assert.match(request.params.url, /\/app\/review\/[0-9a-f-]{36}$/);
  const proposals = await pool.query(
    "SELECT id FROM proposals WHERE grant_id = $1 AND summary LIKE '%Needs a look%'",
    [grants.write],
  );
  assert.equal(proposals.rowCount, 1);
  // Coming back: the outcome, and no second proposal.
  const back = await call(result.requestState);
  assert.equal(back.status, 200, JSON.stringify(back.body));
  assert.match(back.body.result.content[0].text, /still waits/);
  const still = await pool.query(
    "SELECT id FROM proposals WHERE grant_id = $1 AND summary LIKE '%Needs a look%'",
    [grants.write],
  );
  assert.equal(still.rowCount, 1);
  // A forged state is refused.
  const forged = await call(`${result.requestState.slice(0, -2)}xx`);
  assert.ok(forged.body.error, JSON.stringify(forged.body));
});
