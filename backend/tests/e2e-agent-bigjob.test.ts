import { test, before, after } from "node:test";
import assert from "node:assert/strict";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";
import { trapNetwork, type Person } from "./mcp-helpers.js";
import { type AgentClient, scenario } from "./e2e-agent-helpers.js";

/**
 * H9 scenario (g): a big job tells the person once. An agent applies one
 * plan of 25 changes (a page and 24 tasks). The notifier's scan, run with
 * an injected clock as the worker runs it, sends one notice and one push
 * for the whole job (never one per step, never twice); the next morning's
 * digest has a "What your agents did" section with the job in words, links
 * to what it touched and where to undo it.
 */

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { env } = await import("../src/config/env.js");
const { scanAgentJobs } = await import("../src/worker/agent-jobs.js");
const { buildMorning } = await import("../src/worker/digest.js");

const app = await buildApp();
const { h, connect } = scenario(app);
const network = await trapNetwork();

let nia: Person;
let agent: AgentClient;

const titles = (n: number, tag: string) =>
  Array.from({ length: n }, (_, i) => ({ title: `${tag} ${i + 1}` }));

const notices = async () =>
  (
    await pool.query<{ channel: string; title: string; body: string }>(
      `SELECT channel, title, body FROM notifications
        WHERE user_id = $1 AND kind = 'agent' AND title LIKE '%big job'
        ORDER BY created_at, channel`,
      [nia.id],
    )
  ).rows;

before(async () => {
  await migrate();
  nia = await h.register("e2e-big-nia", "Nia");
  await h.call(nia.token, "PUT", "/planner/prefs", { timezone: "UTC" });
  await pool.query("INSERT INTO devices (token, user_id) VALUES ($1, $2)", [
    `ExponentPushToken[big-${nia.id.slice(0, 8)}]`,
    nia.id,
  ]);
  agent = await connect(nia, { kind: "oauth", name: "Big job agent" });
  // Nothing earlier in this database's run counts as a new job.
  await pool.query(
    "UPDATE agent_activity SET reported_at = now() WHERE reported_at IS NULL",
  );
});

after(async () => {
  // What this file's agent did is reported: later files start clean.
  await pool.query(
    "UPDATE agent_activity SET reported_at = now() WHERE reported_at IS NULL",
  );
  const { closeLive } = await import("../src/modules/docs/live.js");
  await closeLive();
  assert.deepEqual(network.calls, []);
  network.restore();
  await app.close();
  await pool.end();
});

test("a job over 20 changes: one notice and one push, then the morning digest tells it", async () => {
  const job = await agent.ok("apply_plan", {
    summary: "Set up the term",
    steps: [
      {
        id: "page",
        tool: "create_doc",
        args: { title: "Term plan", markdown: "## Weeks" },
      },
      {
        id: "a",
        tool: "create_tasks",
        args: { tasks: titles(12, "Week task") },
      },
      {
        id: "b",
        tool: "create_tasks",
        args: { tasks: titles(12, "Reading") },
      },
    ],
  });
  assert.equal(job.status, "done");

  // The worker's scan a moment later: one notice, one push, for the job.
  const soon = new Date(Date.now() + 5_000);
  await scanAgentJobs(soon);
  const sent = await notices();
  assert.deepEqual(
    sent.map((n) => n.channel),
    ["inapp", "push"],
    JSON.stringify(sent),
  );
  assert.match(sent[0].title, /Big job agent finished a big job/);
  assert.match(sent[0].body, /24 tasks/);
  assert.match(sent[0].body, /Settings → Connected agents/);
  // Scanned again (every notifier cycle): nothing more.
  await scanAgentJobs(new Date(soon.getTime() + 10 * 60_000));
  assert.equal((await notices()).length, 2);

  // The next morning's digest (07:00 UTC after the job) tells what it did.
  const morning = new Date();
  morning.setUTCHours(7, 0, 0, 0);
  if (morning.getTime() <= Date.now())
    morning.setTime(morning.getTime() + 86_400_000);
  const digest = await buildMorning(nia.id, "Nia", morning, "UTC");
  const text = digest.lines.join("\n");
  assert.match(text, /What your agents did:/);
  assert.match(text, /Big job agent added 24 tasks/);
  const base = env.APP_URL.replace(/\/+$/, "");
  assert.match(text, new RegExp(`${base}/app/(task|doc)/[0-9a-f-]{36}`));
  assert.match(text, new RegExp(`${base}/app/agents`), "where to undo");
  // Undone, the job leaves the next digest.
  await agent.ok("undo", { job: job.job });
  const after = await buildMorning(nia.id, "Nia", morning, "UTC");
  assert.doesNotMatch(after.lines.join("\n"), /What your agents did/);
});
