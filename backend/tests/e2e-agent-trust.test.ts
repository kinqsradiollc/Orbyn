import { test, before, after } from "node:test";
import assert from "node:assert/strict";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";
import { trapNetwork, type Person } from "./mcp-helpers.js";
import {
  AgentClient,
  YES,
  codeOf,
  idOf,
  scenario,
} from "./e2e-agent-helpers.js";

/**
 * H9 scenario (f): the same flow under each trust level. One app, signed
 * in with Orbyn; the person moves it between "full power", "ask me for
 * everything" and "suggest only" in Settings → Connected agents (and per
 * space). Each time the agent does the same job: a page and a task in one
 * apply_plan, then deleting a task of the person's own.
 *
 * - full: made directly, the delete too (undo for 30 days); nothing asked.
 * - ask: every change asks, once per call: in the chat when the app shows
 *   forms (yes makes it, no changes nothing), else the Review inbox.
 * - suggest: never asks in the chat; everything waits in the Review inbox
 *   and is made when approved.
 * - per space: Personal at ask while a team stays at full power.
 */

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");

const app = await buildApp();
const { h, connect } = scenario(app);
const network = await trapNetwork();

let tess: Person;
let crew = "";
let chat: AgentClient;
let plain: AgentClient;

/** The same agent without forms (an app that can't ask in the chat). */
const withoutForms = (a: AgentClient) =>
  new AgentClient(app, a.token, a.grant, { name: "Trust (no forms)" });

const setTrust = async (body: Record<string, unknown>) => {
  const r = await h.call(
    tess.token,
    "PUT",
    `/me/agents/${chat.grant}/trust`,
    body,
  );
  assert.equal(r.statusCode, 200, r.body);
};

const plan = (tag: string, team?: string) => ({
  summary: `The ${tag} job`,
  steps: [
    {
      id: "page",
      tool: "create_doc",
      args: {
        title: `${tag} page`,
        markdown: "Notes.",
        ...(team ? { team } : {}),
      },
    },
    {
      id: "task",
      tool: "create_tasks",
      args: {
        tasks: [{ title: `${tag} task`, ...(team ? { team } : {}) }],
      },
    },
  ],
});

const exists = async (title: string) =>
  (
    await pool.query(
      `SELECT 1 FROM docs WHERE title = $1 AND user_id = $2 AND deleted_at IS NULL
       UNION ALL SELECT 1 FROM items WHERE title = $1 AND user_id = $2`,
      [title, tess.id],
    )
  ).rowCount!;

/** A task of Tess's own, made in the app. */
const ownTask = async (title: string) =>
  (await h.call(tess.token, "POST", "/items", { title })).json() as {
    id: string;
    version: number;
  };
const deleting = (t: { id: string; version: number }) => ({
  summary: "Tidy up",
  changes: [
    { type: "delete_task", target: `task:${t.id}`, version: t.version },
  ],
});
const alive = async (id: string) =>
  (await pool.query("SELECT 1 FROM items WHERE id = $1", [id])).rowCount === 1;

before(async () => {
  await migrate();
  tess = await h.register("e2e-trust-tess", "Tess");
  crew = await h.team(tess, "Trust crew");
  chat = await connect(tess, {
    kind: "oauth",
    team_ids: [crew],
    forms: true,
    name: "Trust agent",
  });
  plain = withoutForms(chat);
});

after(async () => {
  const { closeLive } = await import("../src/modules/docs/live.js");
  await closeLive();
  assert.deepEqual(network.calls, []);
  network.restore();
  await app.close();
  await pool.end();
});

test("full power: the job and an own delete are made directly, asking nothing", async () => {
  const ctx = await chat.ok("get_context");
  assert.equal(ctx.connection.trust, "full", "new connections: full power");
  const job = await chat.ok("apply_plan", plan("Full"));
  assert.equal(job.status, "done");
  assert.equal(await exists("Full page"), 1);
  assert.equal(await exists("Full task"), 1);
  const t = await ownTask("Full delete me");
  const del = await chat.ok("propose_changes", deleting(t));
  assert.equal(del.status, "done");
  assert.equal(await alive(t.id), false);
  assert.equal(chat.asked.length, 0, "nothing asked");
  // Undo brings it back.
  const changes = await chat.ok("list_agent_changes", { limit: 1 });
  assert.ok(changes.changes[0].undo_until);
  await chat.ok("undo", { change: changes.changes[0].id });
  assert.equal(await alive(t.id), true);
});

test("ask: every change asks once, in the chat (yes makes it, no doesn't) or in the Review inbox", async () => {
  await setTrust({ trust: "ask" });
  assert.equal((await chat.ok("get_context")).connection.trust, "ask");
  // Reads never ask.
  await chat.ok("get_today");
  assert.equal(chat.asked.length, 0);
  // The job: one question for the whole plan; yes makes all of it.
  const job = await chat.call("apply_plan", plan("Ask"), YES);
  assert.ok(!job.isError, job.content?.[0]?.text);
  assert.equal(job.structuredContent.status, "done");
  assert.equal(chat.asked.length, 1, "asked once");
  assert.match(chat.asked[0].message, /Ask page[\s\S]*Ask task/);
  assert.equal(await exists("Ask page"), 1);
  // The delete: asked; no changes nothing.
  const t = await ownTask("Ask keep me");
  const no = await chat.call("propose_changes", deleting(t), () => ({
    action: "decline",
  }));
  assert.equal(codeOf(no), "DECLINED");
  assert.equal(chat.asked.length, 2);
  assert.equal(await alive(t.id), true);
  // Without forms: the whole job waits as one proposal.
  const waiting = await plain.ok("apply_plan", plan("Ask inbox"));
  assert.equal(waiting.status, "pending_review");
  assert.equal(await exists("Ask inbox page"), 0);
  const yes = await h.call(
    tess.token,
    "POST",
    `/proposals/${idOf(waiting.pending.proposal_id)}/apply`,
    {},
  );
  assert.equal(yes.statusCode, 200, yes.body);
  assert.equal(await exists("Ask inbox page"), 1);
  assert.equal(await exists("Ask inbox task"), 1);
});

test("suggest: nothing is asked in the chat; everything waits in the Review inbox", async () => {
  await setTrust({ trust: "suggest" });
  const before = chat.asked.length;
  const job = await chat.ok("apply_plan", plan("Suggest"));
  assert.equal(job.status, "pending_review");
  assert.equal(chat.asked.length, before, "no form, even though it can");
  assert.equal(await exists("Suggest page"), 0);
  const t = await ownTask("Suggest delete me");
  const del = await chat.ok("propose_changes", deleting(t));
  assert.equal(del.status, "pending_review");
  assert.equal(await alive(t.id), true);
  // The person approves the job: all of it, as the agent.
  const approved = await h.call(
    tess.token,
    "POST",
    `/proposals/${idOf(job.pending.proposal_id)}/apply`,
    {},
  );
  assert.equal(approved.statusCode, 200, approved.body);
  assert.equal(await exists("Suggest page"), 1);
  assert.equal(await exists("Suggest task"), 1);
  // And declines the delete: nothing.
  const declined = await h.call(
    tess.token,
    "POST",
    `/proposals/${idOf(del.pending.proposal_id)}/decline`,
    {},
  );
  assert.equal(declined.statusCode, 204);
  assert.equal(await alive(t.id), true);
});

test("per space: Personal asks while the team stays at full power", async () => {
  await setTrust({ trust: "full", spaces: { personal: "ask" } });
  const ctx = await chat.ok("get_context");
  assert.equal(ctx.connection.trust, "full");
  assert.equal(ctx.connection.personal_trust, "ask");
  const before = chat.asked.length;
  const team = await chat.ok("apply_plan", plan("Team space", crew));
  assert.equal(team.status, "done");
  assert.equal(chat.asked.length, before, "the team's job asks nothing");
  const personal = await chat.call("apply_plan", plan("Personal space"), YES);
  assert.equal(personal.structuredContent.status, "done");
  assert.equal(chat.asked.length, before + 1, "Personal's asks");
  assert.equal(await exists("Personal space page"), 1);
});
