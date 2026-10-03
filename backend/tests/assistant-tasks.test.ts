import { freshRateLimitSession } from "./rate-limit-session.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { MAX_AGENT_TASKS } from "@orbyn/core";
import "./setup.js";
import { startTestAssistantRuntime } from "./helpers/assistant-runtime.js";

/**
 * W3: handing a task to Orbyn. A fake provider stands in for the model, so
 * no real AI is ever called.
 */
type Request = { messages: { role: string; content: string | null }[] };
let respond: (request: Request) => Promise<string> | string = () =>
  "I drafted the outline and finished the task.";
const requests: Request[] = [];
const read = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
  });
const provider = createServer(async (req, res) => {
  const request = JSON.parse((await read(req)) || "{}") as Request;
  requests.push(request);
  const content = await respond(request);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content } }],
    }),
  );
});
await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
const providerUrl = `http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`;
process.env.SMTP_HOST = "";

const { buildApp } = await import("../src/app.js");
const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { cachedSettings } = await import("../src/lib/settings.js");
const { assistantPrincipal } =
  await import("../src/modules/agents/assistant.js");
const { scanAssistantTasks } = await import("../src/worker/assistant-tasks.js");

const app = await buildApp();
const users: string[] = [];
let stopBackground: (() => Promise<void>) | undefined;
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
let address = 0;
const nextAddress = () =>
  `10.97.${Math.floor(address / 250) % 250}.${(address++ % 250) + 1}`;
const HOUR = 3_600_000;

type Person = { id: string; token: string; grant: string };

async function register(): Promise<Person> {
  const response = await app.inject({
    method: "POST",
    url: "/auth/register",
    remoteAddress: nextAddress(),
    payload: {
      email: `assistant-tasks-${randomUUID()}@example.com`,
      password: "a-long-test-password",
      name: "Task tester",
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  const { token, user } = response.json();
  users.push(user.id);
  const principal = await assistantPrincipal({
    id: user.id,
    name: "Task tester",
    role: "member",
  });
  return { id: user.id, token, grant: principal.grant_id! };
}

const inject = (
  who: Person | null,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
) =>
  app.inject({
    method,
    url,
    remoteAddress: nextAddress(),
    headers: who ? auth(who.token) : {},
    ...(payload === undefined ? {} : { payload: payload as never }),
  });

async function task(who: Person, title: string, extra = {}) {
  const made = await inject(who, "POST", "/items", {
    title,
    kind: "task",
    ...extra,
  });
  assert.equal(made.statusCode, 201, made.body);
  return made.json().id as string;
}

const itemRow = async (id: string) =>
  (
    await pool.query<{
      agent_grant_id: string | null;
      agent_state: string | null;
      agent_job_id: string | null;
      agent_result: string | null;
      agent_attempts: number;
      assignee_id: string | null;
    }>(
      `SELECT agent_grant_id, agent_state, agent_job_id, agent_result,
              agent_attempts, assignee_id FROM items WHERE id = $1`,
      [id],
    )
  ).rows[0];

async function waitFor<T>(
  check: () => Promise<T | null | undefined | false>,
  what: string,
) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`Timed out waiting for ${what}`);
}

/** Queues a job row the way the engine does, without any model call. */
type Start = NonNullable<
  NonNullable<Parameters<typeof scanAssistantTasks>[1]>["startAutomation"]
>;
const fakeStart =
  (calls: Parameters<Start>[0][]): Start =>
  async (input) => {
    calls.push(input);
    return transaction(async (db) => {
      const id = (
        await db.query<{ id: string }>(
          "INSERT INTO ai_jobs (user_id) VALUES ($1) RETURNING id",
          [input.userId],
        )
      ).rows[0].id;
      await input.onQueued?.(db, id);
      return id;
    });
  };

before(async () => {
  await migrate();
  const providerId = (
    await pool.query(
      "INSERT INTO ai_providers(kind, name, base_url) VALUES ('openai-compatible', 'Assistant task test', $1) RETURNING id",
      [providerUrl],
    )
  ).rows[0].id;
  await pool.query(
    "UPDATE ai_settings SET provider_id=$1, model='assistant-task-test' WHERE id",
    [providerId],
  );
  stopBackground = await startTestAssistantRuntime("background");
});

after(async () => {
  await stopBackground?.();
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [users]);
  await pool.query(
    "UPDATE ai_settings SET provider_id=NULL, model='' WHERE id",
  );
  await pool.query(
    "DELETE FROM ai_providers WHERE name = 'Assistant task test'",
  );
  await app.close();
  await pool.end();
  provider.close();
});

test("handing a task over needs sign-in, access, a task and a fair rate", async () => {
  const me = await register();
  const other = await register();
  const id = await task(me, "Guarded task");
  assert.equal(
    (await inject(null, "POST", `/items/${id}/agent`)).statusCode,
    401,
  );
  assert.equal(
    (await inject(null, "DELETE", `/items/${id}/agent`)).statusCode,
    401,
  );
  assert.equal((await inject(null, "GET", "/me/agent-work")).statusCode, 401);
  const stranger = await inject(other, "POST", `/items/${id}/agent`);
  assert.equal(stranger.statusCode, 404, stranger.body);
  const bad = await inject(me, "POST", "/items/not-an-id/agent");
  assert.equal(bad.statusCode, 422, bad.body);
  const event = await task(me, "An event", {
    kind: "event",
    due_at: new Date(Date.now() + HOUR).toISOString(),
  });
  const refused = await inject(me, "POST", `/items/${event}/agent`);
  assert.equal(refused.statusCode, 422, refused.body);
  assert.match(refused.json().message, /Only tasks can be handed to Orbyn/);

  const settings = cachedSettings();
  const previous = settings.rate_limit_per_minute;
  const limitedToken = await freshRateLimitSession(me.token);
  settings.rate_limit_per_minute = 1;
  try {
    const once = () =>
      app.inject({
        url: "/me/agent-work",
        remoteAddress: "10.254.7.7",
        headers: auth(limitedToken),
      });
    assert.equal((await once()).statusCode, 200);
    assert.equal((await once()).statusCode, 429);
  } finally {
    settings.rate_limit_per_minute = previous;
  }
});

test("a handed task is run by Orbyn, finished, noted and given back", async () => {
  requests.length = 0;
  respond = () => "I drafted the outline and finished the task.";
  const me = await register();
  await pool.query(
    "INSERT INTO agent_settings (user_id, name) VALUES ($1, 'Muse')",
    [me.id],
  );
  const id = await task(me, "Outline the essay", {
    notes: "Three parts: claim, evidence, rebuttal.",
  });
  const step = await inject(me, "POST", `/items/${id}/steps`, {
    title: "Find two sources",
  });
  assert.equal(step.statusCode, 201, step.body);

  const handed = await inject(me, "POST", `/items/${id}/agent`);
  assert.equal(handed.statusCode, 200, handed.body);
  assert.equal(handed.json().agent_state, "queued");
  assert.equal(handed.json().agent_grant_id, me.grant);
  // Handing it again changes nothing.
  assert.equal(
    (await inject(me, "POST", `/items/${id}/agent`)).statusCode,
    200,
  );

  assert.equal(await scanAssistantTasks(new Date(), { only: [me.id] }), 1);
  const running = await itemRow(id);
  assert.ok(running.agent_job_id);
  assert.equal(running.agent_attempts, 1);
  const done = await waitFor(async () => {
    const row = await itemRow(id);
    return row.agent_state === "done" ? row : null;
  }, "the task run to finish");
  assert.equal(done.agent_grant_id, null, "the task comes back to the person");
  assert.equal(
    done.agent_result,
    "I drafted the outline and finished the task.",
  );
  assert.equal(done.assignee_id, null, "the assignee is unchanged");

  const note = (
    await pool.query<{ body: string; via_grant_id: string; user_id: string }>(
      "SELECT body, via_grant_id, user_id FROM item_updates WHERE item_id = $1",
      [id],
    )
  ).rows;
  assert.equal(note.length, 1);
  assert.match(note[0].body, /drafted the outline/);
  assert.equal(note[0].via_grant_id, me.grant, "the note is via the agent");

  const chat = (
    await pool.query<{ title: string; origin: string }>(
      "SELECT title, origin FROM ai_chats WHERE user_id = $1",
      [me.id],
    )
  ).rows[0];
  assert.deepEqual(chat, { title: "Task: Outline the essay", origin: "task" });
  const asked = requests
    .flatMap((r) => r.messages)
    .map((m) => m.content ?? "")
    .join("\n");
  assert.match(asked, /Outline the essay/);
  assert.match(asked, /claim, evidence, rebuttal/);
  assert.match(asked, /\[ \] Find two sources/);
  // Finished: the next scan has nothing to start.
  assert.equal(await scanAssistantTasks(new Date(), { only: [me.id] }), 0);

  const shown = await inject(me, "GET", `/items/${id}`);
  assert.equal(shown.statusCode, 200);
  assert.equal(shown.json().agent_state, "done");
});

test("a sixth task at once is refused with a clear message", async () => {
  const me = await register();
  for (let n = 0; n < MAX_AGENT_TASKS; n++) {
    const id = await task(me, `Handed ${n}`);
    const handed = await inject(me, "POST", `/items/${id}/agent`);
    assert.equal(handed.statusCode, 200, handed.body);
  }
  const sixth = await task(me, "One too many");
  const refused = await inject(me, "POST", `/items/${sixth}/agent`);
  assert.equal(refused.statusCode, 409, refused.body);
  assert.equal(
    refused.json().message,
    "Orbyn already has 5 tasks. Take one back or wait for one to finish.",
  );
  assert.equal((await itemRow(sixth)).agent_grant_id, null);
});

test("kept-out projects and a paused assistant can't take tasks", async () => {
  const me = await register();
  const project = await inject(me, "POST", "/projects", { name: "Private" });
  assert.equal(project.statusCode, 201, project.body);
  await pool.query("UPDATE projects SET assistant_off = true WHERE id = $1", [
    project.json().id,
  ]);
  const hidden = await task(me, "Secret task", {
    project_id: project.json().id,
  });
  const refused = await inject(me, "POST", `/items/${hidden}/agent`);
  assert.equal(refused.statusCode, 409, refused.body);
  assert.match(refused.json().message, /Private is kept out of Orbyn/);

  const open = await task(me, "Open task");
  await pool.query(
    "UPDATE agent_grants SET suspended_at = now() WHERE id = $1",
    [me.grant],
  );
  const paused = await inject(me, "POST", `/items/${open}/agent`);
  assert.equal(paused.statusCode, 409, paused.body);
  assert.match(paused.json().message, /paused in Connected agents/);
  assert.equal((await itemRow(open)).agent_grant_id, null);
});

test("taking a task back clears it and stops the run", async () => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  respond = async () => {
    await held;
    return "Finished too late.";
  };
  const me = await register();
  const id = await task(me, "Take me back");
  assert.equal(
    (await inject(me, "POST", `/items/${id}/agent`)).statusCode,
    200,
  );
  assert.equal(await scanAssistantTasks(new Date(), { only: [me.id] }), 1);
  const jobId = (await itemRow(id)).agent_job_id!;
  await waitFor(async () => {
    const job = (
      await pool.query<{ state: string }>(
        "SELECT state FROM ai_jobs WHERE id = $1",
        [jobId],
      )
    ).rows[0];
    return job?.state === "running";
  }, "the run to start");

  const back = await inject(me, "DELETE", `/items/${id}/agent`);
  assert.equal(back.statusCode, 200, back.body);
  assert.equal(back.json().agent_grant_id, null);
  assert.equal(back.json().agent_state, null);
  const cancelled = (
    await pool.query<{ cancel_requested: boolean }>(
      "SELECT cancel_requested FROM ai_jobs WHERE id = $1",
      [jobId],
    )
  ).rows[0];
  assert.equal(cancelled.cancel_requested, true, "the run was told to stop");
  release();
  await waitFor(async () => {
    const job = (
      await pool.query<{ state: string }>(
        "SELECT state FROM ai_jobs WHERE id = $1",
        [jobId],
      )
    ).rows[0];
    return job?.state === "done" || job?.state === "failed";
  }, "the stopped run to end");
  const after = await itemRow(id);
  assert.equal(after.agent_state, null, "a stopped run never marks it done");
  assert.equal(
    (await pool.query("SELECT 1 FROM item_updates WHERE item_id = $1", [id]))
      .rowCount,
    0,
  );
  respond = () => "I drafted the outline and finished the task.";
});

test("the worker waits without a provider, backs off and gives up in the end", async () => {
  const me = await register();
  const id = await task(me, "Retry me");
  assert.equal(
    (await inject(me, "POST", `/items/${id}/agent`)).statusCode,
    200,
  );
  const calls: Parameters<Start>[0][] = [];
  const options = { only: [me.id], startAutomation: fakeStart(calls) };

  // No provider: nothing is claimed and no chat opens.
  assert.equal(
    await scanAssistantTasks(new Date(), { ...options, ai: null }),
    0,
  );
  assert.equal(calls.length, 0);
  assert.equal((await itemRow(id)).agent_attempts, 0);

  const now = new Date();
  assert.equal(await scanAssistantTasks(now, options), 1);
  assert.equal(calls[0].title, "Task: Retry me");
  assert.deepEqual(calls[0].automation, { kind: "task", id });
  const first = await itemRow(id);
  assert.equal(first.agent_state, "working");
  // The run failed: it waits a few hours before one more try.
  await pool.query("UPDATE ai_jobs SET state = 'failed' WHERE id = $1", [
    first.agent_job_id,
  ]);
  assert.equal(await scanAssistantTasks(now, options), 0);
  const later = new Date(now.getTime() + 7 * HOUR);
  assert.equal(await scanAssistantTasks(later, options), 1);
  assert.equal((await itemRow(id)).agent_attempts, 2);

  // Every try used up: it comes back to the person saying so.
  await pool.query("UPDATE items SET agent_attempts = 3 WHERE id = $1", [id]);
  await pool.query("UPDATE ai_jobs SET state = 'failed' WHERE id = $1", [
    (await itemRow(id)).agent_job_id,
  ]);
  assert.equal(
    await scanAssistantTasks(new Date(later.getTime() + 7 * HOUR), options),
    0,
  );
  const gave = await itemRow(id);
  assert.equal(gave.agent_grant_id, null);
  assert.equal(gave.agent_state, "needs_you");
  assert.match(gave.agent_result ?? "", /couldn't be finished/);

  // Taken back before its run queued: no run starts.
  const other = await task(me, "Taken back early");
  assert.equal(
    (await inject(me, "POST", `/items/${other}/agent`)).statusCode,
    200,
  );
  const racing: Start = async (input) => {
    await pool.query(
      "UPDATE items SET agent_grant_id = NULL, agent_state = NULL WHERE id = $1",
      [other],
    );
    return fakeStart([])(input);
  };
  assert.equal(
    await scanAssistantTasks(new Date(), {
      only: [me.id],
      startAutomation: racing,
    }),
    0,
  );
  assert.equal((await itemRow(other)).agent_job_id, null);
});

test("connected agents' recent work names their board lanes", async () => {
  const me = await register();
  const id = await task(me, "Claude touched this");
  const grant = (
    await pool.query<{ id: string }>(
      `INSERT INTO agent_grants (user_id, kind, name, client_name, access, personal)
       VALUES ($1, 'key', 'Claude', 'Claude', 'write', true) RETURNING id`,
      [me.id],
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO agent_activity (user_id, grant_id, client_name, tool, tier, target_ids, outcome)
     VALUES ($1, $2, 'Claude', 'update_tasks', 'W2', $3, 'ok'),
            ($1, $2, 'Claude', 'update_tasks', 'W2', $4, 'ok')`,
    [me.id, grant, [`task:${id}`], [`task:${randomUUID()}`]],
  );
  // Your own assistant's work is its own lane, never a connected agent's.
  await pool.query(
    `INSERT INTO agent_activity (user_id, grant_id, tool, tier, target_ids, outcome)
     VALUES ($1, $2, 'update_tasks', 'W2', $3, 'ok')`,
    [me.id, me.grant, [`task:${id}`]],
  );
  const work = await inject(me, "GET", "/me/agent-work");
  assert.equal(work.statusCode, 200, work.body);
  assert.deepEqual(work.json(), [
    { grant_id: grant, name: "Claude", item_ids: [id] },
  ]);
  const other = await register();
  const none = await inject(other, "GET", "/me/agent-work");
  assert.deepEqual(none.json(), [], "nobody else sees them");
});

test("Tonight tasks stay out of the daytime queue and can be moved back to Now", async () => {
  const me = await register();
  const id = await task(me, "Work on this tonight");
  const disabled = await inject(me, "POST", `/items/${id}/agent`, {
    when: "tonight",
  });
  assert.equal(disabled.statusCode, 409);
  assert.match(disabled.body, /Enable Night shift/);
  await pool.query(
    "INSERT INTO agent_settings(user_id,night_shift) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET night_shift=EXCLUDED.night_shift",
    [me.id, JSON.stringify({ enabled: true, kinds: { handed: true } })],
  );
  const handed = await inject(me, "POST", `/items/${id}/agent`, {
    when: "tonight",
  });
  assert.equal(handed.statusCode, 200, handed.body);
  assert.equal(handed.json().agent_when, "tonight");
  const calls: Parameters<Start>[0][] = [];
  const options = { only: [me.id], startAutomation: fakeStart(calls) };
  assert.equal(await scanAssistantTasks(new Date(), options), 0);
  assert.equal(calls.length, 0);
  assert.equal((await itemRow(id)).agent_attempts, 0);
  const now = await inject(me, "POST", `/items/${id}/agent`, { when: "now" });
  assert.equal(now.statusCode, 200, now.body);
  assert.equal(now.json().agent_when, "now");
  assert.equal(await scanAssistantTasks(new Date(), options), 1);
  assert.equal(calls.length, 1);
  const busy = await inject(me, "POST", `/items/${id}/agent`, {
    when: "tonight",
  });
  assert.equal(busy.statusCode, 409, busy.body);
  const invalid = await inject(me, "POST", `/items/${id}/agent`, {
    when: "tomorrow",
  });
  assert.equal(invalid.statusCode, 422, invalid.body);
});
