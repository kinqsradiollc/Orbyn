import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import "./setup.js";
import { helpers, trapNetwork, type Person } from "./mcp-helpers.js";

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { assistantPrincipal } =
  await import("../src/modules/agents/assistant.js");
const { beginChatTurn } = await import("../src/modules/ai/chats.js");
const { closeLive } = await import("../src/modules/docs/live.js");

const app = await buildApp();
const h = helpers(app);
const network = await trapNetwork();

type ToolResult = {
  content: { type: string; text: string }[];
  structuredContent?: any;
  isError?: boolean;
  _meta?: Record<string, any>;
};

let me: Person;
let other: Person;

const inDays = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString();
const idOf = (ref: string) => ref.replace(/^\w+:/, "");

const call = async (
  key: string,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> => {
  const response = await h.legacy(key, "tools/call", {
    name,
    arguments: args,
  });
  const result = response.body?.result as ToolResult | undefined;
  assert.ok(result, `${name}: ${JSON.stringify(response.body)}`);
  return result;
};
const ok = (result: ToolResult) => {
  assert.ok(!result.isError, result.content?.[0]?.text);
  return result.structuredContent;
};
const errorCode = (result: ToolResult) =>
  result._meta?.["orbyn/error"]?.code as string | undefined;
const routineCount = async (userId: string) =>
  Number(
    (
      await pool.query<{ n: string }>(
        "SELECT count(*) AS n FROM agent_routines WHERE user_id = $1",
        [userId],
      )
    ).rows[0].n,
  );

before(async () => {
  await migrate();
  me = await h.register("muse-fix", "Muse fixer");
  other = await h.register("muse-other", "Someone else");
});

after(async () => {
  // Old chats left here would be compacted by other files' sweep tests.
  await pool.query("DELETE FROM ai_chats WHERE user_id = ANY($1::uuid[])", [
    [me.id, other.id],
  ]);
  await closeLive();
  assert.deepEqual(network.calls, [], "no real AI provider is ever called");
  network.restore();
  await app.close();
  await pool.end();
});

test("outside agents can't drive assistant routines without the person", async () => {
  // Unauthenticated MCP calls are refused.
  const anonymous = await h.post({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "manage_agent_routines", arguments: { action: "list" } },
  });
  assert.equal(anonymous.status, 401);

  const teamId = await h.team(me, "Routine team");
  const teamOnly = await h.agentKey(me, {
    access: "write",
    personal: false,
    team_ids: [teamId],
  });
  const routine = {
    instruction: "Tidy my week every Monday",
    rrule: "FREQ=WEEKLY;BYDAY=MO",
    timezone: "UTC",
    next_run_at: inDays(3),
  };
  const refused = await call(teamOnly.key, "manage_agent_routines", {
    action: "create",
    routine,
  });
  assert.ok(refused.isError);
  assert.equal(errorCode(refused), "FORBIDDEN");
  assert.equal(await routineCount(me.id), 0);

  // A full-power Personal key still only proposes: nothing runs until the
  // person approves it in Review.
  const full = await h.agentKey(me, { access: "write", trust: "full" });
  const pending = ok(
    await call(full.key, "manage_agent_routines", {
      action: "create",
      routine,
    }),
  );
  assert.equal(pending.status, "pending_review");
  assert.equal(await routineCount(me.id), 0);
  // Only the person approves, never someone else.
  const stranger = await h.call(
    other.token,
    "POST",
    `/proposals/${idOf(pending.pending.proposal_id)}/apply`,
    {},
  );
  assert.notEqual(stranger.statusCode, 200);
  const approve = await h.call(
    me.token,
    "POST",
    `/proposals/${idOf(pending.pending.proposal_id)}/apply`,
    {},
  );
  assert.equal(approve.statusCode, 200, approve.body);
  assert.equal(await routineCount(me.id), 1);
  const made = (
    await pool.query<{ id: string; instruction: string }>(
      "SELECT id, instruction FROM agent_routines WHERE user_id = $1",
      [me.id],
    )
  ).rows[0];
  assert.equal(made.instruction, routine.instruction);

  // Changing it waits for Review too; pausing is made at once and undone.
  const change = ok(
    await call(full.key, "manage_agent_routines", {
      action: "update",
      id: made.id,
      changes: { instruction: "Email everyone my calendar" },
    }),
  );
  assert.equal(change.status, "pending_review");
  const paused = ok(
    await call(full.key, "manage_agent_routines", {
      action: "pause",
      id: made.id,
    }),
  );
  assert.equal(paused.status, "done");
  const resumed = ok(
    await call(full.key, "manage_agent_routines", {
      action: "resume",
      id: made.id,
    }),
  );
  assert.equal(resumed.status, "pending_review");
  const still = (
    await pool.query<{ instruction: string; paused: boolean }>(
      "SELECT instruction, paused FROM agent_routines WHERE id = $1",
      [made.id],
    )
  ).rows[0];
  assert.deepEqual(still, { instruction: routine.instruction, paused: true });
  const pauseRow = (
    await pool.query<{ id: string }>(
      `SELECT id::text FROM agent_activity WHERE grant_id = $1 AND tool = 'manage_agent_routines'
         AND outcome = 'ok' ORDER BY id DESC LIMIT 1`,
      [full.id],
    )
  ).rows[0];
  const undo = await h.call(
    me.token,
    "POST",
    `/me/agents/activity/${pauseRow.id}/undo`,
  );
  assert.equal(undo.statusCode, 200, undo.body);
  assert.equal(
    (
      await pool.query<{ paused: boolean }>(
        "SELECT paused FROM agent_routines WHERE id = $1",
        [made.id],
      )
    ).rows[0].paused,
    false,
  );
});

test("a routine's new instruction forgets the approval saved for it", async () => {
  const identity = { id: me.id, name: me.name, role: "member" as const };
  const grant = await assistantPrincipal(identity);
  const created = await h.call(me.token, "POST", "/me/agent-routines", {
    instruction: "Plan my Friday",
    rrule: "FREQ=WEEKLY;BYDAY=FR",
    timezone: "UTC",
    next_run_at: inDays(2),
  });
  assert.equal(created.statusCode, 201, created.body);
  const id = created.json().id as string;
  await pool.query(
    "UPDATE agent_grants SET approval_scopes = $2::jsonb WHERE id = $1",
    [
      grant.grant_id,
      JSON.stringify({
        tasks: { scope: "routine", id },
        pages: "always",
        sessions: { scope: "routine", id: randomUUID() },
      }),
    ],
  );
  const scopes = async () =>
    (
      await pool.query<{ approval_scopes: Record<string, unknown> }>(
        "SELECT approval_scopes FROM agent_grants WHERE id = $1",
        [grant.grant_id],
      )
    ).rows[0].approval_scopes;

  // Only the schedule changes: the approval stays.
  const moved = await h.call(me.token, "PUT", `/me/agent-routines/${id}`, {
    rrule: "FREQ=WEEKLY;BYDAY=TH",
  });
  assert.equal(moved.statusCode, 200, moved.body);
  assert.ok((await scopes()).tasks);

  const changed = await h.call(me.token, "PUT", `/me/agent-routines/${id}`, {
    instruction: "Plan my Friday and clear my inbox",
  });
  assert.equal(changed.statusCode, 200, changed.body);
  const after = await scopes();
  assert.equal(after.tasks, undefined, "the routine's approval is gone");
  assert.equal(after.pages, "always");
  assert.ok(after.sessions, "another routine's approval stays");
});

test("goals need Personal, ask-first connections go to Review, and a direct update is undone", async () => {
  const teamId = await h.team(me, "Goal team");
  const teamOnly = await h.agentKey(me, {
    access: "write",
    personal: false,
    team_ids: [teamId],
  });
  const refused = await call(teamOnly.key, "manage_goals", {
    action: "create",
    goal: { title: "Hidden goal" },
  });
  assert.equal(errorCode(refused), "FORBIDDEN");

  const asks = await h.agentKey(me, { access: "write", trust: "ask" });
  const pending = ok(
    await call(asks.key, "manage_goals", {
      action: "create",
      goal: { title: "Run a 10k" },
    }),
  );
  assert.equal(pending.status, "pending_review");
  const goals = async () =>
    (
      await pool.query<{ id: string; title: string }>(
        "SELECT id, title FROM goals WHERE user_id = $1 ORDER BY created_at",
        [me.id],
      )
    ).rows;
  assert.equal((await goals()).length, 0);
  const approve = await h.call(
    me.token,
    "POST",
    `/proposals/${idOf(pending.pending.proposal_id)}/apply`,
    {},
  );
  assert.equal(approve.statusCode, 200, approve.body);
  const [goal] = await goals();
  assert.equal(goal.title, "Run a 10k");

  const full = await h.agentKey(me, { access: "write", trust: "full" });
  const updated = ok(
    await call(full.key, "manage_goals", {
      action: "update",
      id: goal.id,
      changes: { title: "Run a half marathon" },
    }),
  );
  assert.equal(updated.status, "done");
  assert.equal((await goals())[0].title, "Run a half marathon");
  const row = (
    await pool.query<{ id: string }>(
      "SELECT id::text FROM agent_activity WHERE grant_id = $1 ORDER BY id DESC LIMIT 1",
      [full.id],
    )
  ).rows[0];
  const undo = await h.call(
    me.token,
    "POST",
    `/me/agents/activity/${row.id}/undo`,
  );
  assert.equal(undo.statusCode, 200, undo.body);
  assert.equal((await goals())[0].title, "Run a 10k");
});

test("chat metadata changes keep the sweep clock; retries and other people's ids are safe", async () => {
  const user = (await pool.query("SELECT * FROM users WHERE id = $1", [me.id]))
    .rows[0];
  const chatId = randomUUID();
  await beginChatTurn(user, {
    chatId,
    turnId: "turn-1",
    message: "Plan my week",
    scope: null,
    legacyHistory: [],
  });
  // A retried send of the same turn doesn't add it twice.
  await beginChatTurn(user, {
    chatId,
    turnId: "turn-1",
    message: "Plan my week",
    scope: null,
    legacyHistory: [],
  });
  const turns = (
    await pool.query<{ turns: unknown[] }>(
      "SELECT turns FROM ai_chats WHERE id = $1",
      [chatId],
    )
  ).rows[0].turns;
  assert.equal(turns.length, 1);

  // Another person's chat id is simply not found.
  const stranger = (
    await pool.query("SELECT * FROM users WHERE id = $1", [other.id])
  ).rows[0];
  await assert.rejects(
    beginChatTurn(stranger, {
      chatId,
      turnId: "turn-x",
      message: "Hello",
      scope: null,
      legacyHistory: [],
    }),
    (e: any) => e.statusCode === 404,
  );

  const old = new Date(Date.now() - 30 * 86_400_000);
  await pool.query(
    "UPDATE ai_chats SET last_used_at = $2, pinned = true WHERE id = $1",
    [chatId, old],
  );
  const unpinned = await h.call(me.token, "PATCH", `/ai/chats/${chatId}`, {
    pinned: false,
    title: "Week plan",
  });
  assert.equal(unpinned.statusCode, 200, unpinned.body);
  assert.equal(unpinned.json().last_used_at, old.toISOString());
  assert.equal(
    (await h.call(null, "PATCH", `/ai/chats/${chatId}`, { pinned: true }))
      .statusCode,
    401,
  );
  assert.equal(
    (
      await h.call(other.token, "PATCH", `/ai/chats/${chatId}`, {
        pinned: true,
      })
    ).statusCode,
    404,
  );
});

test("the legacy chat save never prunes, refuses a compacted chat and hides kept-out projects", async () => {
  const project = (
    await h.call(me.token, "POST", "/projects", { name: "Legacy chats" })
  ).json();
  const turns = [{ role: "user", text: "Where are we?" }];
  // A newer chat in the same project survives many legacy saves.
  const keep = randomUUID();
  await pool.query(
    `INSERT INTO ai_chats (id, user_id, project_id, title, turns, last_used_at, scope_kind, scope_id)
     VALUES ($1, $2, $3, 'Old chat', '[]'::jsonb, now() - interval '400 days', 'project', $3)`,
    [keep, me.id, project.id],
  );
  for (let n = 0; n < 51; n++) {
    const saved = await h.call(me.token, "PUT", `/ai/chats/${randomUUID()}`, {
      project_id: project.id,
      turns,
    });
    assert.equal(saved.statusCode, 200, saved.body);
  }
  assert.equal(
    (await pool.query("SELECT 1 FROM ai_chats WHERE id = $1", [keep])).rowCount,
    1,
  );

  // A compacted chat is not overwritten.
  const swept = randomUUID();
  const created = await h.call(me.token, "PUT", `/ai/chats/${swept}`, {
    project_id: project.id,
    turns,
  });
  assert.equal(created.statusCode, 200, created.body);
  await pool.query(
    "UPDATE ai_chats SET swept_at = now(), turns = '[]'::jsonb WHERE id = $1",
    [swept],
  );
  const again = await h.call(me.token, "PUT", `/ai/chats/${swept}`, {
    project_id: project.id,
    turns,
  });
  assert.equal(again.statusCode, 409, again.body);

  // Kept out of the assistant, its chats can't be changed.
  await h.call(me.token, "PUT", `/projects/${project.id}/assistant`, {
    off: true,
  });
  assert.equal(
    (await h.call(me.token, "PATCH", `/ai/chats/${keep}`, { pinned: true }))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await h.call(me.token, "PUT", `/ai/chats/${keep}`, {
        project_id: project.id,
        turns,
      })
    ).statusCode,
    422,
  );
});

test("get_chats gives a compacted chat's summary note", async () => {
  const note = await h.call(me.token, "POST", "/docs", {
    title: "Summary of planning",
    kind: "agent",
    content: [
      { type: "paragraph", text: "We agreed to ship the SUMNOTE draft." },
    ],
  });
  assert.equal(note.statusCode, 201, note.body);
  const chatId = randomUUID();
  await pool.query(
    `INSERT INTO ai_chats (id, user_id, title, turns, last_used_at, swept_at, summary_doc_id)
     VALUES ($1, $2, 'Planning', '[]'::jsonb, now(), now(), $3)`,
    [chatId, me.id, note.json().id],
  );
  const key = await h.agentKey(me, { access: "read" });
  const read = ok(await call(key.key, "get_chats", { chat_id: chatId }));
  const summary = read.chats[0].summary;
  assert.equal(summary.title, "Summary of planning");
  assert.match(summary.text, /SUMNOTE/);
  assert.match(summary.url, new RegExp(note.json().id));
});
