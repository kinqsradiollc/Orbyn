import "./setup.js";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { assistantPrincipal } =
  await import("../src/modules/agents/assistant.js");
const { replaceAssistantRules } =
  await import("../src/modules/agents/assistant-rules.js");
const { execute } = await import("../src/capabilities/execute.js");
const { registry } = await import("../src/capabilities/index.js");
const { assistantReplayAuthority } =
  await import("../src/capabilities/assistant-replay.js");
const owners: string[] = [];
before(() => migrate());
after(async () => {
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [owners]);
  await pool.end();
});
async function fixture(withJob = false) {
  const id = randomUUID();
  owners.push(id);
  await pool.query(
    "INSERT INTO users(id,email,password_hash,name) VALUES($1,$2,'test','Replay tester')",
    [id, `replay-${id}@example.test`],
  );
  const user = { id, name: "Replay tester", role: "member" as const };
  const p = await assistantPrincipal(user);
  p.assistant_lane = "background";
  const chat = randomUUID();
  const job = randomUUID();
  const project = randomUUID();
  const doc = randomUUID();
  if (withJob) {
    await pool.query(
      "INSERT INTO projects(id,user_id,name) VALUES($1,$2,'Source project')",
      [project, id],
    );
    await pool.query(
      "INSERT INTO docs(id,user_id,project_id,title) VALUES($1,$2,$3,'Source page')",
      [doc, id, project],
    );
    await pool.query(
      "INSERT INTO ai_chats(id,user_id,title,origin) VALUES($1,$2,'Replay source','task')",
      [chat, id],
    );
    await pool.query(
      "INSERT INTO ai_jobs(id,user_id,chat_id,state,sources_checked,run_origin,run_state) VALUES($1,$2,$3,'running',true,'task',$4)",
      [
        job,
        id,
        chat,
        { version: 1, request: { automation: { kind: "task" } } },
      ],
    );
    await pool.query(
      "INSERT INTO assistant_job_sources(job_id,source_kind,source_id) VALUES($1,'doc',$2)",
      [job, doc],
    );
    p.assistant_job_id = job;
  }
  const args = {
    client_ref: randomUUID(),
    tasks: [{ title: "Private cached task title" }],
  };
  const call = (principal = p) =>
    execute(registry, principal, "create_tasks", args, { write: transaction });
  const first = await call();
  assert.equal(first.result.isError, undefined, JSON.stringify(first));
  return { p, user, call, first, chat, job, project, doc };
}
async function held(f: Awaited<ReturnType<typeof fixture>>, p = f.p) {
  const retry = await f.call(p);
  assert.equal(retry.result.isError, true, JSON.stringify(retry));
  assert.match(JSON.stringify(retry.result), /cached result.*held/i);
  assert.doesNotMatch(
    JSON.stringify(retry.result),
    /Private cached task title/,
  );
  assert.deepEqual(retry.targets, []);
  assert.equal(
    (
      await pool.query("SELECT count(*)::int n FROM items WHERE user_id=$1", [
        p.user.id,
      ])
    ).rows[0].n,
    1,
  );
}
test("unchanged assistant authority replays the original result without another mutation", async () => {
  const f = await fixture();
  const retry = await f.call();
  assert.equal(retry.result.isError, undefined);
  assert.equal(retry.replayed, true);
  assert.deepEqual(retry.targets, f.first.targets);
  assert.equal(
    (
      await pool.query("SELECT count(*)::int n FROM items WHERE user_id=$1", [
        f.user.id,
      ])
    ).rows[0].n,
    1,
  );
});
test("refreshed rules cannot bypass authorization using an old cached result", async () => {
  const f = await fixture();
  await replaceAssistantRules(f.user.id, {
    expected_revision: 1,
    rules: [
      {
        id: randomUUID(),
        lane: "background",
        action: "create",
        scope: { kind: "all" },
        decision: "deny",
      },
    ],
  });
  const current = await assistantPrincipal(f.user);
  current.assistant_lane = "background";
  await held(f, current);
});
test("narrowed Personal scope with an otherwise allowed capability holds cached private content", async () => {
  const f = await fixture();
  await pool.query("UPDATE agent_grants SET personal=false WHERE id=$1", [
    f.p.grant_id,
  ]);
  await held(f);
});
test("changing the server-selected lane holds an earlier lane's cached result", async () => {
  const f = await fixture();
  f.p.assistant_lane = "overnight";
  await held(f);
});
test("legacy assistant results without authority evidence are held without repeating work", async () => {
  const f = await fixture();
  await pool.query(
    "UPDATE mcp_request_state SET value=value-'assistant_authority' WHERE grant_id=$1 AND kind='client_ref'",
    [f.p.grant_id],
  );
  await held(f);
});
test("unchanged producing job and source evidence allow an idempotent replay", async () => {
  const f = await fixture(true);
  assert.equal((await f.call()).replayed, true);
});
test("source project excluded from AI holds the cached producing job result", async () => {
  const f = await fixture(true);
  await pool.query("UPDATE projects SET assistant_off=true WHERE id=$1", [
    f.project,
  ]);
  await held(f);
});
test("deleted source holds the cached result even when grant authority is unchanged", async () => {
  const f = await fixture(true);
  await pool.query("DELETE FROM docs WHERE id=$1", [f.doc]);
  await held(f);
});
test("unknown source evidence and deleted producing jobs cannot replay cached content", async () => {
  const f = await fixture(true);
  await pool.query("UPDATE ai_jobs SET sources_checked=false WHERE id=$1", [
    f.job,
  ]);
  await held(f);
  await pool.query("DELETE FROM ai_jobs WHERE id=$1", [f.job]);
  await held(f);
});
test("stricter trust holds the old completed result without making another proposal or task", async () => {
  const f = await fixture();
  await pool.query("UPDATE agent_grants SET trust='ask' WHERE id=$1", [
    f.p.grant_id,
  ]);
  await held(f);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM proposals WHERE user_id=$1",
        [f.user.id],
      )
    ).rows[0].n,
    0,
  );
});
test("authority digest ignores names and set ordering, but binds effective job and flags", async () => {
  const f = await fixture();
  const p = structuredClone(f.p);
  p.trust.spaces = { personal: "full", [randomUUID()]: "ask" };
  const before = assistantReplayAuthority(p);
  p.user.name = "Renamed owner";
  p.client.name = "Renamed assistant";
  p.toolsets.reverse();
  p.trust.spaces = Object.fromEntries(Object.entries(p.trust.spaces).reverse());
  assert.equal(assistantReplayAuthority(p), before);
  p.assistant_job_id = randomUUID();
  assert.notEqual(assistantReplayAuthority(p), before);
  delete p.assistant_job_id;
  p.flags.hide_outside_content = !p.flags.hide_outside_content;
  assert.notEqual(assistantReplayAuthority(p), before);
});
