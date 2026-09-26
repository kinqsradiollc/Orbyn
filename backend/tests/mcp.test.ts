/**
 * The first MCP endpoint's contract, kept for old personal API keys (ok_)
 * on the legacy address (/api/mcp) for their 90 days: it now runs on the
 * new mcp service and capability layer, with the three original tools as
 * aliases (search_items, add_task, get_agenda) beside the new read tools.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";
import { spyPool, trapNetwork } from "./mcp-helpers.js";

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { env } = await import("../src/config/env.js");
const { invalidateSettings } = await import("../src/lib/settings.js");

const app = await buildApp();
// Nothing leaves the machine, and reads never step outside their transaction.
const network = await trapNetwork();
const pools = await spyPool();
let session = "";
let apiKey = "";
let admin = "";
let userId = "";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const parse = (body: string) => {
  try {
    return body ? JSON.parse(body) : null;
  } catch {
    return body;
  }
};
/** One raw POST to /mcp. */
const post = async (
  payload: unknown,
  headers: Record<string, string> = bearer(apiKey),
) => {
  const r = await app.inject({
    method: "POST",
    url: "/mcp",
    headers: { "content-type": "application/json", ...headers },
    payload: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
  return { status: r.statusCode, body: parse(r.body), headers: r.headers };
};
/** One JSON-RPC call to /mcp with the API key. */
const rpc = (method: string, params?: unknown, id: number | null = 1) =>
  post({ jsonrpc: "2.0", ...(id === null ? {} : { id }), method, params });
const callTool = (name: string, args: object) =>
  rpc("tools/call", { name, arguments: args });
const text = (b: { result?: { content?: { text: string }[] } }) =>
  b.result?.content?.[0]?.text ?? "";
const titles = async () =>
  (
    await pool.query<{ title: string }>(
      "SELECT title FROM items WHERE user_id = $1",
      [userId],
    )
  ).rows.map((r) => r.title);

const register = async (prefix: string) => {
  const reg = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      email: `${prefix}-${randomUUID()}@example.com`,
      password: "a-long-test-password",
      name: "M",
    },
  });
  return reg.json() as { token: string; user: { id: string } };
};

before(async () => {
  await migrate();
  const me = await register("mcp");
  session = me.token;
  userId = me.user.id;
  const key = await app.inject({
    method: "POST",
    url: "/me/api-keys",
    headers: bearer(session),
    payload: { name: "MCP" },
  });
  apiKey = key.json().key;
  const boss = await register("mcp-admin");
  await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [
    boss.user.id,
  ]);
  admin = boss.token;
});
after(async () => {
  network.restore();
  pools.restore();
  await app.close();
  await pool.end();
});

test("the endpoint needs a key, and never takes an app session", async () => {
  const none = await post({ jsonrpc: "2.0", id: 1, method: "tools/list" }, {});
  assert.equal(none.status, 401);
  assert.equal(none.body.jsonrpc, "2.0");
  assert.equal(none.body.error.code, -32001);
  assert.match(none.body.error.message, /agent key/);
  assert.match(String(none.headers["www-authenticate"]), /resource_metadata=/);

  // A browser's session token works on the REST API but not here.
  const browser = await post(
    { jsonrpc: "2.0", id: 1, method: "tools/list" },
    bearer(session),
  );
  assert.equal(browser.status, 401);
  assert.match(browser.body.error.message, /not the app's/);

  const wrong = await post(
    { jsonrpc: "2.0", id: 1, method: "tools/list" },
    bearer("ok_not-a-real-key"),
  );
  assert.equal(wrong.status, 401);
  assert.match(wrong.body.error.message, /isn't valid/);
});

test("initialize and tools/list describe the server and its tools", async () => {
  const init = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "script", version: "1" },
  });
  assert.equal(init.body.result.serverInfo.name, "orbyn");
  assert.equal(init.body.result.serverInfo.title, "Orbyn");
  assert.ok(init.body.result.capabilities.tools);

  const list = await rpc("tools/list");
  const names = list.body.result.tools.map((t: { name: string }) => t.name);
  // The original three, beside the new read tools.
  for (const name of [
    "add_task",
    "get_agenda",
    "search_items",
    "search",
    "fetch",
    "get_today",
  ])
    assert.ok(names.includes(name), name);
  // With no params at all, too.
  const bare = await post({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.equal(bare.body.result.tools.length, names.length);
  // Old keys hear they're deprecated.
  assert.match(String(list.headers.deprecation), /^@\d+$/);
  assert.ok(list.headers.sunset);
});

test("a notification (no id) gets no response body", async () => {
  const r = await rpc("notifications/initialized", {}, null);
  assert.equal(r.status, 202);
  assert.equal(r.body, null);
});

test("add_task creates a task that search and agenda then find, with its id and link", async () => {
  const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const added = await callTool("add_task", {
    title: "Renew passport",
    due_at: soon,
    priority: "high",
  });
  assert.match(text(added.body), /Added "Renew passport"/);
  const id = text(added.body).match(new RegExp(`id: (${UUID})`))?.[1];
  assert.ok(id, text(added.body));
  const link = `${env.APP_URL.replace(/\/$/, "")}/app/task/${id}`;
  assert.ok(text(added.body).includes(link), text(added.body));

  // It really exists via the normal API.
  const items = await app.inject({
    method: "GET",
    url: `/items/${id}`,
    headers: bearer(session),
  });
  assert.equal(items.json().title, "Renew passport");

  const found = await callTool("search_items", { query: "passport" });
  assert.match(text(found.body), /Renew passport/);
  assert.ok(text(found.body).includes(`id: ${id}`));
  assert.ok(text(found.body).includes(link));

  const agenda = await callTool("get_agenda", { days: 7 });
  assert.match(text(agenda.body), /Renew passport \(task, due\)/);
  assert.ok(text(agenda.body).includes(link));
});

test("search takes % and _ as plain characters", async () => {
  await callTool("add_task", { title: "Grow revenue 20% this quarter" });
  await callTool("add_task", { title: "Grow revenue 20x this quarter" });
  const found = text((await callTool("search_items", { query: "20%" })).body);
  assert.match(found, /20% this quarter/);
  assert.doesNotMatch(found, /20x this quarter/);
});

test("get_agenda starts today and shows each occurrence of a repeating event", async () => {
  const day = 86_400_000;
  const at = (days: number, hour: number) => {
    const d = new Date(Date.now() + days * day);
    d.setUTCHours(hour, 0, 0, 0);
    return d.toISOString();
  };
  const make = (payload: object) =>
    app.inject({
      method: "POST",
      url: "/items",
      headers: bearer(session),
      payload,
    });
  assert.equal(
    (
      await make({
        title: "Ancient chore",
        kind: "task",
        due_at: at(-40, 9),
      })
    ).statusCode,
    201,
  );
  const standup = await make({
    title: "Daily standup",
    kind: "event",
    due_at: at(1, 10),
    end_at: at(1, 11),
    rrule: "FREQ=DAILY",
    timezone: "UTC",
  });
  assert.equal(standup.statusCode, 201, standup.body);
  const party = (
    await make({
      title: "Cancelled party",
      kind: "event",
      due_at: at(2, 18),
      end_at: at(2, 20),
    })
  ).json();
  await pool.query("UPDATE items SET status = 'cancelled' WHERE id = $1", [
    party.id,
  ]);

  const agenda = text((await callTool("get_agenda", { days: 4 })).body);
  // Before today is left out, however overdue.
  assert.doesNotMatch(agenda, /Ancient chore/);
  assert.doesNotMatch(agenda, /Cancelled party/);
  const standups = agenda.match(/Daily standup \(event\)/g) ?? [];
  assert.ok(standups.length >= 2, agenda);
  assert.ok(agenda.includes(`id: ${standup.json().id}`));
  assert.match(agenda, /^Today \(\d{4}-\d{2}-\d{2}\) through/);
  // One day is just today.
  const today = text((await callTool("get_agenda", { days: 1 })).body);
  assert.doesNotMatch(today, /Renew passport/);
});

test("batches are refused whole, and nothing in them runs", async () => {
  const before = (await titles()).length;
  const batch = await post(
    [1, 2, 3].map((n) => ({
      jsonrpc: "2.0",
      id: n,
      method: "tools/call",
      params: { name: "add_task", arguments: { title: `Batch ${n}` } },
    })),
  );
  assert.equal(batch.status, 400);
  assert.equal(batch.body.error.code, -32600);
  assert.match(batch.body.error.message, /Batches aren't supported/);
  assert.equal((await titles()).length, before);
});

test("bad requests get JSON-RPC errors, never a 500", async () => {
  // params: null, a list, or arguments that aren't an object.
  const nullParams = await rpc("tools/call", null);
  assert.equal(nullParams.status, 200);
  assert.equal(nullParams.body.error.code, -32602);
  assert.equal(nullParams.body.id, 1);
  assert.equal((await rpc("tools/list", [])).body.error.code, -32602);
  const badArgs = await rpc("tools/call", {
    name: "search_items",
    arguments: null,
  });
  assert.equal(badArgs.body.error.code, -32602);

  // Not a request at all: HTTP 400 with a JSON-RPC error.
  for (const body of [
    { id: 1, method: "tools/list" },
    { jsonrpc: "2.0", id: 1 },
    { jsonrpc: "2.0", id: { nested: true }, method: "ping" },
    "42",
    '"a string"',
    "null",
  ]) {
    const r = await post(body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.error.code, -32600, JSON.stringify(body));
  }
  const broken = await post("{not json");
  assert.equal(broken.status, 400);
  assert.equal(broken.body.error.code, -32700);
});

test("an unknown method and an unknown tool are reported cleanly", async () => {
  const bad = await rpc("does/not/exist");
  assert.equal(bad.body.error.code, -32601);

  const badTool = await callTool("delete_everything", {});
  assert.equal(badTool.body.error.code, -32602);

  // An empty search answers in words, not as a failure.
  const empty = await callTool("search_items", { query: "" });
  assert.equal(empty.status, 200);
  assert.match(text(empty.body), /words to search/);
  // Arguments of the wrong kind are an in-band error the model can correct.
  const wrong = await callTool("search_items", { query: 5 });
  assert.equal(wrong.body.result.isError, true);
  assert.match(text(wrong.body), /^INVALID/);
});

test("tool errors are in words, never the database's own", async (t) => {
  const badDate = await callTool("add_task", {
    title: "When?",
    due_at: "next Tuesday-ish",
  });
  assert.equal(badDate.body.result.isError, true);
  assert.match(text(badDate.body), /isn't a valid date/);

  // A database failure is reported in words, never in the database's own.
  const connect = pool.connect.bind(pool) as (...a: unknown[]) => any;
  // pool.query itself connects with a callback: that path is left alone.
  t.mock.method(pool, "connect", (...args: unknown[]) =>
    typeof args[0] === "function" ? connect(...args) : wrapped(),
  );
  const wrapped = async () => {
    const client = await connect();
    const query = client.query.bind(client);
    const release = client.release.bind(client);
    const broken = (sql: unknown, ...rest: unknown[]) =>
      typeof sql === "string" && sql.includes("NOT ILIKE")
        ? Promise.reject(
            Object.assign(
              new Error('relation "items" does not exist at character 42'),
              { code: "42P01" },
            ),
          )
        : (query as (...a: unknown[]) => unknown)(sql, ...rest);
    Object.assign(client, {
      query: broken,
      release: (...args: unknown[]) => {
        Object.assign(client, { query, release });
        return (release as (...a: unknown[]) => unknown)(...args);
      },
    });
    return client;
  };
  const failed = await callTool("search_items", { query: "anything" });
  assert.equal(failed.status, 200);
  assert.equal(failed.body.result.isError, true);
  assert.match(text(failed.body), /went wrong on Orbyn's side/);
  assert.doesNotMatch(text(failed.body), /relation|character|items/);
});

test("GET and DELETE are 405; other web pages are refused", async () => {
  for (const method of ["GET", "DELETE"] as const) {
    const r = await app.inject({
      method,
      url: "/mcp",
      headers: bearer(apiKey),
    });
    assert.equal(r.statusCode, 405, method);
    assert.equal(r.headers.allow, "POST");
  }
  const evil = await post(
    { jsonrpc: "2.0", id: 1, method: "tools/list" },
    { ...bearer(apiKey), origin: "https://evil.example" },
  );
  assert.equal(evil.status, 403);
  assert.equal(evil.body.error.code, -32003);
  // Orbyn's own web app is fine.
  const own = await post(
    { jsonrpc: "2.0", id: 1, method: "tools/list" },
    { ...bearer(apiKey), origin: env.APP_URL.replace(/\/$/, "") },
  );
  assert.equal(own.status, 200);
  assert.ok(own.body.result.tools.length >= 3);
});

test("during maintenance reads still answer and writes get a JSON-RPC error", async () => {
  const toggle = (enabled: boolean) =>
    app.inject({
      method: "PUT",
      url: "/admin/maintenance",
      headers: bearer(admin),
      payload: { enabled, message: enabled ? "Moving house" : "", until: null },
    });
  assert.equal((await toggle(true)).statusCode, 200);
  try {
    const list = await rpc("tools/list");
    assert.equal(list.status, 200);
    assert.ok(list.body.result.tools.length >= 3);
    const found = await callTool("search_items", { query: "passport" });
    assert.match(text(found.body), /Renew passport/);
    assert.match(
      text((await callTool("get_agenda", {})).body),
      /Renew passport/,
    );
    const write = await callTool("add_task", { title: "Not now" });
    assert.equal(write.status, 200);
    assert.equal(write.body.id, 1);
    assert.equal(write.body.error.code, -32000);
    assert.match(write.body.error.message, /maintenance: Moving house/);
    assert.match(write.body.error.message, /reading still work/);
    assert.ok(!(await titles()).includes("Not now"));
  } finally {
    await toggle(false);
    // Whatever that answered, maintenance must not outlive this test.
    await pool.query("DELETE FROM system_settings WHERE key = 'maintenance'");
    invalidateSettings();
  }
  const after = await callTool("add_task", { title: "Now it's fine" });
  assert.match(text(after.body), /Added/);
});

test("past the rate limit the answer is a 429 in JSON-RPC shape", async () => {
  const limit = (body: object) =>
    app.inject({
      method: "PUT",
      url: "/admin/settings",
      headers: bearer(admin),
      payload: body,
    });
  assert.equal((await limit({ rate_limit_per_minute: 3 })).statusCode, 200);
  try {
    const owner = await register("mcp-limited");
    const key = (
      await app.inject({
        method: "POST",
        url: "/me/api-keys",
        headers: bearer(owner.token),
        payload: { name: "Busy" },
      })
    ).json().key as string;
    let last = { status: 0, body: null as any, headers: {} as any };
    for (let i = 0; i < 4; i++)
      last = await post({ jsonrpc: "2.0", id: i, method: "ping" }, bearer(key));
    assert.equal(last.status, 429);
    assert.equal(last.body.error.code, -32029);
    assert.ok(Number(last.headers["retry-after"]) > 0);
  } finally {
    // Straight in the database: at 3 a minute, asking the API could be
    // refused too, and the limit would outlive this file.
    await pool.query(
      "DELETE FROM system_settings WHERE key = 'rate_limit_per_minute'",
    );
    invalidateSettings();
  }
});

// Last: everything above ran with the network and the pools watched.
test("the old endpoint never reached the network or the pool from inside a read", () => {
  assert.deepEqual(network.calls, []);
  assert.deepEqual(pools.stray, []);
});
