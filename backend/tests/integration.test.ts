import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Proposal } from "@orbyn/core";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";
let providerResponse: unknown = {
  summary: "Your week looks clear.",
  actions: [],
};
let providerStatus = 200;
let lastProviderRequest: { messages: { role: string; content: string }[] } = {
  messages: [],
};
const provider = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    lastProviderRequest = JSON.parse(body || "{}");
    const scripted = providerResponse as {
      tool_calls?: { name: string; arguments: unknown }[];
    };
    const toolCalls = scripted.tool_calls?.map((call, index) => ({
      id: `test_call_${index}`,
      type: "function",
      function: {
        name: call.name,
        arguments: JSON.stringify(call.arguments),
      },
    }));
    res.writeHead(providerStatus, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: toolCalls?.length ? "tool_calls" : "stop",
            message: toolCalls?.length
              ? { content: null, tool_calls: toolCalls }
              : { content: JSON.stringify(providerResponse) },
          },
        ],
      }),
    );
  });
});
await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
const providerUrl = `http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`;
process.env.SMTP_HOST = "";
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { enqueue } = await import("../src/worker/scheduler.js");
const { failStaleAssistantJobs } =
  await import("../src/modules/ai/agent/run.js");
const app = await buildApp();
let alice = "";
let bob = "";
let aliceId = "";
let bobId = "";
const headers = (token: string) => ({ authorization: `Bearer ${token}` });
const payload = (title = "A plan") => ({
  title,
  notes: "",
  kind: "task",
  status: "todo",
  priority: "medium",
  due_at: null,
  end_at: null,
  reminder_minutes: 30,
});
const clean = (i: Record<string, unknown>) => ({
  title: i.title,
  notes: i.notes,
  kind: i.kind,
  status: i.status,
  priority: i.priority,
  due_at: i.due_at,
  end_at: i.end_at,
  reminder_minutes: i.reminder_minutes,
  version: i.version,
});
async function pollAssistant(token: string, jobId: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await app.inject({
      url: `/ai/chat/${jobId}`,
      headers: headers(token),
    });
    assert.equal(response.statusCode, 200, response.body);
    const result = response.json();
    if (result.state !== "running") return result;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("The fake-provider chat job did not finish.");
}
before(async () => {
  await migrate();
  // The assistant uses the stand-in provider, chosen as an admin would in the
  // console (there is no server-settings fallback).
  const standIn = (
    await pool.query(
      "INSERT INTO ai_providers(kind, name, base_url) VALUES ('openai-compatible', 'Stand-in', $1) RETURNING id",
      [providerUrl],
    )
  ).rows[0].id;
  await pool.query(
    "UPDATE ai_settings SET provider_id=$1, model='test-provider' WHERE id",
    [standIn],
  );
  for (const name of ["alice", "bob"]) {
    const r = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: `${name}-${randomUUID()}@example.com`,
        password: "a-long-test-password",
        name,
      },
    });
    assert.equal(r.statusCode, 201);
    const u = r.json();
    if (name === "alice") {
      alice = u.token;
      aliceId = u.user.id;
    } else {
      bob = u.token;
      bobId = u.user.id;
    }
  }
});
after(async () => {
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
    [aliceId, bobId],
  ]);
  await pool.query("DELETE FROM ai_providers WHERE name='Stand-in'");
  await app.close();
  await pool.end();
  provider.close();
});
test("authentication rejects missing and revoked tokens", async () => {
  assert.equal((await app.inject({ url: "/items" })).statusCode, 401);
  const r = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email: "nobody@example.com", password: "invalid-password" },
  });
  assert.equal(r.statusCode, 401);
});
test("CRUD is tenant scoped and stale writes conflict", async () => {
  const created = await app.inject({
    method: "POST",
    url: "/items",
    headers: headers(alice),
    payload: payload(),
  });
  assert.equal(created.statusCode, 201);
  const i = created.json();
  const list = await app.inject({ url: "/items", headers: headers(bob) });
  assert.equal(list.json().length, 0);
  assert.equal(
    (
      await app.inject({
        method: "PUT",
        url: `/items/${i.id}`,
        headers: headers(bob),
        payload: { ...clean(i), title: "stolen" },
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        method: "DELETE",
        url: `/items/${i.id}?version=1`,
        headers: headers(bob),
      })
    ).statusCode,
    404,
  );
  const writes = await Promise.all(
    ["first", "second"].map((title) =>
      app.inject({
        method: "PUT",
        url: `/items/${i.id}`,
        headers: headers(alice),
        payload: { ...clean(i), title },
      }),
    ),
  );
  assert.deepEqual(writes.map((r) => r.statusCode).sort(), [200, 409]);
  assert.equal(
    (
      await app.inject({
        method: "DELETE",
        url: `/items/${i.id}?version=2`,
        headers: headers(alice),
      })
    ).statusCode,
    204,
  );
});
test("validates dates, ownership fields, event starts, and pagination", async () => {
  for (const raw of [
    { ...payload(), due_at: "2026-01-01T12:00:00" },
    { ...payload(), kind: "event" },
    { ...payload(), user_id: bobId },
    {
      ...payload(),
      due_at: "2026-01-02T12:00:00Z",
      end_at: "2026-01-01T12:00:00Z",
    },
    { ...payload(), reminder_minutes: -1 },
  ])
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/items",
          headers: headers(alice),
          payload: raw,
        })
      ).statusCode,
      422,
    );
  assert.equal(
    (await app.inject({ url: "/items?limit=501", headers: headers(alice) }))
      .statusCode,
    422,
  );
});
test("an assistant turn can be started, then polled for its answer", async () => {
  providerResponse = {
    tool_calls: [
      {
        name: "finish",
        arguments: { answer: "Nothing today.", steps: [] },
      },
    ],
  };
  const started = await app.inject({
    method: "POST",
    url: "/ai/chat/start",
    headers: headers(alice),
    payload: { message: "What is on today?", timezone: "Australia/Melbourne" },
  });
  assert.equal(started.statusCode, 202);
  const id = started.json().id;
  let job = { state: "running" } as {
    state: string;
    answer?: string;
    assistant_run?: { outcome?: string };
  };
  for (let i = 0; i < 50 && job.state === "running"; i++) {
    await new Promise((r) => setTimeout(r, 20));
    const r = await app.inject({
      url: `/ai/chat/${id}`,
      headers: headers(alice),
    });
    assert.equal(r.statusCode, 200);
    job = r.json();
  }
  assert.equal(job.state, "done");
  assert.equal(job.answer, "Nothing today.");
  assert.equal(job.assistant_run?.outcome, "info");
  // Someone else's turn is not there; a stopped copy's turn is reported.
  assert.equal(
    (await app.inject({ url: `/ai/chat/${id}`, headers: headers(bob) }))
      .statusCode,
    404,
  );
  await pool.query(
    "UPDATE ai_jobs SET state='running', heartbeat_at=now() - interval '2 minutes', lease_until=now() - interval '2 minutes' WHERE id=$1",
    [id],
  );
  await failStaleAssistantJobs();
  const stale = (
    await app.inject({ url: `/ai/chat/${id}`, headers: headers(alice) })
  ).json();
  assert.equal(stale.state, "failed");
  assert.equal(stale.status, 503);
});

test("the legacy chat URL starts the persistent lead assistant", async () => {
  providerResponse = {
    tool_calls: [
      {
        name: "finish",
        arguments: { answer: "The alias uses the lead assistant.", steps: [] },
      },
    ],
  };
  const started = await app.inject({
    method: "POST",
    url: "/ai/chat",
    headers: headers(alice),
    payload: { message: "Summarize today", timezone: "UTC" },
  });
  assert.equal(started.statusCode, 202, started.body);
  const result = await pollAssistant(alice, started.json().id);
  assert.equal(result.state, "done");
  assert.equal(result.answer, "The alias uses the lead assistant.");
  assert.equal("proposal" in result, false);
});
test("the assistant forwards conversation history to the provider", async () => {
  providerResponse = {
    tool_calls: [
      {
        name: "finish",
        arguments: { answer: "Tomorrow is clear too.", steps: [] },
      },
    ],
  };
  const started = await app.inject({
    method: "POST",
    url: "/ai/chat/start",
    headers: headers(alice),
    payload: {
      message: "And tomorrow?",
      timezone: "UTC",
      history: [
        { role: "user", content: "What is on today?" },
        { role: "assistant", content: "Nothing today." },
      ],
    },
  });
  assert.equal(started.statusCode, 202, started.body);
  const result = await pollAssistant(alice, started.json().id);
  assert.equal(result.state, "done");
  const messages = lastProviderRequest.messages;
  assert.deepEqual(
    messages.map((m) => m.role),
    ["system", "user", "assistant", "user"],
  );
  assert.equal(messages[1].content, "What is on today?");
  assert.equal(messages[2].content, "Nothing today.");
  assert.match(messages[3].content, /And tomorrow\?/);
});

test("assistant chats persist, resume from server history, and queue only each new pair", async () => {
  providerResponse = {
    tool_calls: [
      {
        name: "finish",
        arguments: { answer: "A durable answer.", steps: [] },
      },
    ],
  };
  const chatId = randomUUID();
  const firstTurnId = randomUUID();
  const secondTurnId = randomUUID();
  const waitFor = async (jobId: string) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const response = await app.inject({
        url: `/ai/chat/${jobId}`,
        headers: headers(alice),
      });
      assert.equal(response.statusCode, 200, response.body);
      const body = response.json();
      if (body.state !== "running") return body;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.fail("The fake-provider chat job did not finish.");
  };
  const start = async (turnId: string, message: string) => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/chat/start",
      headers: headers(alice),
      payload: {
        chat_id: chatId,
        turn_id: turnId,
        message,
        timezone: "UTC",
        history: [],
        scope: null,
      },
    });
    assert.equal(response.statusCode, 202, response.body);
    const started = response.json();
    assert.equal(started.chat_id, chatId);
    assert.equal(started.turn_id, turnId);
    return waitFor(started.id);
  };

  const first = await start(firstTurnId, "First durable question");
  assert.equal(first.state, "done");
  assert.equal(first.chat_id, chatId);
  assert.ok(
    first.trace.some((entry: { kind: string }) => entry.kind === "reply"),
  );
  assert.doesNotMatch(JSON.stringify(first.trace), /First durable question/);

  const second = await start(secondTurnId, "A follow-up question");
  assert.equal(second.state, "done");
  assert.deepEqual(
    lastProviderRequest.messages.map((message) => message.role),
    ["system", "user", "assistant", "user"],
  );
  assert.match(
    lastProviderRequest.messages[1].content,
    /First durable question/,
  );
  assert.match(lastProviderRequest.messages[2].content, /A durable answer/);

  const saved = await app.inject({
    url: `/ai/chats/${chatId}`,
    headers: headers(alice),
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.deepEqual(
    saved.json().turns.map((turn: { role: string }) => turn.role),
    ["user", "assistant", "user", "assistant"],
  );
  assert.equal(saved.json().turns[0].turn_id, firstTurnId);
  assert.equal(saved.json().turns[1].turn_id, firstTurnId);
  assert.equal(saved.json().turns[1].outcome, "info");
  assert.ok(saved.json().trace.length >= 4);

  const queued = await pool.query<{
    turns: { role: string; content: string }[];
  }>(
    `SELECT turns FROM memory_queue WHERE user_id = $1 AND chat_id = $2
      ORDER BY queued_at`,
    [aliceId, chatId],
  );
  assert.equal(queued.rows.length, 2);
  assert.equal(queued.rows[0].turns.length, 2);
  assert.equal(queued.rows[0].turns[0].content, "First durable question");
  assert.equal(queued.rows[1].turns.length, 2);
  assert.equal(queued.rows[1].turns[0].content, "A follow-up question");

  const renamed = await app.inject({
    method: "PATCH",
    url: `/ai/chats/${chatId}`,
    headers: headers(alice),
    payload: { title: "Durable planning", pinned: true },
  });
  assert.equal(renamed.statusCode, 200, renamed.body);
  assert.equal(renamed.json().title, "Durable planning");
  assert.equal(renamed.json().pinned, true);
  const search = await app.inject({
    url: "/ai/chats?search=follow-up",
    headers: headers(alice),
  });
  assert.equal(search.statusCode, 200, search.body);
  assert.equal(search.json()[0].id, chatId);

  const note = await app.inject({
    method: "POST",
    url: `/ai/chats/${chatId}/save-note`,
    headers: headers(alice),
  });
  assert.equal(note.statusCode, 200, note.body);
  const noteRow = await pool.query<{ kind: string }>(
    "SELECT kind FROM docs WHERE id = $1",
    [note.json().id],
  );
  assert.equal(noteRow.rows[0].kind, "agent");

  const deleted = await app.inject({
    method: "DELETE",
    url: `/ai/chats/${chatId}`,
    headers: headers(alice),
  });
  assert.equal(deleted.statusCode, 204);
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM memory_queue WHERE user_id = $1 AND chat_id = $2",
        [aliceId, chatId],
      )
    ).rowCount,
    0,
  );
});

test("migration 165 copies legacy project chats and is safe to repeat", async () => {
  const db = await pool.connect();
  const projectId = randomUUID();
  const chatId = randomUUID();
  const createdAt = new Date("2026-09-20T10:00:00.000Z");
  const updatedAt = new Date("2026-09-21T10:00:00.000Z");
  try {
    await db.query("BEGIN");
    await db.query(
      "INSERT INTO projects (id, user_id, name) VALUES ($1, $2, 'Legacy chat project')",
      [projectId, aliceId],
    );
    await db.query(
      `INSERT INTO project_chats
        (id, user_id, project_id, title, turns, created_at, updated_at)
       VALUES ($1, $2, $3, 'Legacy planning', $4::jsonb, $5, $6)`,
      [
        chatId,
        aliceId,
        projectId,
        JSON.stringify([{ role: "user", text: "Plan my week" }]),
        createdAt,
        updatedAt,
      ],
    );
    const migration = await readFile(
      new URL("../migrations/165_ai_chats.sql", import.meta.url),
      "utf8",
    );
    await db.query(migration);
    await db.query(migration);
    const copied = await db.query<{
      title: string;
      turns: { role: string; text: string }[];
      project_id: string;
      scope_kind: string;
      scope_id: string;
      created_at: Date;
      last_used_at: Date;
    }>(
      `SELECT title, turns, project_id, scope_kind, scope_id, created_at, last_used_at
         FROM ai_chats WHERE id = $1`,
      [chatId],
    );
    assert.deepEqual(copied.rows[0], {
      title: "Legacy planning",
      turns: [{ role: "user", text: "Plan my week" }],
      project_id: projectId,
      scope_kind: "project",
      scope_id: projectId,
      created_at: createdAt,
      last_used_at: updatedAt,
    });
    await db.query("ROLLBACK");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
});

test("chat history sorts pinned first, then by most recently used", async () => {
  const pinnedOld = randomUUID();
  const pinnedNew = randomUUID();
  const unpinnedOld = randomUUID();
  const unpinnedNew = randomUUID();
  try {
    await pool.query(
      `INSERT INTO ai_chats (id, user_id, title, pinned, last_used_at)
       VALUES
         ($1, $5, 'Pinned old', true, now() - interval '2 days'),
         ($2, $5, 'Pinned new', true, now() - interval '1 day'),
         ($3, $5, 'Unpinned old', false, now() - interval '3 days'),
         ($4, $5, 'Unpinned new', false, now() - interval '1 hour')`,
      [pinnedOld, pinnedNew, unpinnedOld, unpinnedNew, aliceId],
    );
    const listed = await app.inject({
      url: "/ai/chats?limit=100",
      headers: headers(alice),
    });
    assert.equal(listed.statusCode, 200, listed.body);
    const ids = (listed.json() as { id: string }[])
      .map((row) => row.id)
      .filter((id) =>
        [pinnedOld, pinnedNew, unpinnedOld, unpinnedNew].includes(id),
      );
    assert.deepEqual(ids, [pinnedNew, pinnedOld, unpinnedNew, unpinnedOld]);
  } finally {
    await pool.query("DELETE FROM ai_chats WHERE id = ANY($1::uuid[])", [
      [pinnedOld, pinnedNew, unpinnedOld, unpinnedNew],
    ]);
  }
});

test("provider failures finish the persisted assistant job as failed", async () => {
  providerStatus = 500;
  const started = await app.inject({
    method: "POST",
    url: "/ai/chat/start",
    headers: headers(alice),
    payload: { message: "Summarize today", timezone: "UTC" },
  });
  assert.equal(started.statusCode, 202, started.body);
  const failed = await pollAssistant(alice, started.json().id);
  assert.equal(failed.state, "failed", JSON.stringify(failed));
  providerStatus = 200;
});
test("reminder scheduling is durable, deduplicated, and honors completed items", async () => {
  const due = new Date(Date.now() + 60000).toISOString();
  const i = (
    await app.inject({
      method: "POST",
      url: "/items",
      headers: headers(alice),
      payload: { ...payload("Reminder"), due_at: due },
    })
  ).json();
  await Promise.all([enqueue(), enqueue()]);
  const n = await pool.query(
    "SELECT * FROM notifications WHERE item_id=$1 AND channel='inapp'",
    [i.id],
  );
  assert.equal(n.rowCount, 1);
  const noticeId = n.rows[0].id;
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/notifications/${noticeId}/read`,
        headers: headers(bob),
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/notifications/${noticeId}/read`,
        headers: headers(alice),
      })
    ).statusCode,
    204,
  );
  await app.inject({
    method: "PUT",
    url: `/items/${i.id}`,
    headers: headers(alice),
    payload: { ...clean(i), status: "done" },
  });
  await enqueue();
  assert.equal(
    (await pool.query("SELECT * FROM notifications WHERE item_id=$1", [i.id]))
      .rowCount,
    1,
  );
});
test("device registration cannot be stolen and logout revokes the session", async () => {
  const token = `ExpoPushToken[${randomUUID()}]`;
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/devices",
        headers: headers(alice),
        payload: { token },
      })
    ).statusCode,
    204,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/devices",
        headers: headers(bob),
        payload: { token },
      })
    ).statusCode,
    409,
  );
  await app.inject({
    method: "DELETE",
    url: "/devices",
    headers: headers(alice),
    payload: { token },
  });
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/auth/logout",
        headers: headers(bob),
      })
    ).statusCode,
    204,
  );
  assert.equal(
    (await app.inject({ url: "/me", headers: headers(bob) })).statusCode,
    401,
  );
});

test("drafting a project returns a reviewable proposal, applied on request", async () => {
  providerResponse = {
    title: "Launch the newsletter",
    tasks: [
      {
        title: "Pick a platform",
        notes: "",
        estimate_minutes: 60,
        due_in_days: 1,
      },
      {
        title: "Write the first issue",
        notes: "300 words",
        estimate_minutes: 120,
        due_in_days: 3,
      },
      {
        title: "Invite subscribers",
        notes: "",
        estimate_minutes: 45,
        due_in_days: 5,
      },
    ],
  };
  const draft = await app.inject({
    method: "POST",
    url: "/ai/project",
    headers: headers(alice),
    payload: {
      prompt: "Start a weekly newsletter",
      timezone: "Australia/Melbourne",
    },
  });
  assert.equal(draft.statusCode, 200, draft.body);
  const proposal = draft.json();
  assert.match(proposal.summary, /Launch the newsletter/);
  assert.equal(proposal.actions.length, 3);
  assert.equal(proposal.actions[0].operation, "create");
  assert.ok(
    proposal.actions[0].data.due_at,
    "tasks get due dates from the offsets",
  );
  assert.equal(proposal.actions[1].data.estimate_minutes, 120);

  // Nothing is saved until the proposal is applied.
  const before = (
    await app.inject({ url: "/items", headers: headers(alice) })
  ).json().length;
  const applied = await app.inject({
    method: "POST",
    url: `/ai/proposals/${proposal.id}/apply`,
    headers: headers(alice),
  });
  assert.equal(applied.statusCode, 200, applied.body);
  const after = (
    await app.inject({ url: "/items", headers: headers(alice) })
  ).json();
  assert.equal(
    after.length,
    before + 3,
    "the three project tasks were created",
  );
  const parent = after.find(
    (i: { title: string }) => i.title === "Launch the newsletter",
  );
  assert.equal(
    parent,
    undefined,
    "no duplicate parent task is created outside the project",
  );
  const project = (
    await app.inject({ url: "/projects", headers: headers(alice) })
  )
    .json()
    .find((p: { name: string }) => p.name === "Launch the newsletter");
  assert.ok(project);
  const children = after.filter(
    (i: { project_id: string | null }) => i.project_id === project.id,
  );
  assert.deepEqual(
    children.map((c: { title: string }) => c.title).sort(),
    ["Invite subscribers", "Pick a platform", "Write the first issue"],
    "every task is filed in the project",
  );
  // The apply answers with the project it made, again on a retry.
  assert.equal(applied.json().project_id, project.id);
  const again = await app.inject({
    method: "POST",
    url: `/ai/proposals/${proposal.id}/apply`,
    headers: headers(alice),
  });
  assert.deepEqual(again.json(), { applied: true, project_id: project.id });
  // Its history names who made the project and its stages.
  const actors = (
    await pool.query<{ kind: string; actor_id: string | null }>(
      `SELECT kind, actor_id FROM project_activity
        WHERE project_id = $1 AND kind IN ('project_created', 'stage_added')`,
      [project.id],
    )
  ).rows;
  assert.ok(actors.length >= 2);
  assert.ok(actors.every((row) => row.actor_id === project.user_id));
});

test("an approved project persists its dependencies, its stages and its calendar blocks", async () => {
  providerResponse = {
    title: "Ship the redesign",
    tasks: [
      {
        id: "design",
        title: "Design the screens",
        notes: "",
        estimate_minutes: 90,
        due_in_days: 1,
        depends_on: [],
      },
      {
        id: "build",
        title: "Build the screens",
        notes: "",
        estimate_minutes: 90,
        due_in_days: 3,
        depends_on: ["design"],
      },
      {
        id: "ship",
        title: "Ship it",
        notes: "",
        estimate_minutes: 60,
        due_in_days: 5,
        depends_on: ["build"],
      },
    ],
  };
  const draft = await app.inject({
    method: "POST",
    url: "/ai/project",
    headers: headers(alice),
    payload: { prompt: "Redesign the app", timezone: "Australia/Melbourne" },
  });
  assert.equal(draft.statusCode, 200, draft.body);
  const proposal = draft.json();

  // The reviewable graph and its schedule come back before anything is stored.
  assert.equal(proposal.project.tasks.length, 3);
  assert.deepEqual(proposal.project.tasks[0].depends_on, []);
  assert.ok(proposal.project.blocks.length > 0, "a schedule was previewed");
  const edgesBefore = await pool.query(
    "SELECT count(*)::int AS n FROM item_dependencies",
  );
  const edgeCountBefore = edgesBefore.rows[0].n;

  const applied = await app.inject({
    method: "POST",
    url: `/ai/proposals/${proposal.id}/apply`,
    headers: headers(alice),
  });
  assert.equal(applied.statusCode, 200, applied.body);

  const project = (
    await pool.query<{ id: string; name: string; stages: number }>(
      `SELECT p.id, p.name, (SELECT count(*)::int FROM project_stages s WHERE s.project_id = p.id) AS stages
         FROM projects p WHERE p.name = $1 AND p.user_id = $2 ORDER BY p.created_at DESC LIMIT 1`,
      ["Ship the redesign", aliceId],
    )
  ).rows[0];
  assert.ok(project, "the project itself was created");
  assert.ok(project.stages > 0, "the project got its default stages");

  const rows = (
    await pool.query<{ item: string; prerequisite: string }>(
      `SELECT i.title AS item, p.title AS prerequisite
         FROM item_dependencies d
         JOIN items i ON i.id = d.item_id
         JOIN items p ON p.id = d.prerequisite_id
        WHERE i.project_id = $1
        ORDER BY i.title`,
      [project.id],
    )
  ).rows;
  assert.deepEqual(
    rows,
    [
      { item: "Build the screens", prerequisite: "Design the screens" },
      { item: "Ship it", prerequisite: "Build the screens" },
    ],
    "the graph the user reviewed is the graph that was stored",
  );

  // Scoped to THIS project's subtasks: the suite shares one database, so a
  // bare count would pick up every planner block any other test left behind.
  const blocks = (
    await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM time_blocks b JOIN items i ON i.id = b.item_id
        WHERE b.source = 'planner' AND i.project_id = $1`,
      [project.id],
    )
  ).rows[0].n;
  assert.equal(
    blocks,
    proposal.project.blocks.length,
    "every previewed session became a calendar block",
  );

  // Approving twice must not double-write.
  const again = await app.inject({
    method: "POST",
    url: `/ai/proposals/${proposal.id}/apply`,
    headers: headers(alice),
  });
  assert.equal(again.statusCode, 200);
  const edgesAfter = await pool.query(
    "SELECT count(*)::int AS n FROM item_dependencies",
  );
  assert.equal(
    edgesAfter.rows[0].n,
    edgeCountBefore + 2,
    "re-approval is idempotent",
  );
});
