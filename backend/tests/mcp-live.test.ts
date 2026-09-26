import { test, before, after, mock } from "node:test";
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
 * A6: live updates and long jobs for outside agents.
 *
 * - subscriptions/listen: the acknowledgement (only what the connection can
 *   read), resource and list notes as things change, keep-alives, the
 *   "complete" close at the time limit and when access changes, and the
 *   refusals (401, 403 origin, 503 switched off, 400 version and header,
 *   -32602 filter, 429 too many streams). The realtime service serves it;
 *   the dedicated mcp service points there.
 * - The Tasks extension: a large plan and an import as tasks for a client
 *   that declares it (and the plain answer for one that doesn't),
 *   tasks/get, tasks/cancel and tasks/update, never across connections,
 *   and notifications/tasks on a listen stream.
 * - Progress notifications on a call's own stream, in both eras.
 */

process.env.FILES_SECRET ??= "test-files-secret-0123456789abcdef";

const { buildApp, buildMcpService, buildRealtimeService } =
  await import("../src/app.js");
const { pool, readPool } = await import("../src/db/pool.js");
const { announceDocChange } = await import("../src/modules/docs/live.js");
const { migrate } = await import("../src/db/migrate.js");
const { invalidateSettings } = await import("../src/lib/settings.js");
const { limiter, strikes } =
  await import("../src/modules/mcp-server/routes.js");
const { LISTEN, listenCount, notesFor } =
  await import("../src/modules/mcp-server/listen.js");
const { taskKind, declaresTasks } =
  await import("../src/modules/mcp-server/tasks.js");
const { SWEEP_RULES } = await import("../src/lib/sweep.js");
const { env } = await import("../src/config/env.js");

const app = await buildApp();
const h = helpers(app);
const network = await trapNetwork();

let olga: Person;
let otto: Person;
let admin: Person;
let key = "";
let grant = "";
let otherKey = "";
let crew = "";

before(async () => {
  await migrate();
  olga = await h.register("mcp-live-olga", "Olga");
  otto = await h.register("mcp-live-otto", "Otto");
  admin = await h.register("mcp-live-admin", "Ada");
  await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [admin.id]);
  crew = await h.team(olga, "Live crew");
  const made = await h.agentKey(olga, {
    access: "write",
    toolsets: ["core", "files", "study"],
  });
  key = made.key;
  grant = made.id;
  otherKey = (await h.agentKey(otto, { access: "write", toolsets: ["core"] }))
    .key;
});
after(async () => {
  network.restore();
  await app.close();
  await pool.end();
});

const fresh = () => {
  limiter.reset();
  strikes.reset();
};

/** The events in an SSE body, as parsed JSON-RPC messages. */
const events = (body: string) =>
  body
    .split("\n\n")
    .map((frame) =>
      frame
        .split("\n")
        .filter((l) => l.startsWith("data: "))
        .map((l) => l.slice(6))
        .join("\n"),
    )
    .filter(Boolean)
    .map((d) => JSON.parse(d));

const listenBody = (notifications: Record<string, unknown>, id = 41) => ({
  jsonrpc: "2.0",
  id,
  method: "subscriptions/listen",
  params: {
    notifications,
    _meta: {
      [META_KEYS.version]: MODERN,
      [META_KEYS.client]: { name: "test", version: "1" },
      [META_KEYS.caps]: {},
    },
  },
});
const listenHeaders = (token: string, extra: Record<string, string> = {}) => ({
  "content-type": "application/json",
  ...bearer(token),
  "mcp-protocol-version": MODERN,
  "mcp-method": "subscriptions/listen",
  ...extra,
});

/** Opens a listen stream on `on` that closes after `ms`, doing `during` meanwhile. */
async function listen(
  token: string,
  notifications: Record<string, unknown>,
  during: () => Promise<void> = async () => {},
  ms = 1_500,
  on = app,
) {
  const was = LISTEN.maxMs;
  LISTEN.maxMs = ms;
  fresh();
  try {
    const pending = on.inject({
      method: "POST",
      url: "/mcp",
      headers: listenHeaders(token),
      payload: JSON.stringify(listenBody(notifications)),
    });
    // Let the stream open before anything changes.
    await new Promise((r) => setTimeout(r, 150));
    await during();
    const r = await pending;
    return {
      status: r.statusCode,
      headers: r.headers,
      body: r.body,
      events: String(r.headers["content-type"]).includes("event-stream")
        ? events(r.body)
        : [],
    };
  } finally {
    LISTEN.maxMs = was;
  }
}

const newDoc = async (who: Person, body: Record<string, unknown>) =>
  (await h.call(who.token, "POST", "/docs", body)).json() as {
    id: string;
    version: number;
  };

test("listen: acknowledged with only what the connection can read, then told what changed", async () => {
  const mine = await newDoc(olga, { title: "Live notes" });
  const ottos = await newDoc(otto, { title: "Otto's private notes" });
  const s = await listen(
    key,
    {
      resourcesListChanged: true,
      toolsListChanged: true,
      resourceSubscriptions: [
        `orbyn://doc/${mine.id}`,
        `orbyn://doc/${ottos.id}`,
        "orbyn://today",
        "orbyn://nonsense",
      ],
    },
    async () => {
      const page = (await h.call(olga.token, "GET", `/docs/${mine.id}`)).json();
      const saved = await h.call(olga.token, "PUT", `/docs/${mine.id}`, {
        version: page.version,
        content: [{ type: "paragraph", text: "changed while listening" }],
      });
      assert.equal(saved.statusCode, 200, saved.body);
      // Otto's page changing tells Olga's agent nothing.
      const other = (
        await h.call(otto.token, "GET", `/docs/${ottos.id}`)
      ).json();
      await h.call(otto.token, "PUT", `/docs/${ottos.id}`, {
        version: other.version,
        content: [{ type: "paragraph", text: "private" }],
      });
      // A new page changes the list of recent things.
      await newDoc(olga, { title: "Another page" });
      // A new task moves Today.
      await h.call(olga.token, "POST", "/items", {
        kind: "task",
        title: "Live task",
      });
      await new Promise((r) => setTimeout(r, 800));
    },
  );
  assert.equal(s.status, 200, s.body);
  assert.match(String(s.headers["content-type"]), /text\/event-stream/);
  assert.equal(s.headers["x-accel-buffering"], "no");
  const [ack, ...rest] = s.events;
  assert.equal(ack.method, "notifications/subscriptions/acknowledged");
  assert.equal(ack.params._meta["io.modelcontextprotocol/subscriptionId"], 41);
  assert.deepEqual(ack.params.notifications, {
    resourcesListChanged: true,
    resourceSubscriptions: [`orbyn://doc/${mine.id}`, "orbyn://today"],
  });
  const updated = rest
    .filter((e) => e.method === "notifications/resources/updated")
    .map((e) => e.params.uri);
  assert.ok(updated.includes(`orbyn://doc/${mine.id}`), JSON.stringify(rest));
  assert.ok(updated.includes("orbyn://today"), JSON.stringify(rest));
  assert.ok(!updated.includes(`orbyn://doc/${ottos.id}`));
  // Gathered: one note per resource however many changes.
  assert.equal(new Set(updated).size, updated.length);
  assert.ok(
    rest.some((e) => e.method === "notifications/resources/list_changed"),
  );
  // Every note carries the subscription id; the stream ends "complete".
  for (const e of rest.filter((x) => x.method))
    assert.equal(e.params._meta["io.modelcontextprotocol/subscriptionId"], 41);
  const last = rest.at(-1);
  assert.equal(last.id, 41);
  assert.equal(last.result.resultType, "complete");
  assert.equal(
    last.result._meta["io.modelcontextprotocol/serverInfo"].name,
    "orbyn",
  );
  assert.equal(listenCount(), 0);
});

test("listen: a followed task and record are told of when changed over REST and through a tool", async () => {
  const made = await h.agentKey(olga, {
    access: "write",
    toolsets: ["core", "followthrough"],
  });
  const task = (
    await h.call(olga.token, "POST", "/items", {
      kind: "task",
      title: "Followed task",
    })
  ).json() as { id: string; version: number };
  const other = (
    await h.call(olga.token, "POST", "/items", {
      kind: "task",
      title: "Not followed",
    })
  ).json() as { id: string };
  const rec = (
    await h.call(olga.token, "POST", "/work-records", {
      kind: "decision",
      title: "Followed decision",
    })
  ).json() as { id: string; version: number };
  const follow = {
    resourceSubscriptions: [
      `orbyn://task/${task.id}`,
      `orbyn://record/${rec.id}`,
    ],
  };
  const told = (s: Awaited<ReturnType<typeof listen>>) =>
    s.events
      .filter((e) => e.method === "notifications/resources/updated")
      .map((e) => e.params.uri as string);
  const itemVersion = async (id: string) =>
    (await pool.query("SELECT version FROM items WHERE id = $1", [id])).rows[0]
      .version as number;
  const recordVersion = async (id: string) =>
    (await pool.query("SELECT version FROM work_records WHERE id = $1", [id]))
      .rows[0].version as number;

  // Over REST.
  const rest = await listen(made.key, follow, async () => {
    const r = await h.call(olga.token, "PUT", `/items/${task.id}`, {
      kind: "task",
      title: "Followed task, renamed",
      version: await itemVersion(task.id),
    });
    assert.equal(r.statusCode, 200, r.body);
    const saved = await h.call(olga.token, "PUT", `/work-records/${rec.id}`, {
      version: await recordVersion(rec.id),
      title: "Followed decision, renamed",
    });
    assert.equal(saved.statusCode, 200, saved.body);
    await new Promise((r) => setTimeout(r, 800));
  });
  assert.deepEqual(rest.events[0].params.notifications, follow);
  assert.ok(told(rest).includes(`orbyn://task/${task.id}`), rest.body);
  assert.ok(told(rest).includes(`orbyn://record/${rec.id}`), rest.body);

  // Through the agent's own tools, and a progress note alone.
  const tools = await listen(made.key, follow, async () => {
    const t = await h.tool(made.key, "update_tasks", {
      changes: [
        {
          id: `task:${task.id}`,
          version: await itemVersion(task.id),
          title: "Followed task, by the agent",
        },
      ],
    });
    assert.equal(t?.structuredContent?.status, "done", JSON.stringify(t));
    const r = await h.tool(made.key, "save_record", {
      record: `record:${rec.id}`,
      version: await recordVersion(rec.id),
      title: "Followed decision, by the agent",
    });
    assert.equal(r?.structuredContent?.status, "done", JSON.stringify(r));
    await new Promise((r) => setTimeout(r, 800));
  });
  assert.ok(told(tools).includes(`orbyn://task/${task.id}`), tools.body);
  assert.ok(told(tools).includes(`orbyn://record/${rec.id}`), tools.body);

  const note = await listen(made.key, follow, async () => {
    const r = await h.call(olga.token, "POST", `/items/${task.id}/updates`, {
      body: "Halfway there",
    });
    assert.ok(r.statusCode < 300, r.body);
    // Another task changing isn't this one.
    await h.call(olga.token, "PUT", `/items/${other.id}`, {
      kind: "task",
      title: "Still not followed",
      version: await itemVersion(other.id),
    });
    await new Promise((r) => setTimeout(r, 800));
  });
  assert.deepEqual(told(note), [`orbyn://task/${task.id}`]);
});

test("listen: a followed page that can no longer be read is dropped, not told of", async () => {
  const doc = await newDoc(olga, { title: "Soon not mine" });
  const saves = async (who: Person) => {
    const page = (await h.call(who.token, "GET", `/docs/${doc.id}`)).json();
    const r = await h.call(who.token, "PUT", `/docs/${doc.id}`, {
      version: page.version,
      content: [{ type: "paragraph", text: `saved at ${Date.now()}` }],
    });
    assert.equal(r.statusCode, 200, r.body);
  };
  const s = await listen(
    key,
    { resourceSubscriptions: [`orbyn://doc/${doc.id}`] },
    async () => {
      await saves(olga);
      await new Promise((r) => setTimeout(r, 800));
      // It becomes someone else's own page.
      await pool.query(
        "UPDATE docs SET user_id = $2, team_id = NULL WHERE id = $1",
        [doc.id, otto.id],
      );
      await saves(otto);
      await new Promise((r) => setTimeout(r, 800));
      await saves(otto);
      await new Promise((r) => setTimeout(r, 800));
    },
    4_000,
  );
  const updated = s.events.filter(
    (e) => e.method === "notifications/resources/updated",
  );
  assert.equal(updated.length, 1, s.body);
  assert.equal(updated[0].params.uri, `orbyn://doc/${doc.id}`);
});

test("listen: a followed page trashed, or task deleted, is told of once, then no more", async () => {
  const doc = await newDoc(olga, { title: "Soon in the Trash" });
  const task = (
    await h.call(olga.token, "POST", "/items", {
      kind: "task",
      title: "Soon deleted",
    })
  ).json() as { id: string };
  const docUri = `orbyn://doc/${doc.id}`;
  const taskUri = `orbyn://task/${task.id}`;
  const s = await listen(
    key,
    { resourceSubscriptions: [docUri, taskUri] },
    async () => {
      const trashed = await h.call(olga.token, "DELETE", `/docs/${doc.id}`);
      assert.ok(trashed.statusCode < 300, trashed.body);
      const version = (
        await pool.query("SELECT version FROM items WHERE id = $1", [task.id])
      ).rows[0].version as number;
      const gone = await h.call(
        olga.token,
        "DELETE",
        `/items/${task.id}?version=${version}`,
      );
      assert.ok(gone.statusCode < 300, gone.body);
      await new Promise((r) => setTimeout(r, 800));
      // Later news of either is no longer told.
      await announceDocChange(pool, doc.id, doc.version + 1, olga.id);
      await new Promise((r) => setTimeout(r, 800));
    },
    3_000,
  );
  const told = s.events
    .filter((e) => e.method === "notifications/resources/updated")
    .map((e) => e.params.uri as string);
  assert.equal(told.filter((u) => u === docUri).length, 1, s.body);
  assert.equal(told.filter((u) => u === taskUri).length, 1, s.body);
});

test("listen: a failed access re-check holds the note back, never drops what it follows", async () => {
  const doc = await newDoc(olga, { title: "Through a blip" });
  const uri = `orbyn://doc/${doc.id}`;
  // The next `failures` read-only transactions fail to begin.
  let failures = 0;
  const connect = readPool.connect.bind(readPool);
  const blip = mock.method(readPool, "connect", ((...args: unknown[]) => {
    // pool.query itself connects with a callback: left alone.
    if (typeof args[0] === "function" || failures === 0)
      return (connect as (...a: unknown[]) => unknown)(...args);
    return (connect() as Promise<any>).then((client) => {
      const query = client.query;
      client.query = (text: unknown, ...rest: unknown[]) => {
        client.query = query;
        if (text === "BEGIN READ ONLY" && failures > 0) {
          failures--;
          return Promise.reject(new Error("a replica blip"));
        }
        return query.call(client, text, ...rest);
      };
      return client;
    });
  }) as typeof readPool.connect);
  const was = { retryMs: LISTEN.retryMs, gatherMs: LISTEN.gatherMs };
  LISTEN.retryMs = 300;
  LISTEN.gatherMs = 100;
  try {
    // One blip: told late, and still followed afterwards.
    const s = await listen(
      key,
      { resourceSubscriptions: [uri] },
      async () => {
        failures = 1;
        await announceDocChange(pool, doc.id, doc.version + 1, olga.id);
        await new Promise((r) => setTimeout(r, 900));
        assert.equal(failures, 0);
        await announceDocChange(pool, doc.id, doc.version + 2, olga.id);
        await new Promise((r) => setTimeout(r, 600));
      },
      2_500,
    );
    const told = s.events.filter(
      (e) => e.method === "notifications/resources/updated",
    );
    assert.equal(told.length, 2, s.body);
    assert.ok(told.every((e) => e.params.uri === uri));

    // It keeps failing: the stream closes early, "complete", for a fresh start.
    const started = Date.now();
    const again = await listen(
      key,
      { resourceSubscriptions: [uri] },
      async () => {
        failures = 100;
        await announceDocChange(pool, doc.id, doc.version + 3, olga.id);
      },
      10_000,
    );
    failures = 0;
    assert.ok(Date.now() - started < 5_000, "closed before its time limit");
    assert.equal(
      again.events.filter((e) => e.method === "notifications/resources/updated")
        .length,
      0,
      again.body,
    );
    assert.equal(again.events.at(-1)?.result?.resultType, "complete");
  } finally {
    failures = 0;
    blip.mock.restore();
    Object.assign(LISTEN, was);
  }
});

test("listen: keep-alives, and a close at the credential's end", async () => {
  const was = LISTEN.keepAliveMs;
  LISTEN.keepAliveMs = 100;
  try {
    const s = await listen(key, { resourcesListChanged: true }, undefined, 450);
    assert.ok((s.body.match(/: keepalive/g) ?? []).length >= 2, s.body);
  } finally {
    LISTEN.keepAliveMs = was;
  }
  // A key that ends in half a second closes the stream then, long before
  // the 15 minutes.
  const soon = await h.agentKey(olga, { access: "read" });
  await pool.query(
    "UPDATE agent_grants SET expires_at = now() + interval '600 milliseconds' WHERE id = $1",
    [soon.id],
  );
  const started = Date.now();
  const s = await listen(soon.key, {}, undefined, 60_000);
  assert.ok(Date.now() - started < 5_000);
  assert.equal(s.events.at(-1).result.resultType, "complete");
});

test("listen: a revoked connection's stream closes at once", async () => {
  const made = await h.agentKey(olga, { access: "read" });
  const s = await listen(
    made.key,
    { resourcesListChanged: true },
    async () => {
      const r = await h.call(olga.token, "DELETE", `/me/agents/${made.id}`);
      assert.ok(r.statusCode < 300, r.body);
      await new Promise((r) => setTimeout(r, 300));
    },
    10_000,
  );
  assert.equal(s.events.at(-1).result.resultType, "complete");
  // Opening again is refused.
  const again = await listen(made.key, {}, undefined, 200);
  assert.equal(again.status, 401);
});

test("listen: refusals before any stream opens", async () => {
  fresh();
  const post = (headers: Record<string, string>, body: unknown) =>
    app.inject({
      method: "POST",
      url: "/mcp",
      headers,
      payload: JSON.stringify(body),
    });
  // No credential: 401 with the challenge.
  const noAuth = await post(
    { "content-type": "application/json", "mcp-protocol-version": MODERN },
    listenBody({}),
  );
  assert.equal(noAuth.statusCode, 401);
  assert.match(String(noAuth.headers["www-authenticate"]), /resource_metadata/);
  // A page not on the list.
  const origin = await post(
    listenHeaders(key, { origin: "https://evil.example" }),
    listenBody({}),
  );
  assert.equal(origin.statusCode, 403);
  // A 2025 revision: listen is 2026-07-28 only.
  const old = await post(
    listenHeaders(key, { "mcp-protocol-version": "2025-06-18" }),
    listenBody({}),
  );
  assert.equal(old.statusCode, 400);
  assert.equal(old.json().error.code, -32022);
  // The header naming another method.
  const mismatch = await post(
    listenHeaders(key, { "mcp-method": "tools/list" }),
    listenBody({}),
  );
  assert.equal(mismatch.statusCode, 400);
  assert.equal(mismatch.json().error.code, -32020);
  // No filter.
  const noFilter = await post(listenHeaders(key), {
    ...listenBody({}),
    params: {},
  });
  assert.equal(noFilter.json().error.code, -32602);
  // Agents switched off.
  const off = await h.call(admin.token, "PUT", "/admin/agents", {
    agents_enabled: false,
  });
  assert.equal(off.statusCode, 200, off.body);
  try {
    const r = await post(listenHeaders(key), listenBody({}));
    assert.equal(r.statusCode, 503);
  } finally {
    await h.call(admin.token, "PUT", "/admin/agents", { agents_enabled: true });
    invalidateSettings();
  }
});

test("listen: at most three streams per connection on a copy (429)", async () => {
  const was = LISTEN.perGrant;
  LISTEN.perGrant = 1;
  try {
    let second: Awaited<ReturnType<typeof app.inject>> | null = null;
    await listen(
      key,
      {},
      async () => {
        second = await app.inject({
          method: "POST",
          url: "/mcp",
          headers: listenHeaders(key),
          payload: JSON.stringify(listenBody({})),
        });
      },
      400,
    );
    assert.equal(second!.statusCode, 429);
    assert.ok(Number(second!.headers["retry-after"]) > 0);
    assert.equal(second!.json().error.code, -32029);
  } finally {
    LISTEN.perGrant = was;
  }
});

test("listen: served by the realtime service; the mcp service points there", async () => {
  const realtime = await buildRealtimeService();
  const mcp = await buildMcpService();
  try {
    const s = await listen(
      key,
      { resourcesListChanged: true },
      undefined,
      300,
      realtime,
    );
    assert.equal(s.status, 200, s.body);
    assert.equal(
      s.events[0].method,
      "notifications/subscriptions/acknowledged",
    );
    // Only listen is served there.
    const other = await realtime.inject({
      method: "POST",
      url: "/mcp",
      headers: { "content-type": "application/json", ...bearer(key) },
      payload: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(other.json().error.code, -32601);
    const unauth = await realtime.inject({
      method: "POST",
      url: "/mcp",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(listenBody({})),
    });
    assert.equal(unauth.statusCode, 401);
    fresh();
    const pointed = await mcp.inject({
      method: "POST",
      url: "/mcp",
      headers: listenHeaders(key),
      payload: JSON.stringify(listenBody({})),
    });
    assert.equal(pointed.statusCode, 200);
    assert.equal(pointed.json().error.code, -32601);
    assert.match(pointed.json().error.message, /realtime/);
  } finally {
    await realtime.close();
    await mcp.close();
  }
});

test("listen: what news means for a stream (personal space, teams, tasks)", () => {
  const filter = {
    resourcesListChanged: true as const,
    resourceSubscriptions: ["orbyn://today", "orbyn://doc/d1"],
    taskIds: ["t1"],
  };
  const doc = notesFor(
    {
      kind: "changed",
      area: "docs",
      user: "u",
      entity_type: "doc",
      entity_id: "d1",
    },
    filter,
    { personal: true },
  );
  assert.deepEqual(doc.updated, ["orbyn://doc/d1"]);
  assert.equal(doc.listChanged, true);
  // Without Personal, personal news is never told.
  const hidden = notesFor(
    { kind: "changed", user: "u", entity_type: "doc", entity_id: "d1" },
    filter,
    { personal: false },
  );
  assert.deepEqual(hidden, { updated: [], listChanged: false, tasks: [] });
  // A team's news is told either way.
  const team = notesFor(
    { kind: "changed", team: "t", entity_type: "doc", entity_id: "d1" },
    filter,
    { personal: false },
  );
  assert.deepEqual(team.updated.includes("orbyn://doc/d1"), true);
  // The planner's news moves Today.
  assert.deepEqual(
    notesFor({ kind: "changed", user: "u" }, filter, { personal: true })
      .updated,
    ["orbyn://today"],
  );
  // Only its own tasks.
  assert.deepEqual(
    notesFor({ kind: "agent_task", user: "u", entity_id: "t1" }, filter, {
      personal: true,
    }).tasks,
    ["t1"],
  );
  assert.deepEqual(
    notesFor({ kind: "agent_task", user: "u", entity_id: "t2" }, filter, {
      personal: true,
    }).tasks,
    [],
  );
  // Presence is never told.
  assert.deepEqual(
    notesFor({ kind: "presence", user: "u" }, filter, { personal: true })
      .updated,
    [],
  );
});

// ---------------------------------------------------------------- tasks ---

const TASK_CAPS = { extensions: { "io.modelcontextprotocol/tasks": {} } };

/** A 2026-07-28 call, optionally declaring the Tasks extension. */
const modernCall = async (
  token: string,
  method: string,
  params: Record<string, unknown>,
  declare = true,
  extra: Record<string, string> = {},
) => {
  fresh();
  const r = await app.inject({
    method: "POST",
    url: "/mcp",
    headers: {
      "content-type": "application/json",
      ...bearer(token),
      "mcp-protocol-version": MODERN,
      "mcp-method": method,
      ...(method === "tools/call" ? { "mcp-name": String(params.name) } : {}),
      ...extra,
    },
    payload: JSON.stringify({
      jsonrpc: "2.0",
      id: 9,
      method,
      params: {
        ...params,
        _meta: {
          ...((params._meta as object) ?? {}),
          [META_KEYS.version]: MODERN,
          [META_KEYS.client]: { name: "test", version: "1" },
          [META_KEYS.caps]: declare ? TASK_CAPS : {},
        },
      },
    }),
  });
  return {
    status: r.statusCode,
    headers: r.headers,
    raw: r.body,
    body: String(r.headers["content-type"]).includes("event-stream")
      ? null
      : r.json(),
  };
};

const waitForTask = async (token: string, taskId: string, until: string[]) => {
  for (let i = 0; i < 50; i++) {
    const r = await modernCall(token, "tasks/get", { taskId });
    if (until.includes(r.body.result?.status)) return r.body.result;
    await new Promise((res) => setTimeout(res, 100));
  }
  assert.fail(`task ${taskId} never reached ${until.join("/")}`);
};

test("tasks: which calls are long jobs, and what declares the extension", () => {
  assert.equal(taskKind("start_import", {}), "import");
  assert.equal(taskKind("plan_revision", {}), "plan");
  assert.equal(taskKind("plan_schedule", {}), null);
  assert.equal(taskKind("plan_schedule", { days: 14 }), "plan");
  assert.equal(
    taskKind("plan_schedule", { tasks: Array.from({ length: 30 }, () => "x") }),
    "plan",
  );
  assert.equal(taskKind("search", { query: "x" }), null);
  assert.equal(
    declaresTasks({
      _meta: { "io.modelcontextprotocol/clientCapabilities": TASK_CAPS },
    }),
    true,
  );
  assert.equal(declaresTasks({ _meta: {} }), false);
  assert.equal(declaresTasks(null), false);
});

test("tasks: a large plan becomes a task for a client that declares it, and is read back", async () => {
  await h.call(olga.token, "POST", "/items", {
    kind: "task",
    title: "Write the report",
    due_at: new Date(Date.now() + 10 * 86_400_000).toISOString(),
    estimate_minutes: 90,
  });
  const r = await modernCall(key, "tools/call", {
    name: "plan_schedule",
    arguments: { days: 14 },
  });
  assert.equal(r.status, 200, r.raw);
  const created = r.body.result;
  assert.equal(created.resultType, "task");
  assert.equal(created.status, "working");
  assert.ok(created.taskId);
  assert.ok(created.ttlMs > 0);
  assert.ok(created.pollIntervalMs > 0);
  assert.ok(Date.parse(created.createdAt));
  const done = await waitForTask(key, created.taskId, ["completed", "failed"]);
  assert.equal(done.status, "completed", JSON.stringify(done));
  assert.equal(done.resultType, "complete");
  assert.equal(done.result.resultType, "complete");
  assert.ok(done.result.structuredContent.plan_token);
  // Another person's connection never sees it.
  const theirs = await modernCall(otherKey, "tasks/get", {
    taskId: created.taskId,
  });
  assert.equal(theirs.body.error.code, -32602);
  // Cancelling a finished task, updating one, an unknown one.
  const cancel = await modernCall(key, "tasks/cancel", {
    taskId: created.taskId,
  });
  assert.equal(cancel.body.error.code, -32602);
  assert.match(cancel.body.error.message, /already finished/);
  const update = await modernCall(key, "tasks/update", {
    taskId: created.taskId,
    inputResponses: {},
  });
  assert.equal(update.body.error.code, -32602);
  const unknown = await modernCall(key, "tasks/get", {
    taskId: "00000000-0000-0000-0000-000000000000",
  });
  assert.equal(unknown.body.error.code, -32602);
  const noId = await modernCall(key, "tasks/get", {});
  assert.equal(noId.body.error.code, -32602);
  // The activity log has the plan.
  const logged = (
    await pool.query(
      "SELECT count(*)::int AS n FROM mcp_tasks WHERE grant_id = $1 AND kind = 'plan'",
      [grant],
    )
  ).rows[0].n;
  assert.ok(logged >= 1);
});

test("tasks: the handle fallback stays for clients that don't declare it, or are 2025-era", async () => {
  const plain = await modernCall(
    key,
    "tools/call",
    { name: "plan_schedule", arguments: { days: 14 } },
    false,
  );
  assert.equal(plain.status, 200, plain.raw);
  assert.ok(plain.body.result.structuredContent.plan_token);
  assert.notEqual(plain.body.result.resultType, "task");
  const legacy = await h.legacy(key, "tools/call", {
    name: "plan_schedule",
    arguments: { days: 14 },
    _meta: { "io.modelcontextprotocol/clientCapabilities": TASK_CAPS },
  });
  assert.ok(legacy.body.result.structuredContent.plan_token);
  // tasks/* isn't a 2025 method.
  const old = await h.legacy(key, "tasks/get", { taskId: "x" });
  assert.equal(old.body.error.code, -32601);
  // A short plan stays a plain call even when declared.
  const short = await modernCall(key, "tools/call", {
    name: "plan_schedule",
    arguments: { days: 3 },
  });
  assert.ok(short.body.result.structuredContent.plan_token);
  // The header must name the method.
  const mismatch = await modernCall(key, "tasks/get", { taskId: "x" }, true, {
    "mcp-method": "tools/list",
  });
  assert.equal(mismatch.status, 400);
  assert.equal(mismatch.body.error.code, -32020);
});

test("tasks: an import follows the import itself, and cancels with it; its stream hears", async () => {
  const r = await modernCall(key, "tools/call", {
    name: "start_import",
    arguments: { file_name: "lecture.pdf", bytes: 4096 },
  });
  assert.equal(r.status, 200, r.raw);
  const created = r.body.result;
  assert.equal(created.resultType, "task", r.raw);
  assert.equal(created.status, "working");
  assert.match(created.statusMessage, /PUT its bytes to .*\/api\/files\/u\//);
  const importId = created._meta["orbyn/import"].replace(/^import:/, "");
  const got = await modernCall(key, "tasks/get", { taskId: created.taskId });
  assert.equal(got.body.result.status, "working");

  // The import turning ready completes the task with the page, told on the
  // listen stream following it.
  const doc = await newDoc(olga, { title: "lecture" });
  const s = await listen(
    key,
    { taskIds: [created.taskId, "00000000-0000-0000-0000-000000000000"] },
    async () => {
      await pool.query(
        "UPDATE imports SET status = 'ready', doc_id = $2, finished_at = now() WHERE id = $1",
        [importId, doc.id],
      );
      await pool.query("SELECT pg_notify('orbyn_live', $1)", [
        JSON.stringify({
          kind: "changed",
          user: olga.id,
          entity_type: "import",
          entity_id: importId,
        }),
      ]);
      await new Promise((res) => setTimeout(res, 800));
    },
  );
  const ack = s.events[0];
  assert.deepEqual(ack.params.notifications, { taskIds: [created.taskId] });
  const told = s.events.filter((e) => e.method === "notifications/tasks");
  assert.ok(told.length >= 1, JSON.stringify(s.events));
  const last = told.at(-1);
  assert.equal(last.params.taskId, created.taskId);
  assert.equal(last.params.status, "completed");
  assert.match(last.params.result.content[0].text, new RegExp(`doc:${doc.id}`));
  assert.equal(last.params.result.structuredContent.upload_url, null);
  const done = await modernCall(key, "tasks/get", { taskId: created.taskId });
  assert.equal(done.body.result.status, "completed");

  // A second import, cancelled through its task.
  const second = (
    await modernCall(key, "tools/call", {
      name: "start_import",
      arguments: { file_name: "second.pdf", bytes: 4096 },
    })
  ).body.result;
  const cancelled = await modernCall(key, "tasks/cancel", {
    taskId: second.taskId,
  });
  assert.equal(cancelled.body.result.resultType, "complete");
  const after = await modernCall(key, "tasks/get", { taskId: second.taskId });
  assert.equal(after.body.result.status, "cancelled");
  const secondImport = second._meta["orbyn/import"].replace(/^import:/, "");
  assert.equal(
    (
      await pool.query("SELECT status FROM imports WHERE id = $1", [
        secondImport,
      ])
    ).rows[0].status,
    "cancelled",
  );
  // A refused import is a plain error, never a task.
  const refused = await modernCall(key, "tools/call", {
    name: "start_import",
    arguments: { file_name: "x.exe", bytes: 0 },
  });
  assert.notEqual(refused.body.result?.resultType, "task");
});

test("progress: a call that asks for it streams notifications/progress, then the result", async () => {
  const r = await modernCall(
    key,
    "tools/call",
    {
      name: "plan_schedule",
      arguments: { days: 3 },
      _meta: { progressToken: "p-1" },
    },
    false,
  );
  assert.equal(r.status, 200, r.raw);
  assert.match(String(r.headers["content-type"]), /text\/event-stream/);
  assert.equal(r.headers["x-accel-buffering"], "no");
  const msgs = events(r.raw);
  const progress = msgs.filter((m) => m.method === "notifications/progress");
  assert.ok(progress.length >= 2, r.raw);
  assert.equal(progress[0].params.progressToken, "p-1");
  assert.equal(progress[0].params.total, 3);
  assert.ok(progress[0].params.message);
  const result = msgs.find((m) => m.id === 9);
  assert.ok(result.result.structuredContent.plan_token);
  // A 2025-era client asking for progress hears it too.
  fresh();
  const legacy = await app.inject({
    method: "POST",
    url: "/mcp",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...bearer(key),
    },
    payload: JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "plan_schedule",
        arguments: { days: 2 },
        _meta: { progressToken: 7 },
      },
    }),
  });
  assert.equal(legacy.statusCode, 200, legacy.body);
  const legacyMsgs = events(legacy.body);
  assert.ok(
    legacyMsgs.some(
      (m) =>
        m.method === "notifications/progress" && m.params.progressToken === 7,
    ),
    legacy.body,
  );
  assert.ok(legacyMsgs.find((m) => m.id === 3).result.structuredContent);
  // Without a token: plain JSON, as before.
  const plain = await h.legacy(key, "tools/call", {
    name: "plan_schedule",
    arguments: { days: 2 },
  });
  assert.ok(plain.body.result.structuredContent.plan_token);
});

test("the OpenAI apps challenge answers only while a token is set", async () => {
  const none = await app.inject({
    method: "GET",
    url: "/.well-known/openai-apps-challenge",
  });
  assert.equal(none.statusCode, 404);
  const was = env.OPENAI_APPS_CHALLENGE;
  env.OPENAI_APPS_CHALLENGE = "abc123-token";
  try {
    const r = await app.inject({
      method: "GET",
      url: "/.well-known/openai-apps-challenge",
    });
    assert.equal(r.statusCode, 200);
    assert.equal(r.body, "abc123-token");
    assert.match(String(r.headers["content-type"]), /text\/plain/);
  } finally {
    env.OPENAI_APPS_CHALLENGE = was;
  }
});

test("tasks are swept an hour after they were last touched", async () => {
  const rule = SWEEP_RULES.find((r) => r.key === "mcp_tasks");
  assert.ok(rule);
  assert.equal(rule.table, "mcp_tasks");
  assert.equal(rule.configurable, false);
});

test("nothing on the MCP path reached the network", () => {
  assert.deepEqual(network.calls, []);
});
