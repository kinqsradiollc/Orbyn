import "./setup.js";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  assistantActionRules,
  assistantRuleDecision,
  type AssistantActionRule,
  HttpError,
} from "@orbyn/core";
import type { CapabilityContext } from "../src/capabilities/registry.js";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { assistantPrincipal } =
  await import("../src/modules/agents/assistant.js");
const { readAssistantRules, replaceAssistantRules } =
  await import("../src/modules/agents/assistant-rules.js");
const { destination } = await import("../src/capabilities/write.js");
const { execute } = await import("../src/capabilities/execute.js");
const { registry } = await import("../src/capabilities/index.js");
const { transaction } = await import("../src/db/pool.js");
const owners: string[] = [];
before(() => migrate());
after(async () => {
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [owners]);
  await pool.end();
});
async function person() {
  const id = randomUUID();
  owners.push(id);
  await pool.query(
    "INSERT INTO users(id,email,password_hash,name) VALUES($1,$2,'test','Rules tester')",
    [id, `rules-${id}@example.test`],
  );
  return assistantPrincipal({ id, name: "Rules tester", role: "member" });
}
const rule = (
  decision: AssistantActionRule["decision"],
  rest: Partial<AssistantActionRule> = {},
): AssistantActionRule => ({
  id: randomUUID(),
  lane: "background",
  action: "create",
  scope: { kind: "all" },
  decision,
  ...rest,
});
const status = (code: number) => (error: unknown) =>
  error instanceof HttpError && error.statusCode === code;

test("strict rules reject authority fields, duplicates, unknown actions and unbounded lists", () => {
  const one = rule("deny");
  assert.equal(
    assistantActionRules.safeParse([{ ...one, owner_id: randomUUID() }])
      .success,
    false,
  );
  assert.equal(assistantActionRules.safeParse([one, one]).success, false);
  assert.equal(
    assistantActionRules.safeParse([{ ...one, action: "execute_anything" }])
      .success,
    false,
  );
  assert.equal(
    assistantActionRules.safeParse(
      Array.from({ length: 101 }, () => rule("deny")),
    ).success,
    false,
  );
});
test("deny wins independent of order or specificity; lanes/actions/spaces remain distinct", () => {
  const team = randomUUID();
  const allow = rule("allow", { scope: { kind: "team", id: team } });
  const deny = rule("deny");
  const ask = rule("ask");
  for (const list of [
    [allow, ask, deny],
    [deny, allow, ask],
    [ask, deny, allow],
  ])
    assert.equal(
      assistantRuleDecision(list, "background", team, ["create"]),
      "deny",
    );
  assert.equal(
    assistantRuleDecision([allow, ask], "background", team, ["create"]),
    "ask",
  );
  assert.equal(
    assistantRuleDecision([allow], "overnight", team, ["create"]),
    null,
  );
  assert.equal(
    assistantRuleDecision([allow], "background", null, ["create"]),
    null,
  );
  assert.equal(
    assistantRuleDecision([allow], "background", team, ["edit"]),
    null,
  );
});
test("rule replacement preserves existing trust and serializes stale revisions", async () => {
  const p = await person();
  const first = await readAssistantRules(pool, p.user.id);
  assert.deepEqual(first, { revision: 1, rules: [] });
  const input = { expected_revision: 1, rules: [rule("deny")] };
  const attempts = await Promise.allSettled([
    replaceAssistantRules(p.user.id, input),
    replaceAssistantRules(p.user.id, input),
  ]);
  assert.equal(
    attempts.filter((result) => result.status === "fulfilled").length,
    1,
  );
  const failed = attempts.find((result) => result.status === "rejected");
  assert.ok(failed?.status === "rejected" && status(409)(failed.reason));
  assert.equal((await readAssistantRules(pool, p.user.id)).revision, 2);
  assert.equal(
    (
      await pool.query("SELECT trust FROM agent_grants WHERE id=$1", [
        p.grant_id,
      ])
    ).rows[0].trust,
    "full",
  );
  await assert.rejects(
    replaceAssistantRules(p.user.id, {
      expected_revision: 2,
      rules: [rule("allow", { scope: { kind: "team", id: randomUUID() } })],
    }),
    status(404),
  );
  await assert.rejects(readAssistantRules(pool, randomUUID()), status(404));
});
test("allow cannot defeat readonly, source reachability or unattended hard stops; deny survives approval", async () => {
  const p = await person();
  p.assistant_lane = "background";
  const ctx = {
    principal: p,
    asking: { mode: "approved", reviewed: true, reasons: [] },
  } as unknown as CapabilityContext;
  p.assistant_rules = [rule("allow", { action: "any_change" })];
  p.flags.readonly = true;
  assert.throws(() => destination(ctx, null, "W1"), /only read/);
  p.flags.readonly = false;
  assert.throws(() => destination(ctx, randomUUID(), "W1"), /reachable/);
  p.unattended = true;
  assert.equal(destination(ctx, null, "W3"), "review");
  p.assistant_rules = [rule("deny", { action: "any_change" })];
  assert.throws(() => destination(ctx, null, "W1"), /rule forbids/);
  p.unattended = false;
  p.assistant_rules = [rule("ask")];
  delete ctx.asking;
  assert.equal(destination(ctx, null, "W1"), "review");
});
test("actual writes load persisted current rules instead of caller-supplied allow snapshots", async () => {
  const p = await person();
  p.assistant_lane = "background";
  p.assistant_rules = [rule("allow")];
  await replaceAssistantRules(p.user.id, {
    expected_revision: 1,
    rules: [rule("deny")],
  });
  const call = () =>
    execute(
      registry,
      p,
      "create_tasks",
      { tasks: [{ title: "Held by typed rule" }] },
      { write: transaction },
    );
  const denied = await call();
  assert.equal(denied.outcome, "denied");
  assert.match(JSON.stringify(denied.result), /rules changed/);
  p.assistant_rules_revision = 2;
  const currentDeny = await call();
  assert.equal(currentDeny.outcome, "denied");
  assert.match(JSON.stringify(currentDeny.result), /rule forbids/);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM items WHERE user_id=$1",
        [p.user.id],
      )
    ).rows[0].n,
    0,
  );
  await replaceAssistantRules(p.user.id, { expected_revision: 2, rules: [] });
  p.assistant_rules_revision = 3;
  const allowed = await call();
  assert.equal(
    allowed.result.isError,
    undefined,
    JSON.stringify(allowed.result),
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM items WHERE user_id=$1",
        [p.user.id],
      )
    ).rows[0].n,
    1,
  );
});

test("a waiting approval cannot authorize rules edited after the card was shown", async () => {
  const { default: fastify } = await import("fastify");
  const logger = fastify();
  const { initialAssistantRun, answerAssistantApproval } =
    await import("../src/modules/ai/agent/run.js");
  const p = await person();
  const chat = randomUUID();
  await pool.query(
    "INSERT INTO ai_chats(id,user_id,title) VALUES($1,$2,'Rule revision approval')",
    [chat, p.user.id],
  );
  const envelope = initialAssistantRun({
    chat_id: chat,
    turn_id: randomUUID(),
    message: "Review",
    timezone: "UTC",
    history: [],
    scope: null,
  });
  const waitingId = randomUUID();
  envelope.state.waiting = {
    kind: "approval",
    id: waitingId,
    question: "Apply?",
    detail: "Plan",
    summary: "Plan",
    steps: [],
    assistant_rules_revision: 1,
  };
  const job = (
    await pool.query(
      "INSERT INTO ai_jobs(user_id,chat_id,state,run_state) VALUES($1,$2,'waiting',$3) RETURNING id",
      [p.user.id, chat, envelope],
    )
  ).rows[0].id;
  await replaceAssistantRules(p.user.id, {
    expected_revision: 1,
    rules: [rule("ask", { lane: "interactive" })],
  });
  const user = (
    await pool.query<import("../src/lib/auth.js").UserRow>(
      "SELECT * FROM users WHERE id=$1",
      [p.user.id],
    )
  ).rows[0];
  try {
    await assert.rejects(
      answerAssistantApproval(
        job,
        user,
        { approved: true, scope: "once", waiting_id: waitingId },
        logger.log,
      ),
      status(409),
    );
    const held = (
      await pool.query("SELECT state,run_state FROM ai_jobs WHERE id=$1", [job])
    ).rows[0];
    assert.equal(held.state, "waiting");
    assert.equal(held.run_state.state.waiting.id, waitingId);
    assert.equal(held.run_state.reviewed, undefined);
  } finally {
    await logger.close();
  }
});

test("rule edits wait for the actual in-flight capability transaction", async () => {
  const p = await person();
  p.assistant_lane = "background";
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let writerPid = 0;
  const writing = execute(
    registry,
    p,
    "create_tasks",
    { tasks: [{ title: "Serialized work" }] },
    {
      write: (run) =>
        transaction(async (db) => {
          writerPid = (await db.query("SELECT pg_backend_pid() AS pid")).rows[0]
            .pid;
          const answer = await run(db);
          enter();
          await held;
          return answer;
        }),
    },
  );
  await entered;
  const editing = replaceAssistantRules(p.user.id, {
    expected_revision: 1,
    rules: [rule("deny")],
  });
  let blocked = false;
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      const waiting = await pool.query(
        "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))",
        [writerPid],
      );
      if (waiting.rowCount) {
        blocked = true;
        break;
      }
      await delay(20);
    }
  } finally {
    release();
  }
  const [written, edited] = await Promise.all([writing, editing]);
  assert.equal(
    blocked,
    true,
    "Observe PostgreSQL blocking, rather than infer it from a timer",
  );
  assert.equal(
    written.result.isError,
    undefined,
    JSON.stringify(written.result),
  );
  assert.equal(edited.revision, 2);
  assert.equal(
    (await readAssistantRules(pool, p.user.id)).rules[0].decision,
    "deny",
  );
});

test("assistant identity respects stored access and Personal/team scope ceilings", async () => {
  const p = await person();
  await pool.query(
    "UPDATE agent_grants SET access='read',personal=false,team_ids='{}',flags=$2 WHERE id=$1",
    [p.grant_id, { hide_outside_content: true }],
  );
  const current = await assistantPrincipal(p.user);
  assert.equal(current.access, "read");
  assert.equal(current.personal, false);
  assert.deepEqual(current.team_ids, []);
  assert.deepEqual(current.teams, []);
  assert.equal(current.flags.hide_outside_content, true);
});

for (const unavailable of ["suspended_at=now()", "disabled=true"] as const) {
  test(`an existing assistant principal cannot read after ${unavailable}`, async () => {
    const p = await person();
    const doc = (
      await pool.query(
        "INSERT INTO docs(user_id,title,content) VALUES($1,'Private grant source',$2) RETURNING id",
        [
          p.user.id,
          JSON.stringify([
            { type: "paragraph", text: "Private grant evidence" },
          ]),
        ],
      )
    ).rows[0].id;
    const args = { id: `doc:${doc}` };
    assert.equal(
      (await execute(registry, p, "fetch", args)).result.isError,
      undefined,
    );
    await pool.query(
      `UPDATE ${unavailable === "disabled=true" ? "users" : "agent_grants"} SET ${unavailable} WHERE id=$1`,
      [unavailable === "disabled=true" ? p.user.id : p.grant_id],
    );
    const denied = await execute(registry, p, "fetch", args);
    assert.equal(denied.outcome, "denied");
    assert.doesNotMatch(
      JSON.stringify(denied.result),
      /Private grant evidence|Private grant source/,
    );
    const { withReadContext } = await import("../src/capabilities/execute.js");
    await assert.rejects(
      withReadContext(p, "fetch", args, async () => "must not run"),
      /paused or unavailable/,
    );
  });
}

test("a saved assistant principal cannot bypass narrowed scope/access on its next call", async () => {
  const p = await person();
  const doc = (
    await pool.query(
      "INSERT INTO docs(user_id,title) VALUES($1,'Personal source') RETURNING id",
      [p.user.id],
    )
  ).rows[0].id;
  await pool.query("UPDATE agent_grants SET personal=false WHERE id=$1", [
    p.grant_id,
  ]);
  const hidden = await execute(registry, p, "fetch", { id: `doc:${doc}` });
  assert.equal(hidden.outcome, "denied");
  assert.doesNotMatch(JSON.stringify(hidden.result), /Personal source/);
  await pool.query(
    "UPDATE agent_grants SET personal=true,access='read' WHERE id=$1",
    [p.grant_id],
  );
  const denied = await execute(
    registry,
    p,
    "create_tasks",
    { tasks: [{ title: "Must not be created" }] },
    { write: transaction },
  );
  assert.equal(denied.outcome, "denied");
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM items WHERE user_id=$1",
        [p.user.id],
      )
    ).rows[0].n,
    0,
  );
});

test("current assistant reads lose removed teams and writes observe current team role", async () => {
  const initial = await person();
  const team = (
    await pool.query(
      "INSERT INTO teams(name,created_by) VALUES('Grant scope team',$1) RETURNING id",
      [initial.user.id],
    )
  ).rows[0].id;
  try {
    await pool.query(
      "INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'owner')",
      [team, initial.user.id],
    );
    const p = await assistantPrincipal(initial.user);
    const doc = (
      await pool.query(
        "INSERT INTO docs(user_id,team_id,title) VALUES($1,$2,'Team evidence') RETURNING id",
        [p.user.id, team],
      )
    ).rows[0].id;
    assert.equal(
      (await execute(registry, p, "fetch", { id: `doc:${doc}` })).result
        .isError,
      undefined,
    );
    await pool.query("UPDATE agent_grants SET team_ids='{}' WHERE id=$1", [
      p.grant_id,
    ]);
    const hidden = await execute(registry, p, "fetch", { id: `doc:${doc}` });
    assert.equal(hidden.outcome, "denied");
    assert.doesNotMatch(JSON.stringify(hidden.result), /Team evidence/);
    await pool.query("UPDATE agent_grants SET team_ids=NULL WHERE id=$1", [
      p.grant_id,
    ]);
    await pool.query(
      "UPDATE team_members SET role='viewer' WHERE team_id=$1 AND user_id=$2",
      [team, p.user.id],
    );
    const held = await execute(
      registry,
      p,
      "create_tasks",
      { tasks: [{ title: "Viewer cannot create", team }] },
      { write: transaction },
    );
    assert.equal(held.outcome, "denied");
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM items WHERE team_id=$1",
          [team],
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await pool.query("DELETE FROM teams WHERE id=$1", [team]);
  }
});

test("caller restrictions remain ceilings even when the current stored grant is broader", async () => {
  const p = await person();
  p.personal = false;
  p.flags.readonly = true;
  const { withReadContext } = await import("../src/capabilities/execute.js");
  const current = await withReadContext(
    p,
    "get_context",
    {},
    async (ctx) => ctx.principal,
  );
  assert.equal(current.personal, false);
  assert.equal(current.flags.readonly, true);
  const held = await execute(
    registry,
    p,
    "create_tasks",
    { tasks: [{ title: "Caller ceiling" }] },
    { write: transaction },
  );
  assert.equal(held.outcome, "denied");
});
