import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";
import { trapNetwork, type Person } from "./mcp-helpers.js";
import { type AgentClient, codeOf, scenario } from "./e2e-agent-helpers.js";

/**
 * H9: an agent's limits, end to end through /mcp. Per connection: calls a
 * minute, changes a minute, heavy calls (apply_plan counts as heavy and as
 * a change), and the daily caps; past each, 429 with Retry-After and the
 * JSON-RPC error -32029 naming the limit. Per person: add_file's 25 MB a
 * file (INVALID) and 500 MB a day (LIMITED, with retry_after), and
 * append_doc's 2 MB a page (INVALID). Going over again and again pauses
 * the connection (403) until its person restores it.
 *
 * Each section starts from a fresh minute (limiter.reset stands in for the
 * clock moving on); the limits themselves are set as an administrator
 * would, in Admin → Agents.
 */

// add_file's own file store, set up (the limits refuse before it is used).
process.env.FILES_SECRET = "test-files-secret-0123456789abcdef";
process.env.FILES_DIR = join(tmpdir(), "orbyn-e2e-limits");
process.env.FILES_MIN_FREE_MB = "0";

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { invalidateSettings } = await import("../src/lib/settings.js");
const { limiter, strikes } =
  await import("../src/modules/mcp-server/routes.js");
const { HEAVY_PER_MINUTE, SUSPEND_AFTER } =
  await import("../src/modules/mcp-server/limits.js");
const { MAX_DRAFT_BYTES, MAX_PART_BYTES } =
  await import("../src/capabilities/long-docs.js");
const { DEFAULT_AGENT_LIMITS } = await import("@orbyn/core");

const app = await buildApp();
const { h, connect } = scenario(app);
const network = await trapNetwork();

let lee: Person;
let admin: Person;

/** Admin → Agents → limits (the rest at their defaults). */
async function setLimits(limits: Record<string, number>) {
  const put = await h.call(admin.token, "PUT", "/admin/agents", {
    agent_limits: { ...DEFAULT_AGENT_LIMITS, ...limits },
  });
  assert.equal(put.statusCode, 200, put.body);
  invalidateSettings();
}

/** One tools/call, answered with the HTTP status, headers and body. */
const raw = (a: AgentClient, name: string, args: Record<string, unknown>) =>
  a.request("tools/call", { name, arguments: args });

/** A 429 as the docs say it: Retry-After, -32029, what the limit was. */
function limitedBy(
  r: Awaited<ReturnType<typeof raw>>,
  what: RegExp,
  most?: number,
) {
  assert.equal(r.status, 429, JSON.stringify(r.body));
  const after = Number(r.headers["retry-after"]);
  assert.ok(after >= 1, "Retry-After");
  assert.equal(r.body.error.code, -32029);
  assert.equal(r.body.error.data.retry_after, after);
  assert.match(r.body.error.message, what);
  assert.match(r.body.error.message, /Try again in \d+ s\./);
  return after;
}

before(async () => {
  await migrate();
  lee = await h.register("e2e-limits-lee", "Lee");
  admin = await h.register("e2e-limits-admin", "Ada");
  await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [admin.id]);
});

beforeEach(() => {
  limiter.reset();
  strikes.reset();
});

after(async () => {
  await pool.query("DELETE FROM system_settings WHERE key = 'agent_limits'");
  await pool.query("DELETE FROM agent_file_days WHERE user_id = $1", [lee.id]);
  invalidateSettings();
  limiter.reset();
  strikes.reset();
  const { closeLive } = await import("../src/modules/docs/live.js");
  await closeLive();
  assert.deepEqual(network.calls, []);
  network.restore();
  await app.close();
  await pool.end();
});

test("calls a minute: past the limit, 429 with Retry-After; another connection has its own", async () => {
  await setLimits({ calls_per_minute: 4 });
  const a = await connect(lee, { name: "Busy" });
  for (let i = 0; i < 4; i++)
    assert.equal((await raw(a, "get_today", {})).status, 200, `call ${i + 1}`);
  const after = limitedBy(
    await raw(a, "get_today", {}),
    /At most 4 calls a minute/,
  );
  assert.ok(after <= 60);
  const b = await connect(lee, { name: "Calm" });
  assert.equal((await raw(b, "get_today", {})).status, 200);
});

test("changes a minute: writes stop at the limit while reads go on", async () => {
  await setLimits({ writes_per_minute: 3 });
  const a = await connect(lee, { name: "Writer" });
  for (let i = 0; i < 3; i++)
    await a.ok("create_tasks", { tasks: [{ title: `Limit write ${i}` }] });
  limitedBy(
    await raw(a, "create_tasks", { tasks: [{ title: "One too many" }] }),
    /At most 3 changes a minute/,
  );
  assert.equal((await raw(a, "get_today", {})).status, 200, "reads go on");
});

test("heavy: apply_plan counts as heavy (and as a change); the 11th in a minute waits", async () => {
  await setLimits({});
  const a = await connect(lee, { name: "Planner" });
  const plan = (i: number) => ({
    steps: [
      {
        id: "t",
        tool: "create_tasks",
        args: { tasks: [{ title: `Heavy plan ${i}` }] },
      },
    ],
  });
  for (let i = 0; i < HEAVY_PER_MINUTE; i++)
    assert.equal((await raw(a, "apply_plan", plan(i))).status, 200);
  limitedBy(
    await raw(a, "apply_plan", plan(99)),
    new RegExp(`At most ${HEAVY_PER_MINUTE} heavy calls`),
  );
  // Light changes still go.
  await a.ok("create_tasks", { tasks: [{ title: "Light after heavy" }] });
});

test("daily caps: changes and calls a day, with Retry-After until the next day", async () => {
  await setLimits({ writes_per_day: 2 });
  const a = await connect(lee, { name: "Daily" });
  for (let i = 0; i < 2; i++)
    await a.ok("create_tasks", { tasks: [{ title: `Daily ${i}` }] });
  const wait = limitedBy(
    await raw(a, "create_tasks", { tasks: [{ title: "Tomorrow" }] }),
    /At most 2 changes a day per connection/,
  );
  assert.ok(wait > 0 && wait <= 86_400, `${wait} s until tomorrow`);
  // Reads aren't changes.
  assert.equal((await raw(a, "get_today", {})).status, 200);
  await setLimits({ calls_per_day: 3 });
  limiter.reset();
  const b = await connect(lee, { name: "Chatty" });
  for (let i = 0; i < 3; i++)
    assert.equal((await raw(b, "get_today", {})).status, 200);
  limitedBy(await raw(b, "get_today", {}), /At most 3 calls a day/);
});

test("add_file: over 25 MB is INVALID; past 500 MB a day, LIMITED with retry_after", async () => {
  await setLimits({});
  const a = await connect(lee, { toolsets: ["files"], name: "Files" });
  const page = (
    await a.ok("create_doc", { title: "Files limit page", markdown: "Hi" })
  ).done[0].id as string;
  const huge = Buffer.alloc(25 * 1024 * 1024 + 1, 0x20);
  Buffer.from("%PDF-1.7\n").copy(huge);
  const over = await a.call("add_file", {
    doc: page,
    name: "big.pdf",
    content: huge.toString("base64"),
  });
  assert.equal(codeOf(over), "INVALID");
  assert.match(over.content[0].text, /at most 25 MB/);
  // What this person's agents sent today, up to the day's 500 MB.
  await pool.query(
    `INSERT INTO agent_file_days (user_id, day, bytes)
     VALUES ($1, (now() AT TIME ZONE 'UTC')::date, $2)
     ON CONFLICT (user_id, day) DO UPDATE SET bytes = EXCLUDED.bytes`,
    [lee.id, 500 * 1024 * 1024 - 10],
  );
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(200, 7),
  ]);
  const day = await a.call("add_file", {
    doc: page,
    name: "one.png",
    content: png.toString("base64"),
  });
  assert.equal(codeOf(day), "LIMITED");
  assert.match(day.content[0].text, /500 MB a day/);
  const retry = day._meta?.["orbyn/data"]?.retry_after;
  assert.ok(retry > 0 && retry <= 86_400, `retry_after ${retry}`);
});

test("append_doc: parts of 512 KB, 2 MB a page; past it INVALID and nothing made", async () => {
  await setLimits({});
  const a = await connect(lee, { toolsets: ["workspace"], name: "Long" });
  // A part just under 512 KB: lines of about 100 characters.
  const line =
    "Words of a long lecture transcript, one line after another, as it was said. ".repeat(
      4,
    );
  const part = (n: number) =>
    `## Part ${n}\n\n${Array.from(
      { length: Math.floor((MAX_PART_BYTES - 100) / (line.length + 2)) },
      () => line,
    ).join("\n\n")}`;
  assert.equal(MAX_DRAFT_BYTES, 2 * 1024 * 1024);
  // More lines than a part holds: said plainly.
  const short = await a.call("append_doc", {
    title: "Too many lines",
    markdown: Array.from({ length: 2100 }, (_, i) => `[${i}] ok`).join("\n\n"),
  });
  assert.equal(codeOf(short), "INVALID");
  assert.match(short.content[0].text, /2100 lines; at most 2000/);
  const tooBig = await a.call("append_doc", {
    title: "Too big a part",
    markdown: `${part(0)}${"x".repeat(1024)}`,
  });
  assert.equal(codeOf(tooBig), "INVALID", "one part is 512 KB at most");
  const first = await a.ok("append_doc", {
    title: "Two megabytes",
    markdown: part(1),
  });
  const draft = first.done[0].id as string;
  for (let n = 2; n <= 4; n++)
    await a.ok("append_doc", { draft, markdown: part(n) });
  const over = await a.call("append_doc", { draft, markdown: part(5) });
  assert.equal(codeOf(over), "INVALID");
  assert.match(over.content[0].text, /2 MB/);
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM docs WHERE user_id = $1 AND title = 'Two megabytes'",
        [lee.id],
      )
    ).rowCount,
    0,
    "no page until finish",
  );
});

test("strikes: going over again and again pauses the connection until the person restores it", async () => {
  await setLimits({ calls_per_minute: 2 });
  const a = await connect(lee, { name: "Pushy" });
  for (let i = 0; i < 2; i++)
    assert.equal((await raw(a, "get_today", {})).status, 200);
  for (let i = 0; i <= SUSPEND_AFTER.limited; i++)
    assert.equal((await raw(a, "get_today", {})).status, 429);
  // Paused off the request path: wait for it to land.
  const paused = async () =>
    (
      await pool.query<{ suspended_at: Date | null }>(
        "SELECT suspended_at FROM agent_grants WHERE id = $1",
        [a.grant],
      )
    ).rows[0].suspended_at;
  for (let i = 0; i < 50 && !(await paused()); i++)
    await new Promise((r) => setTimeout(r, 20));
  assert.ok(await paused(), "paused");
  limiter.reset();
  const refused = await raw(a, "get_today", {});
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error.code, -32003);
  // The person restores it in Settings → Connected agents.
  const restored = await h.call(
    lee.token,
    "POST",
    `/me/agents/${a.grant}/restore`,
  );
  assert.ok(restored.statusCode < 300, restored.body);
  strikes.reset();
  assert.equal((await raw(a, "get_today", {})).status, 200);
});
