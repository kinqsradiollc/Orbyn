import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
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
 * H1: full power and approvals in the chat. Trust per connection and per
 * space (full, ask, suggest) against the ask-first list and whether the
 * app can ask in the chat (form elicitation), falling back to URL mode and
 * the Review inbox (whose push has Approve and Decline); own deletes made
 * at once with 30 days to undo; list_agent_changes and undo; the trust
 * settings; and the migration that maps existing connections.
 */

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { limiter, strikes } =
  await import("../src/modules/mcp-server/routes.js");
const { reviewCategory, sendPush, REVIEW_CATEGORY } =
  await import("../src/worker/channels/push.js");
const { asksInChat } = await import("../src/modules/mcp-server/elicit.js");

const app = await buildApp();
const h = helpers(app);
const network = await trapNetwork();

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
const itemRow = async (id: string) =>
  (await pool.query("SELECT * FROM items WHERE id = $1", [id])).rows[0];
const idOf = (typed: string) => typed.replace(/^\w+:/, "").slice(0, 36);
const proposalsOf = async (grant: string) =>
  (
    await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM proposals WHERE grant_id = $1",
      [grant],
    )
  ).rows[0].n;

/** A task of Mo's in the crew: a teammate's work for Olga. */
const mosTask = async (title: string) =>
  (
    await h.call(mo.token, "POST", "/items", { title, team_id: crew })
  ).json() as { id: string; version: number };

const deleteTask = (t: { id: string; version: number }) => ({
  summary: "Tidy up",
  changes: [
    { type: "delete_task", target: `task:${t.id}`, version: t.version },
  ],
});

before(async () => {
  await migrate();
  olga = await h.register("tr-olga", "Olga");
  mo = await h.register("tr-mo", "Mo");
  crew = await h.team(olga, "Crew", [[mo, "member"]]);
  const make = async (name: string, body: Record<string, unknown>) => {
    const k = await h.agentKey(olga, { team_ids: [crew], ...body });
    keys[name] = k.key;
    grants[name] = k.id;
  };
  await make("full", { access: "write" });
  await make("ask", { access: "write", trust: "ask" });
  await make("suggest", { access: "write", trust: "suggest" });
  await make("other", { access: "write" });
});

after(async () => {
  const { closeLive } = await import("../src/modules/docs/live.js");
  await closeLive();
  assert.deepEqual(network.calls, [], "trust never reaches the network");
  network.restore();
  await app.close();
  await pool.end();
});

test("new connections start at full power; the trust settings validate and show", async () => {
  const list = (await h.call(olga.token, "GET", "/me/agents")).json();
  const full = list.grants.find((g: any) => g.id === grants.full);
  assert.equal(full.trust, "full");
  assert.deepEqual(full.space_trust, {});
  assert.deepEqual(full.acts_alone, []);
  // A suggest-only connection stays suggesting, whatever is asked for.
  const sug = await h.agentKey(olga, { access: "suggest", team_ids: [crew] });
  const raised = await h.call(olga.token, "PUT", `/me/agents/${sug.id}/trust`, {
    trust: "full",
  });
  assert.equal(raised.statusCode, 422);
  const view = (await h.call(olga.token, "GET", "/me/agents")).json();
  assert.equal(view.grants.find((g: any) => g.id === sug.id).trust, "suggest");
  // A team it can't reach, or nonsense, is refused.
  const other = await h.register("tr-otto", "Otto");
  const ottoTeam = await h.team(other, "Elsewhere");
  const bad = await h.call(
    olga.token,
    "PUT",
    `/me/agents/${grants.other}/trust`,
    {
      spaces: { [ottoTeam]: "ask" },
    },
  );
  assert.equal(bad.statusCode, 404);
  const junk = await h.call(
    olga.token,
    "PUT",
    `/me/agents/${grants.other}/trust`,
    {
      trust: "everything",
    },
  );
  assert.equal(junk.statusCode, 422);
  // Someone else's connection isn't there.
  const theirs = await h.call(
    mo.token,
    "PUT",
    `/me/agents/${grants.other}/trust`,
    {
      trust: "ask",
    },
  );
  assert.equal(theirs.statusCode, 404);
  // Signed out: 401.
  const anon = await h.call(null, "PUT", `/me/agents/${grants.other}/trust`, {
    trust: "ask",
  });
  assert.equal(anon.statusCode, 401);
  // Per space and ask-first toggles are kept, and get_context says so.
  const set = await h.call(
    olga.token,
    "PUT",
    `/me/agents/${grants.other}/trust`,
    { spaces: { personal: "ask", [crew]: "full" }, acts_alone: ["bulk"] },
  );
  assert.equal(set.statusCode, 200, set.body);
  assert.deepEqual(set.json().space_trust, { personal: "ask" });
  assert.deepEqual(set.json().acts_alone, ["bulk"]);
  const ctx = ok(await tool(keys.other, "get_context"));
  assert.equal(ctx.connection.trust, "full");
  assert.equal(ctx.connection.personal_trust, "ask");
  assert.ok(!ctx.connection.asks_first.includes("bulk"));
  assert.ok(ctx.connection.asks_first.includes("teammates"));
  assert.equal(ctx.teams[0].trust, "full");
  // Back to the default for Personal.
  const reset = await h.call(
    olga.token,
    "PUT",
    `/me/agents/${grants.other}/trust`,
    { spaces: { personal: null }, acts_alone: [] },
  );
  assert.deepEqual(reset.json().space_trust, {});
});

test("the matrix without a form: full is direct, ask and suggest go to review, a teammate's work asks", async () => {
  // Full: the person's own task is made and deleted at once.
  const made = ok(
    await tool(keys.full, "create_tasks", {
      tasks: [{ title: "Mine to delete", steps: ["One", "Two"] }],
    }),
  ).done[0];
  const gone = ok(
    await tool(keys.full, "propose_changes", {
      summary: "Tidy",
      changes: [
        { type: "delete_task", target: made.id, version: made.version },
      ],
    }),
  );
  assert.equal(gone.status, "done");
  assert.equal(gone.done[0].change, "Deleted");
  assert.equal(await itemRow(idOf(made.id)), undefined);
  // A teammate's task asks first: to the Review inbox without a form.
  const theirs = await mosTask("Mo's plan");
  const before = await proposalsOf(grants.full);
  const asked = ok(
    await tool(keys.full, "propose_changes", deleteTask(theirs)),
  );
  assert.equal(asked.status, "pending_review");
  assert.ok(await itemRow(theirs.id), "still there");
  assert.equal(await proposalsOf(grants.full), before + 1);
  // Changing it asks too; completing a task given to Olga doesn't.
  const edit = ok(
    await tool(keys.full, "update_tasks", {
      changes: [
        { id: `task:${theirs.id}`, version: theirs.version, title: "x" },
      ],
    }),
  );
  assert.equal(edit.status, "pending_review");
  const given = (
    await h.call(mo.token, "POST", "/items", {
      title: "For Olga",
      team_id: crew,
      assignee_id: olga.id,
    })
  ).json();
  const completed = ok(
    await tool(keys.full, "complete_tasks", {
      tasks: [{ id: `task:${given.id}`, version: given.version }],
    }),
  );
  assert.equal(completed.status, "done");
  // Ask: every change waits, even a new private task.
  const ask = ok(
    await tool(keys.ask, "create_tasks", { tasks: [{ title: "Asked task" }] }),
  );
  assert.equal(ask.status, "pending_review");
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM items WHERE title = 'Asked task' AND user_id = $1",
        [olga.id],
      )
    ).rowCount,
    0,
  );
  // Ask with a change that can't wait for review: refused, and says why.
  const cantWait = await tool(keys.ask, "log_focus", {});
  assert.equal(cantWait.isError, true);
  // Suggest: the same.
  const sug = ok(
    await tool(keys.suggest, "create_tasks", {
      tasks: [{ title: "Suggested task" }],
    }),
  );
  assert.equal(sug.status, "pending_review");
  // More than 50 changes at once asks first.
  const bulk = ok(
    await tool(keys.full, "create_project", {
      name: "Big one",
      stages: [
        { name: "A", tasks: Array.from({ length: 30 }, (_, i) => `A${i}`) },
        { name: "B", tasks: Array.from({ length: 30 }, (_, i) => `B${i}`) },
      ],
    }),
  );
  assert.equal(bulk.status, "pending_review");
  // Per space: Personal set to ask, the crew still at full power.
  await h.call(olga.token, "PUT", `/me/agents/${grants.other}/trust`, {
    spaces: { personal: "ask" },
  });
  const personal = ok(
    await tool(keys.other, "create_tasks", { tasks: [{ title: "P ask" }] }),
  );
  assert.equal(personal.status, "pending_review");
  const team = ok(
    await tool(keys.other, "create_tasks", {
      tasks: [{ title: "Crew direct", team: crew }],
    }),
  );
  assert.equal(team.status, "done");
  // Acts alone: a teammate's work, once the person allows it.
  await h.call(olga.token, "PUT", `/me/agents/${grants.other}/trust`, {
    spaces: { personal: null },
    acts_alone: ["teammates"],
  });
  const alone = await mosTask("Mo's scratch");
  const direct = ok(
    await tool(keys.other, "propose_changes", deleteTask(alone)),
  );
  assert.equal(direct.status, "done");
  assert.equal(await itemRow(alone.id), undefined);
  await h.call(olga.token, "PUT", `/me/agents/${grants.other}/trust`, {
    acts_alone: [],
  });
  // A team capped at suggest wins over full power.
  await pool.query("UPDATE teams SET agent_access = 'suggest' WHERE id = $1", [
    crew,
  ]);
  const capped = ok(
    await tool(keys.full, "create_tasks", {
      tasks: [{ title: "Capped", team: crew }],
    }),
  );
  assert.equal(capped.status, "pending_review");
  await pool.query("UPDATE teams SET agent_access = 'role' WHERE id = $1", [
    crew,
  ]);
});

test("own deletes: a page to Trash, a project and a list come back with undo", async () => {
  const page = ok(
    await tool(keys.full, "create_doc", {
      title: "Scratch page",
      markdown: "Hi",
    }),
  ).done[0];
  const project = ok(
    await tool(keys.full, "create_project", {
      name: "Short lived",
      stages: [{ name: "Only", tasks: ["Filed task"] }],
    }),
  ).done;
  const projectId = project.find((d: any) => d.id.startsWith("project:")).id;
  const del = ok(
    await tool(keys.full, "propose_changes", {
      summary: "Clear out",
      changes: [
        { type: "delete_doc", target: page.id, version: page.version },
        { type: "delete_project", target: projectId },
      ],
    }),
  );
  assert.equal(del.status, "done");
  const trashed = (
    await pool.query("SELECT deleted_at FROM docs WHERE id = $1", [
      idOf(page.id),
    ])
  ).rows[0];
  assert.ok(trashed.deleted_at);
  assert.equal(
    (
      await pool.query("SELECT 1 FROM projects WHERE id = $1", [
        idOf(projectId),
      ])
    ).rowCount,
    0,
  );
  const changes = ok(await tool(keys.full, "list_agent_changes", { limit: 5 }));
  const latest = changes.changes[0];
  assert.equal(latest.tool, "propose_changes");
  assert.ok(latest.undo_until, "can be undone");
  assert.ok(Date.parse(latest.undo_until) > Date.now() + 29 * 86_400_000);
  const undone = ok(await tool(keys.full, "undo", { change: latest.id }));
  assert.equal(undone.undone[0].id, latest.id);
  const back = (
    await pool.query("SELECT deleted_at FROM docs WHERE id = $1", [
      idOf(page.id),
    ])
  ).rows[0];
  assert.equal(back.deleted_at, null);
  const again = (
    await pool.query(
      `SELECT p.name, (SELECT count(*)::int FROM project_stages s WHERE s.project_id = p.id) AS stages,
              (SELECT count(*)::int FROM items i WHERE i.project_id = p.id) AS tasks
         FROM projects p WHERE p.id = $1`,
      [idOf(projectId)],
    )
  ).rows[0];
  assert.deepEqual(again, { name: "Short lived", stages: 1, tasks: 1 });
});

test("list_agent_changes and undo: this connection's own, once, while unchanged, for 30 days", async () => {
  const t = ok(
    await tool(keys.full, "create_tasks", {
      tasks: [{ title: "Undo me", steps: ["Step"] }],
    }),
  ).done[0];
  // A subtask goes with it and comes back with it.
  const sub = (
    await h.call(olga.token, "POST", "/items", {
      title: "Child",
      parent_id: idOf(t.id),
    })
  ).json();
  const now = await itemRow(idOf(t.id));
  ok(
    await tool(keys.full, "propose_changes", {
      summary: "Delete",
      changes: [{ type: "delete_task", target: t.id, version: now.version }],
    }),
  );
  assert.equal(await itemRow(sub.id), undefined, "the subtask went too");
  const list = ok(await tool(keys.full, "list_agent_changes", {}));
  const del = list.changes.find(
    (c: any) => c.tool === "propose_changes" && c.undo_until,
  );
  assert.ok(del.job, "each change names its call");
  // Another connection can't see or undo it.
  const others = ok(await tool(keys.other, "list_agent_changes", {}));
  assert.ok(!others.changes.some((c: any) => c.id === del.id));
  assert.equal(
    code(await tool(keys.other, "undo", { change: del.id })),
    "NOT_FOUND",
  );
  // A read connection can list but not undo.
  const reader = await h.agentKey(olga, { access: "read", team_ids: [crew] });
  ok(await tool(reader.key, "list_agent_changes", {}));
  assert.equal(
    code(await tool(reader.key, "undo", { change: del.id })),
    "FORBIDDEN",
  );
  // Both or neither is invalid.
  assert.equal(code(await tool(keys.full, "undo", {})), "INVALID");
  // The whole job, by its call.
  ok(await tool(keys.full, "undo", { job: del.job }));
  const back = await itemRow(idOf(t.id));
  assert.ok(back, "the task is back");
  assert.ok(await itemRow(sub.id), "with its subtask");
  const steps = await pool.query(
    "SELECT title FROM item_steps WHERE item_id = $1",
    [back.id],
  );
  assert.deepEqual(
    steps.rows.map((r) => r.title),
    ["Step"],
  );
  // Once only.
  assert.equal(
    code(await tool(keys.full, "undo", { change: del.id })),
    "INVALID",
  );
  const listed = ok(
    await tool(keys.full, "list_agent_changes", { include_undone: false }),
  );
  assert.ok(!listed.changes.some((c: any) => c.id === del.id));
  // Changed since: STALE, nothing undone.
  const edit = ok(
    await tool(keys.full, "update_tasks", {
      changes: [{ id: t.id, version: back.version, priority: "high" }],
    }),
  ).done[0];
  await h.call(olga.token, "PUT", `/items/${back.id}`, {
    title: "Edited by hand",
    version: edit.version,
  });
  const changed = ok(await tool(keys.full, "list_agent_changes", {}))
    .changes[0];
  assert.equal(changed.tool, "update_tasks");
  assert.equal(
    code(await tool(keys.full, "undo", { change: changed.id })),
    "STALE",
  );
  assert.equal((await itemRow(back.id)).title, "Edited by hand");
  // Past 30 days: refused.
  await pool.query(
    "UPDATE agent_activity SET undo_until = now() - interval '1 day' WHERE id = $1",
    [idOf(changed.id).replace(/\D/g, "")],
  );
  const late = await tool(keys.full, "undo", { change: changed.id });
  assert.equal(code(late), "INVALID");
  assert.match(late.content[0].text, /30 days/);
});

test("asking in the chat: a form for a teammate's work; yes makes it, no and dismissing don't", async () => {
  assert.equal(asksInChat({ elicitation: {} }), true);
  assert.equal(asksInChat({ elicitation: { url: {} } }), false);
  assert.equal(asksInChat({ elicitation: { form: {}, url: {} } }), true);
  assert.equal(asksInChat({}), false);
  const t = await mosTask("Mo's draft");
  const args = deleteTask(t);
  const before = await proposalsOf(grants.full);
  const first = await modern(keys.full, "propose_changes", args, FORM);
  const result = first.result;
  assert.equal(result.resultType, "input_required", JSON.stringify(result));
  const request = result.inputRequests.confirm;
  assert.equal(request.method, "elicitation/create");
  assert.equal(request.params.mode, "form");
  assert.match(request.params.message, /Mo's draft/);
  assert.match(request.params.message, /teammate/);
  assert.deepEqual(request.params.requestedSchema.required, ["confirm"]);
  assert.equal(
    request.params.requestedSchema.properties.confirm.type,
    "boolean",
  );
  // Nothing changed and nothing waits in the inbox.
  assert.ok(await itemRow(t.id));
  assert.equal(await proposalsOf(grants.full), before);
  // No: nothing changes.
  const no = await modern(keys.full, "propose_changes", args, FORM, {
    state: result.requestState,
    responses: { confirm: { action: "decline" } },
  });
  assert.equal(no.result.isError, true);
  assert.equal(no.result._meta["orbyn/error"].code, "DECLINED");
  assert.ok(await itemRow(t.id));
  // Dismissed: nothing changes either.
  const dismissed = await modern(keys.full, "propose_changes", args, FORM, {
    state: result.requestState,
    responses: { confirm: { action: "cancel" } },
  });
  assert.equal(dismissed.result._meta["orbyn/error"].code, "CANCELLED");
  // Accepted but unticked is a no.
  const unticked = await modern(keys.full, "propose_changes", args, FORM, {
    state: result.requestState,
    responses: { confirm: { action: "accept", content: { confirm: false } } },
  });
  assert.equal(unticked.result._meta["orbyn/error"].code, "DECLINED");
  // The yes can't be used for other arguments.
  const other = await mosTask("Mo's other");
  const swapped = await modern(
    keys.full,
    "propose_changes",
    deleteTask(other),
    FORM,
    {
      state: result.requestState,
      responses: { confirm: { action: "accept", content: { confirm: true } } },
    },
  );
  assert.ok(swapped.error, JSON.stringify(swapped));
  assert.ok(await itemRow(other.id));
  // Nor by another connection.
  const stolen = await modern(keys.other, "propose_changes", args, FORM, {
    state: result.requestState,
    responses: { confirm: { action: "accept", content: { confirm: true } } },
  });
  assert.ok(stolen.error);
  // Yes: made directly, with undo.
  const yes = await modern(keys.full, "propose_changes", args, FORM, {
    state: result.requestState,
    responses: { confirm: { action: "accept", content: { confirm: true } } },
  });
  assert.ok(!yes.result.isError, JSON.stringify(yes.result));
  assert.equal(yes.result.structuredContent.status, "done");
  assert.equal(await itemRow(t.id), undefined);
  assert.equal(await proposalsOf(grants.full), before);
  // The person's own things never ask, form or not.
  const mine = ok(
    await tool(keys.full, "create_tasks", { tasks: [{ title: "Own" }] }),
  ).done[0];
  const own = await modern(
    keys.full,
    "propose_changes",
    {
      summary: "Own",
      changes: [
        { type: "delete_task", target: mine.id, version: mine.version },
      ],
    },
    FORM,
  );
  assert.equal(own.result.structuredContent.status, "done");
});

test("asking in the chat: ask trust asks for everything; suggest never asks", async () => {
  const args = { tasks: [{ title: "Asked in chat" }] };
  const first = await modern(keys.ask, "create_tasks", args, FORM);
  assert.equal(first.result.resultType, "input_required");
  assert.match(
    first.result.inputRequests.confirm.params.message,
    /Asked in chat[\s\S]*before every change/,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM items WHERE title = 'Asked in chat' AND user_id = $1",
        [olga.id],
      )
    ).rowCount,
    0,
  );
  const yes = await modern(keys.ask, "create_tasks", args, FORM, {
    state: first.result.requestState,
    responses: { confirm: { action: "accept", content: { confirm: true } } },
  });
  assert.equal(yes.result.structuredContent.status, "done");
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM items WHERE title = 'Asked in chat' AND user_id = $1",
        [olga.id],
      )
    ).rowCount,
    1,
  );
  // Reads never ask.
  const read = await modern(keys.ask, "get_context", {}, FORM);
  assert.ok(read.result.structuredContent);
  // Suggest: the Review inbox, even with a form.
  const sug = await modern(
    keys.suggest,
    "create_tasks",
    { tasks: [{ title: "Suggested in chat" }] },
    FORM,
  );
  assert.equal(sug.result.structuredContent.status, "pending_review");
});

test("URL mode is the fallback for apps that open links but show no form", async () => {
  const t = await mosTask("Mo's link case");
  const r = await modern(keys.full, "propose_changes", deleteTask(t), {
    elicitation: { url: {} },
  });
  assert.equal(r.result.resultType, "input_required");
  const request = r.result.inputRequests.review;
  assert.equal(request.params.mode, "url");
  assert.match(request.params.url, /\/app\/review\/[0-9a-f-]{36}$/);
  assert.ok(await itemRow(t.id));
});

test("the Review inbox's push carries Approve and Decline, answered from the phone", async () => {
  await pool.query(
    "INSERT INTO devices (user_id, token) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [olga.id, `ExponentPushToken[trust-${olga.id.slice(0, 8)}]`],
  );
  const t = await mosTask("Mo's push case");
  const asked = ok(await tool(keys.full, "propose_changes", deleteTask(t)));
  const id = idOf(asked.pending.proposal_id);
  const push = (
    await pool.query(
      "SELECT kind, ref, destination, title FROM notifications WHERE ref = $1 AND channel = 'push'",
      [`proposal:${id}`],
    )
  ).rows[0];
  assert.ok(push, "a push is queued");
  assert.equal(reviewCategory(push), true);
  assert.equal(reviewCategory({ kind: "reminder", ref: "x" }), false);
  // The push carries the category with the buttons.
  const real = globalThis.fetch;
  let sent: any = null;
  globalThis.fetch = (async (_url: unknown, init: { body: string }) => {
    sent = JSON.parse(init.body);
    return new Response(JSON.stringify({ data: { status: "ok", id: "r1" } }));
  }) as typeof fetch;
  try {
    await sendPush(
      { ...push, item_id: null, body: "b", receipt_id: null },
      false,
    );
  } finally {
    globalThis.fetch = real;
  }
  assert.equal(sent.categoryId, REVIEW_CATEGORY);
  assert.equal(sent.data.ref, `proposal:${id}`);
  // Agents and keys can't answer it.
  const agent = await app.inject({
    method: "POST",
    url: `/proposals/${id}/respond`,
    headers: bearer(keys.full),
    payload: { decision: "approve" },
  });
  assert.equal(agent.statusCode, 401);
  const apiKey = (
    await h.call(olga.token, "POST", "/me/api-keys", { name: "Script" })
  ).json().key as string;
  const byKey = await app.inject({
    method: "POST",
    url: `/proposals/${id}/respond`,
    headers: bearer(apiKey),
    payload: { decision: "approve" },
  });
  assert.equal(byKey.statusCode, 403);
  const invalid = await h.call(olga.token, "POST", `/proposals/${id}/respond`, {
    decision: "maybe",
  });
  assert.equal(invalid.statusCode, 422);
  const notHers = await h.call(mo.token, "POST", `/proposals/${id}/respond`, {
    decision: "approve",
  });
  assert.equal(notHers.statusCode, 404);
  // Approve: made; a second tap says how it ended.
  const yes = await h.call(olga.token, "POST", `/proposals/${id}/respond`, {
    decision: "approve",
  });
  assert.equal(yes.statusCode, 200, yes.body);
  assert.deepEqual(yes.json(), { status: "applied" });
  assert.equal(await itemRow(t.id), undefined);
  const twice = await h.call(olga.token, "POST", `/proposals/${id}/respond`, {
    decision: "decline",
  });
  assert.deepEqual(twice.json(), { status: "applied" });
  // Decline: nothing changes.
  const t2 = await mosTask("Mo's keep");
  const asked2 = ok(await tool(keys.full, "propose_changes", deleteTask(t2)));
  const no = await h.call(
    olga.token,
    "POST",
    `/proposals/${idOf(asked2.pending.proposal_id)}/respond`,
    { decision: "decline" },
  );
  assert.deepEqual(no.json(), { status: "declined" });
  assert.ok(await itemRow(t2.id));
});

test("migration 156 maps existing connections and runs again safely", async () => {
  const sql = await readFile(
    fileURLToPath(
      new URL("../migrations/156_agent_trust.sql", import.meta.url),
    ),
    "utf8",
  );
  const w = await h.agentKey(olga, { access: "write", team_ids: [crew] });
  const s = await h.agentKey(olga, { access: "suggest", team_ids: [crew] });
  const r = await h.agentKey(olga, { access: "read", team_ids: [crew] });
  // As they were before: no trust of their own yet.
  await pool.query(
    "UPDATE agent_grants SET trust = 'full' WHERE id = ANY ($1::uuid[])",
    [[w.id, s.id, r.id]],
  );
  await pool.query(sql);
  await pool.query(sql);
  const rows = (
    await pool.query<{ id: string; access: string; trust: string }>(
      "SELECT id, access, trust FROM agent_grants WHERE id = ANY ($1::uuid[])",
      [[w.id, s.id, r.id]],
    )
  ).rows;
  const by = new Map(rows.map((x) => [x.id, x]));
  assert.equal(by.get(w.id)!.trust, "full");
  assert.equal(by.get(s.id)!.trust, "suggest");
  assert.equal(by.get(r.id)!.access, "read", "read-only stays read-only");
  const bad = await pool
    .query("UPDATE agent_grants SET trust = 'boss' WHERE id = $1", [w.id])
    .catch((e) => e);
  assert.match(String(bad), /agent_grants_trust_check/);
});
