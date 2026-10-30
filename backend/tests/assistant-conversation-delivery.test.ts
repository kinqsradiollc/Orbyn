import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { UserRow } from "../src/lib/auth.js";

process.env.ASSISTANT_CONVERSATION_ENABLED = "true";
const { env } = await import("../src/config/env.js");
const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { assistantPrincipal } =
  await import("../src/modules/agents/assistant.js");
const { openPersonalConversation } =
  await import("../src/modules/assistant-workspace/conversation-storage.js");
const { bindConversationWork, publishConversationIntent } =
  await import("../src/modules/assistant-workspace/conversation-delivery.js");
const { conversationFeed } =
  await import("../src/modules/assistant-workspace/conversation-feed.js");
const owners: string[] = [];
before(() => migrate());
after(async () => {
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [owners]);
  await pool.end();
});
async function fixture() {
  const owner = randomUUID();
  owners.push(owner);
  const user = (
    await pool.query<UserRow>(
      "INSERT INTO users(id,email,password_hash,name) VALUES($1,$2,'test','Delivery tester') RETURNING *",
      [owner, `delivery-${owner}@example.test`],
    )
  ).rows[0];
  const principal = await assistantPrincipal(user);
  await pool.query(
    "INSERT INTO agent_settings(user_id,reminder_nudges) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET reminder_nudges=$2",
    [owner, { quiet_start: "00:00", quiet_end: "00:00" }],
  );
  const destination = await transaction((db) =>
    openPersonalConversation(db, owner),
  );
  return { owner, user, principal, destination };
}
async function work(f: Awaited<ReturnType<typeof fixture>>, checked = true) {
  const id = randomUUID();
  const chatId = randomUUID();
  await pool.query(
    "INSERT INTO ai_chats(id,user_id,title,origin) VALUES($1,$2,'Independent work','task')",
    [chatId, f.owner],
  );
  await pool.query(
    "INSERT INTO ai_jobs(id,user_id,chat_id,state,run_origin,sources_checked) VALUES($1,$2,$3,'queued','task',$4)",
    [id, f.owner, chatId, checked],
  );
  await transaction((db) =>
    bindConversationWork(db, {
      ownerId: f.owner,
      work: { kind: "job", id },
      lane: "background",
      timezone: "UTC",
    }),
  );
  return id;
}
async function complete(id: string) {
  await pool.query("UPDATE ai_jobs SET state='done',result=$2 WHERE id=$1", [
    id,
    { answer: "A useful result" },
  ]);
  return (
    await pool.query<{ id: string }>(
      "SELECT i.id FROM assistant_delivery_intents i JOIN assistant_delivery_bindings b ON b.id=i.binding_id WHERE b.work_id=$1",
      [id],
    )
  ).rows[0].id;
}

test("bounded navigation sources retain authority over every publication dependency", async () => {
  const f = await fixture(),
    id = await work(f);
  const docs = Array.from({ length: 501 }, () => randomUUID());
  await pool.query(
    "INSERT INTO docs(id,user_id,title) SELECT id,$1,'Evidence' FROM unnest($2::uuid[]) id",
    [f.owner, docs],
  );
  await pool.query(
    "INSERT INTO assistant_job_sources(job_id,source_kind,source_id) SELECT $1,'doc',id FROM unnest($2::uuid[]) id",
    [id, docs],
  );
  const intent = await complete(id);
  assert.equal(
    await transaction((db) => publishConversationIntent(db, intent)),
    true,
  );
  const entry = (await conversationFeed(pool, f.owner, f.destination.id, {}))
    .entries[0];
  assert.equal(entry.kind, "update");
  if (entry.kind !== "update") return;
  assert.equal(entry.sources.length, 500);
  const omitted = docs.find(
    (doc) => !entry.sources.some((source) => source.id === doc),
  );
  assert.ok(omitted);
  await pool.query("DELETE FROM docs WHERE id=$1", [omitted]);
  assert.equal(
    (await conversationFeed(pool, f.owner, f.destination.id, {})).entries
      .length,
    0,
  );
});

test("execution retention preserves the published timeline under current source and grant authority", async () => {
  const f = await fixture(),
    id = await work(f);
  const grant = (
    await pool.query<{ id: string }>(
      "INSERT INTO agent_grants(user_id,kind,client_id,access,personal,team_ids) VALUES($1,'oauth','https://retention.invalid','write',true,'{}') RETURNING id",
      [f.owner],
    )
  ).rows[0].id;
  await pool.query(
    "UPDATE assistant_delivery_bindings SET grant_id=$2 WHERE work_id=$1",
    [id, grant],
  );
  const intent = await complete(id);
  await pool.query(
    "UPDATE ai_jobs SET created_at=now()-interval '2 days' WHERE id=$1",
    [id],
  );
  const { SWEEP_RULES } = await import("../src/lib/sweep.js");
  const rule = SWEEP_RULES.find((r) => r.key === "ai_jobs")!;
  assert.equal(
    (
      await pool.query(
        `SELECT 1 FROM ai_jobs WHERE id=$1 AND (${rule.where})`,
        [id],
      )
    ).rowCount,
    0,
    "An unpublished completion survives retention until the publisher records its outcome",
  );
  await transaction((db) => publishConversationIntent(db, intent));
  const before = await conversationFeed(pool, f.owner, f.destination.id, {});
  assert.equal(before.entries.length, 1);
  await pool.query(
    "UPDATE ai_jobs SET created_at=now()-interval '2 days' WHERE id=$1",
    [id],
  );
  assert.equal(
    (
      await pool.query(`DELETE FROM ai_jobs WHERE id=$1 AND (${rule.where})`, [
        id,
      ])
    ).rowCount,
    1,
    "Use the real execution retention rule",
  );
  assert.deepEqual(
    (await conversationFeed(pool, f.owner, f.destination.id, {})).entries,
    before.entries,
    "Execution cleanup must not erase retained history",
  );
  await pool.query("UPDATE agent_grants SET revoked_at=now() WHERE id=$1", [
    grant,
  ]);
  assert.equal(
    (await conversationFeed(pool, f.owner, f.destination.id, {})).entries
      .length,
    0,
    "Archived history still needs its current grant",
  );
});

test("retained source-entry authority survives execution cleanup without losing revocation", async () => {
  const f = await fixture(),
    id = await work(f),
    sourceChat = randomUUID(),
    turn = randomUUID();
  const { registerOriginConversation, retainConversationTurn } =
    await import("../src/modules/assistant-workspace/conversation-storage.js");
  await pool.query(
    "INSERT INTO ai_chats(id,user_id,title,origin) VALUES($1,$2,'Source context','person')",
    [sourceChat, f.owner],
  );
  const source = await transaction(async (db) => {
    const source = await registerOriginConversation(db, f.owner, sourceChat);
    await retainConversationTurn(db, f.owner, sourceChat, {
      role: "user",
      text: "A source-dependent request",
      turn_id: randomUUID(),
    });
    return source;
  });
  const sourceEntry = (await conversationFeed(pool, f.owner, source.id, {}))
    .entries[0].id;
  const executionChat = (
    await pool.query(
      "UPDATE ai_jobs SET turn_id=$2 WHERE id=$1 RETURNING chat_id",
      [id, turn],
    )
  ).rows[0].chat_id;
  await pool.query(
    "INSERT INTO assistant_turn_entry_sources(chat_id,turn_id,source_entry_id) VALUES($1,$2,$3)",
    [executionChat, turn, sourceEntry],
  );
  const intent = await complete(id);
  await transaction((db) => publishConversationIntent(db, intent));
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM assistant_delivery_entry_sources s JOIN assistant_delivery_bindings b ON b.id=s.binding_id WHERE b.work_id=$1 AND s.source_entry_id=$2",
        [id, sourceEntry],
      )
    ).rowCount,
    1,
  );
  await pool.query("DELETE FROM ai_jobs WHERE id=$1", [id]);
  await pool.query("DELETE FROM ai_chats WHERE id=$1", [executionChat]);
  assert.equal(
    (await conversationFeed(pool, f.owner, f.destination.id, {})).entries
      .length,
    1,
    "Execution rows can be removed after publication",
  );
  const retainedUpdate = (
    await conversationFeed(pool, f.owner, f.destination.id, {})
  ).entries[0];
  assert.equal(
    retainedUpdate.kind === "update"
      ? retainedUpdate.execution_chat_id
      : "wrong kind",
    null,
    "Do not offer a link to a deleted execution chat",
  );
  await pool.query("DELETE FROM ai_chats WHERE id=$1", [sourceChat]);
  assert.equal(
    (await conversationFeed(pool, f.owner, f.destination.id, {})).entries
      .length,
    0,
    "A deleted source still invalidates retained output",
  );
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM assistant_delivery_entry_sources s JOIN assistant_delivery_bindings b ON b.id=s.binding_id WHERE b.work_id=$1 AND s.source_entry_id=$2",
        [id, sourceEntry],
      )
    ).rowCount,
    1,
    "Missing source identities must not cascade away",
  );
  await pool.query("DELETE FROM ai_chats WHERE id=$1", [f.destination.chat_id]);
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM assistant_delivery_entry_sources s JOIN assistant_delivery_bindings b ON b.id=s.binding_id WHERE b.work_id=$1",
        [id],
      )
    ).rowCount,
    0,
    "Retiring the derived owner erases its outgoing source metadata",
  );
});

test("removing an unpublished execution cannot authorize a new timeline entry", async () => {
  const f = await fixture(),
    id = await work(f),
    intent = await complete(id);
  await pool.query("DELETE FROM ai_jobs WHERE id=$1", [id]);
  assert.equal(
    await transaction((db) => publishConversationIntent(db, intent)),
    false,
  );
  assert.equal(
    (await conversationFeed(pool, f.owner, f.destination.id, {})).entries
      .length,
    0,
  );
});

test("explicit automation inherits selected-update authority from its exact originating turn", async () => {
  const f = await fixture(),
    sourceJob = await work(f);
  const grant = (
    await pool.query<{ id: string }>(
      "INSERT INTO agent_grants(user_id,kind,client_id,access,personal,team_ids) VALUES($1,'oauth','https://origin-lineage.invalid','write',true,'{}') RETURNING id",
      [f.owner],
    )
  ).rows[0].id;
  await pool.query(
    "UPDATE assistant_delivery_bindings SET grant_id=$2 WHERE work_id=$1",
    [sourceJob, grant],
  );
  const intent = await complete(sourceJob);
  await transaction((db) => publishConversationIntent(db, intent));
  const update = (await conversationFeed(pool, f.owner, f.destination.id, {}))
    .entries[0];
  const turn = randomUUID();
  const { prepareConversationContext } =
    await import("../src/modules/assistant-workspace/conversation-context.js");
  const { retainConversationTurn } =
    await import("../src/modules/assistant-workspace/conversation-storage.js");
  await transaction(async (db) => {
    await prepareConversationContext(
      db,
      f.owner,
      f.destination.chat_id,
      turn,
      update.id,
    );
    await retainConversationTurn(db, f.owner, f.destination.chat_id, {
      role: "user",
      text: "Continue this in Background",
      turn_id: turn,
    });
  });
  const { startAssistantAutomation } =
    await import("../src/modules/ai/agent/run.js");
  const child = await startAssistantAutomation({
    userId: f.owner,
    title: "Explicit follow-up",
    message: "Continue the selected finding",
    timezone: "UTC",
    automation: { kind: "task" },
    deliveryOrigin: { chatId: f.destination.chat_id, turnId: turn },
  });
  assert.ok(child);
  await assert.rejects(
    transaction((db) =>
      bindConversationWork(db, {
        ownerId: f.owner,
        work: { kind: "job", id: child },
        lane: "background",
        timezone: "UTC",
        origin: { chatId: f.destination.chat_id, turnId: randomUUID() },
      }),
    ),
    /originating turn is unavailable/,
  );
  await pool.query("UPDATE ai_jobs SET sources_checked=true WHERE id=$1", [
    child,
  ]);
  const { assistantJobSourcesVisible } =
    await import("../src/lib/assistant-job-sources.js");
  const visible = async () =>
    (
      await pool.query(
        `SELECT j.id FROM ai_jobs j WHERE j.id=$2 AND ${assistantJobSourcesVisible("j", "$1", false)}`,
        [f.owner, child],
      )
    ).rowCount;
  assert.equal(await visible(), 1);
  await pool.query("UPDATE agent_grants SET revoked_at=now() WHERE id=$1", [
    grant,
  ]);
  assert.equal(
    await visible(),
    0,
    "The receiving job must recheck the original selected update's grant",
  );
});

test("completion and intent roll back together", async () => {
  const f = await fixture();
  const id = await work(f);
  await assert.rejects(
    transaction(async (db) => {
      await db.query("UPDATE ai_jobs SET state='done',result=$2 WHERE id=$1", [
        id,
        { answer: "Rolled back" },
      ]);
      throw new Error("crash before commit");
    }),
    /crash before commit/,
  );
  assert.equal(
    (await pool.query("SELECT state FROM ai_jobs WHERE id=$1", [id])).rows[0]
      .state,
    "queued",
  );
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM assistant_delivery_intents i JOIN assistant_delivery_bindings b ON b.id=i.binding_id WHERE b.work_id=$1",
        [id],
      )
    ).rowCount,
    0,
  );
});

test("concurrent replay publishes one entry and one logical alert without acquiring the foreground slot", async () => {
  const f = await fixture();
  const first = await work(f);
  const second = await work(f);
  const intent = await complete(first);
  const publications = await Promise.all([
    transaction((db) => publishConversationIntent(db, intent)),
    transaction((db) => publishConversationIntent(db, intent)),
  ]);
  assert.equal(publications.filter(Boolean).length, 1);
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM assistant_conversation_entries WHERE intent_id=$1",
        [intent],
      )
    ).rowCount,
    1,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM assistant_conversation_alerts a JOIN assistant_conversation_entries e ON e.id=a.entry_id WHERE e.intent_id=$1",
        [intent],
      )
    ).rowCount,
    1,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM ai_jobs WHERE chat_id=$1 AND state IN ('queued','running','waiting')",
        [f.destination.chat_id],
      )
    ).rowCount,
    0,
  );
  assert.equal(
    (await pool.query("SELECT state FROM ai_jobs WHERE id=$1", [second]))
      .rows[0].state,
    "queued",
  );
  assert.equal(
    (await conversationFeed(pool, f.owner, f.destination.id, {})).entries
      .length,
    1,
  );
});

test("publisher crash rolls back entry, alert, cursor and publication receipt", async () => {
  const f = await fixture();
  const intent = await complete(await work(f));
  await assert.rejects(
    transaction(async (db) => {
      assert.equal(await publishConversationIntent(db, intent), true);
      throw new Error("crash");
    }),
    /crash/,
  );
  assert.equal(
    (await conversationFeed(pool, f.owner, f.destination.id, {})).cursor,
    "0",
  );
  assert.equal(
    (
      await pool.query(
        "SELECT state FROM assistant_delivery_intents WHERE id=$1",
        [intent],
      )
    ).rows[0].state,
    "pending",
  );
  assert.equal(
    await transaction((db) => publishConversationIntent(db, intent)),
    true,
  );
});

test("unknown provenance and revoked grants block delivery; published dependencies are rechecked", async () => {
  const f = await fixture();
  const unknown = await complete(await work(f, false));
  assert.equal(
    await transaction((db) => publishConversationIntent(db, unknown)),
    false,
  );
  const intent = await complete(await work(f));
  assert.equal(
    await transaction((db) => publishConversationIntent(db, intent)),
    true,
  );
  const next = await complete(await work(f));
  await pool.query("UPDATE agent_grants SET suspended_at=now() WHERE id=$1", [
    f.principal.grant_id,
  ]);
  assert.equal(
    (await conversationFeed(pool, f.owner, f.destination.id, {})).entries
      .length,
    0,
  );
  assert.equal(
    await transaction((db) => publishConversationIntent(db, next)),
    false,
  );
});

test("rollout disable parks bound intent, and re-enable reuses its identity", async () => {
  const f = await fixture();
  const intent = await complete(await work(f));
  env.ASSISTANT_CONVERSATION_ENABLED = "false";
  try {
    assert.equal(
      await transaction((db) => publishConversationIntent(db, intent)),
      false,
    );
  } finally {
    env.ASSISTANT_CONVERSATION_ENABLED = "true";
  }
  assert.equal(
    (
      await pool.query(
        "SELECT state FROM assistant_delivery_intents WHERE id=$1",
        [intent],
      )
    ).rows[0].state,
    "pending",
  );
  assert.equal(
    await transaction((db) => publishConversationIntent(db, intent)),
    true,
  );
});

test("automation admission binds independently and explicit origins win", async () => {
  const f = await fixture();
  const { startAssistantAutomation } =
    await import("../src/modules/ai/agent/run.js");
  const origin = randomUUID();
  await pool.query(
    "INSERT INTO ai_chats(id,user_id,title) VALUES($1,$2,'Origin')",
    [origin, f.owner],
  );
  const id = await startAssistantAutomation({
    userId: f.owner,
    message: "Do this independently",
    timezone: "UTC",
    automation: { kind: "task" },
    deliveryOrigin: { chatId: origin },
  });
  assert.ok(id);
  const row = (
    await pool.query(
      "SELECT b.reason,s.chat_id,j.chat_id AS execution_chat FROM assistant_delivery_bindings b JOIN assistant_conversation_streams s ON s.id=b.destination_id JOIN ai_jobs j ON j.id=b.work_id WHERE b.work_id=$1",
      [id],
    )
  ).rows[0];
  assert.equal(row.reason, "origin");
  assert.equal(row.chat_id, origin);
  assert.notEqual(row.execution_chat, origin);
  assert.notEqual(row.chat_id, f.destination.chat_id);
  await assert.rejects(
    startAssistantAutomation({
      userId: f.owner,
      message: "No fallback",
      timezone: "UTC",
      automation: { kind: "task" },
      deliveryOrigin: { chatId: randomUUID() },
    }),
  );
});

test("each waiting question has its own durable target and duplicate transitions do not duplicate entries", async () => {
  const f = await fixture();
  const ids = [await work(f), await work(f)];
  const waiting = [randomUUID(), randomUUID()];
  for (let n = 0; n < 2; n++) {
    await pool.query(
      "UPDATE ai_jobs SET state='waiting',run_state=$2 WHERE id=$1",
      [
        ids[n],
        {
          state: {
            waiting: {
              kind: "person",
              id: waiting[n],
              question: `Question ${n}`,
            },
          },
        },
      ],
    );
    const intent = (
      await pool.query(
        "SELECT i.id FROM assistant_delivery_intents i JOIN assistant_delivery_bindings b ON b.id=i.binding_id WHERE b.work_id=$1",
        [ids[n]],
      )
    ).rows[0].id;
    assert.equal(
      await transaction((db) => publishConversationIntent(db, intent)),
      true,
    );
    await pool.query("UPDATE ai_jobs SET state='queued' WHERE id=$1", [ids[n]]);
    await pool.query("UPDATE ai_jobs SET state='waiting' WHERE id=$1", [
      ids[n],
    ]);
  }
  const page = await conversationFeed(pool, f.owner, f.destination.id, {});
  assert.equal(page.entries.length, 2);
  assert.deepEqual(
    page.entries.map((e) => (e.kind === "update" ? e.waiting_id : null)),
    waiting,
  );
  assert.deepEqual(
    page.entries.map(
      (e) => e.kind === "update" && [e.waiting_kind, e.actionable],
    ),
    [
      ["person", true],
      ["person", true],
    ],
  );
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM assistant_delivery_intents i JOIN assistant_delivery_bindings b ON b.id=i.binding_id WHERE b.owner_id=$1",
        [f.owner],
      )
    ).rowCount,
    2,
  );
});

test("deferred questions that were answered, cancelled or replaced never publish a stale request", async () => {
  const f = await fixture();
  for (const outcome of ["queued", "cancelled", "replaced"] as const) {
    const id = await work(f);
    const waitingId = randomUUID();
    await pool.query(
      "UPDATE ai_jobs SET state='waiting',run_state=$2 WHERE id=$1",
      [
        id,
        {
          state: {
            waiting: {
              kind: "person",
              id: waitingId,
              question: "Choose a task",
            },
          },
        },
      ],
    );
    const intent = (
      await pool.query(
        "SELECT i.id FROM assistant_delivery_intents i JOIN assistant_delivery_bindings b ON b.id=i.binding_id WHERE b.work_id=$1",
        [id],
      )
    ).rows[0].id;
    await pool.query(
      "UPDATE assistant_delivery_intents SET state='deferred' WHERE id=$1",
      [intent],
    );
    if (outcome === "replaced") {
      await pool.query("UPDATE ai_jobs SET run_state=$2 WHERE id=$1", [
        id,
        {
          state: {
            waiting: {
              kind: "person",
              id: randomUUID(),
              question: "A newer question",
            },
          },
        },
      ]);
    } else {
      await pool.query("UPDATE ai_jobs SET state=$2 WHERE id=$1", [
        id,
        outcome === "cancelled" ? "failed" : outcome,
      ]);
    }
    assert.equal(
      await transaction((db) => publishConversationIntent(db, intent)),
      false,
    );
    assert.deepEqual(
      (
        await pool.query(
          "SELECT state,reason FROM assistant_delivery_intents WHERE id=$1",
          [intent],
        )
      ).rows[0],
      { state: "suppressed", reason: "resolved" },
    );
    assert.equal(
      (
        await pool.query(
          "SELECT 1 FROM assistant_conversation_entries WHERE intent_id=$1",
          [intent],
        )
      ).rowCount,
      0,
    );
  }
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM assistant_conversation_alerts a JOIN assistant_conversation_entries e ON e.id=a.entry_id JOIN assistant_conversation_streams s ON s.id=e.destination_id WHERE s.owner_id=$1",
        [f.owner],
      )
    ).rowCount,
    0,
  );
});

test("published waiting metadata follows the exact current question without rewriting history", async () => {
  const f = await fixture();
  const id = await work(f);
  const waitingId = randomUUID();
  await pool.query(
    "UPDATE ai_jobs SET state='waiting',run_state=$2 WHERE id=$1",
    [
      id,
      {
        state: {
          waiting: {
            kind: "approval",
            id: waitingId,
            question: "Review this plan",
          },
        },
      },
    ],
  );
  const intent = (
    await pool.query(
      "SELECT i.id FROM assistant_delivery_intents i JOIN assistant_delivery_bindings b ON b.id=i.binding_id WHERE b.work_id=$1",
      [id],
    )
  ).rows[0].id;
  assert.equal(
    await transaction((db) => publishConversationIntent(db, intent)),
    true,
  );
  const before = (await conversationFeed(pool, f.owner, f.destination.id, {}))
    .entries[0];
  assert.equal(before.kind, "update");
  if (before.kind !== "update") return;
  assert.equal(before.waiting_kind, "approval");
  assert.equal(before.actionable, true);
  await pool.query("UPDATE ai_jobs SET run_state=$2 WHERE id=$1", [
    id,
    {
      state: {
        waiting: { kind: "person", id: randomUUID(), question: "New question" },
      },
    },
  ]);
  const after = (await conversationFeed(pool, f.owner, f.destination.id, {}))
    .entries[0];
  assert.equal(after.kind, "update");
  if (after.kind !== "update") return;
  assert.equal(after.id, before.id);
  assert.equal(after.text, before.text);
  assert.equal(after.waiting_kind, null);
  assert.equal(after.actionable, false);
  const { flushConversationAlerts } =
    await import("../src/modules/assistant-workspace/conversation-notifications.js");
  assert.equal(await flushConversationAlerts(new Date(), f.owner), 0);
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM notifications WHERE user_id=$1 AND kind='assistant'",
        [f.owner],
      )
    ).rowCount,
    0,
  );
});

test("maintained-page state transitions use the same publication and source visibility contract", async () => {
  const f = await fixture();
  const doc = randomUUID();
  const binding = randomUUID();
  const run = randomUUID();
  await pool.query(
    "INSERT INTO docs(id,user_id,title) VALUES($1,$2,'Maintained page')",
    [doc, f.owner],
  );
  await pool.query(
    "INSERT INTO assistant_page_bindings(id,doc_id,user_id,agent_grant_id,snapshot,instruction,rrule,timezone,next_run_at) VALUES($1,$2,$3,$4,$5,'Keep current','FREQ=DAILY','UTC',now())",
    [
      binding,
      doc,
      f.owner,
      f.principal.grant_id,
      { blocks: [{ block_id: "first" }] },
    ],
  );
  await pool.query(
    "INSERT INTO assistant_page_runs(id,binding_id,user_id,agent_grant_id,binding_revision,doc_version,assistant_rules_revision,lane,scheduled_for) VALUES($1,$2,$3,$4,1,1,1,'background',now())",
    [run, binding, f.owner, f.principal.grant_id],
  );
  await transaction((db) =>
    bindConversationWork(db, {
      ownerId: f.owner,
      work: { kind: "page_run", id: run },
      lane: "background",
      timezone: "UTC",
      grantId: f.principal.grant_id!,
      sourcesChecked: true,
      sources: [{ kind: "doc", id: doc }],
    }),
  );
  await pool.query("UPDATE assistant_page_runs SET state='done' WHERE id=$1", [
    run,
  ]);
  const intent = (
    await pool.query(
      "SELECT i.id FROM assistant_delivery_intents i JOIN assistant_delivery_bindings b ON b.id=i.binding_id WHERE b.work_id=$1",
      [run],
    )
  ).rows[0].id;
  assert.equal(
    await transaction((db) => publishConversationIntent(db, intent)),
    true,
  );
  assert.equal(
    (await conversationFeed(pool, f.owner, f.destination.id, {})).entries
      .length,
    1,
  );
  await pool.query("DELETE FROM docs WHERE id=$1", [doc]);
  assert.equal(
    (await conversationFeed(pool, f.owner, f.destination.id, {})).entries
      .length,
    0,
  );
});

test("reply context targets one update, snapshots its identity and rejects revoked or cross-conversation targets", async () => {
  const { prepareConversationContext, assertConversationContext } =
    await import("../src/modules/assistant-workspace/conversation-context.js");
  const f = await fixture();
  const id = await work(f);
  const doc = randomUUID();
  await pool.query(
    "INSERT INTO docs(id,user_id,title) VALUES($1,$2,'Reply source')",
    [doc, f.owner],
  );
  await pool.query(
    "INSERT INTO assistant_job_sources(job_id,source_kind,source_id) VALUES($1,'doc',$2)",
    [id, doc],
  );
  const intent = await complete(id);
  await transaction((db) => publishConversationIntent(db, intent));
  const target = (await conversationFeed(pool, f.owner, f.destination.id, {}))
    .entries[0];
  const turnId = randomUUID();
  const context = await transaction((db) =>
    prepareConversationContext(
      db,
      f.owner,
      f.destination.chat_id,
      turnId,
      target.id,
    ),
  );
  assert.ok(context);
  assert.ok(context.history.at(-1)?.content.includes(`job:${id}`));
  assert.deepEqual(context.identity.entry_ids, [target.id]);
  const otherIntent = await complete(await work(f));
  await transaction((db) => publishConversationIntent(db, otherIntent));
  await assertConversationContext(pool, f.owner, context.identity);
  assert.deepEqual(
    context.identity.entry_ids,
    [target.id],
    "new update does not join admitted context",
  );
  const other = await fixture();
  await assert.rejects(
    transaction((db) =>
      prepareConversationContext(
        db,
        other.owner,
        other.destination.chat_id,
        randomUUID(),
        target.id,
      ),
    ),
  );
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM assistant_chat_sources WHERE chat_id=$1 AND turn_id=$2 AND source_id=$3",
        [f.destination.chat_id, turnId, doc],
      )
    ).rowCount,
    1,
  );
  await pool.query("DELETE FROM docs WHERE id=$1", [doc]);
  await assert.rejects(
    assertConversationContext(pool, f.owner, context.identity),
    /sources for this reply changed/,
  );
  await assert.rejects(
    transaction((db) =>
      prepareConversationContext(
        db,
        f.owner,
        f.destination.chat_id,
        randomUUID(),
        target.id,
      ),
    ),
  );
  const unrelated = await transaction((db) =>
    prepareConversationContext(
      db,
      f.owner,
      f.destination.chat_id,
      randomUUID(),
    ),
  );
  assert.ok(unrelated);
  assert.deepEqual(
    unrelated.history,
    [],
    "unrelated updates do not silently enter provider history",
  );
});

test("publication defers through quiet hours without publishing or consuming the alert", async () => {
  const f = await fixture();
  const intent = await complete(await work(f));
  await pool.query(
    "UPDATE agent_settings SET reminder_nudges=$2 WHERE user_id=$1",
    [f.owner, { quiet_start: "22:00", quiet_end: "08:00" }],
  );
  assert.equal(
    await transaction((db) =>
      publishConversationIntent(db, intent, new Date("2090-01-01T23:00:00Z")),
    ),
    false,
  );
  const deferred = (
    await pool.query(
      "SELECT state,available_at FROM assistant_delivery_intents WHERE id=$1",
      [intent],
    )
  ).rows[0];
  assert.equal(deferred.state, "deferred");
  assert.equal(deferred.available_at.toISOString(), "2090-01-02T08:00:00.000Z");
  assert.equal(
    (await conversationFeed(pool, f.owner, f.destination.id, {})).entries
      .length,
    0,
  );
  assert.equal(
    await transaction((db) =>
      publishConversationIntent(db, intent, new Date("2090-01-02T08:00:00Z")),
    ),
    true,
  );
});

test("source revision equality alone never suppresses a fresh useful report", async () => {
  const f = await fixture();
  const doc = randomUUID();
  await pool.query(
    "INSERT INTO docs(id,user_id,title) VALUES($1,$2,'Tracked source')",
    [doc, f.owner],
  );
  const run = async (text: string) => {
    const id = await work(f);
    await pool.query(
      "UPDATE assistant_delivery_bindings SET attention_key='same-check' WHERE work_id=$1",
      [id],
    );
    const { recordAssistantSources } =
      await import("../src/lib/assistant-job-sources.js");
    const source = (
      await pool.query("SELECT version FROM docs WHERE id=$1", [doc])
    ).rows[0];
    await recordAssistantSources(id, f.owner, {
      kind: "doc",
      id: doc,
      version: source.version,
    });
    const intent = await complete(id);
    await pool.query(
      "UPDATE assistant_delivery_intents SET payload=jsonb_set(payload,'{text}',to_jsonb($2::text)) WHERE id=$1",
      [intent, text],
    );
    return {
      intent,
      published: await transaction((db) =>
        publishConversationIntent(db, intent),
      ),
    };
  };
  assert.equal((await run("First wording")).published, true);
  const repeated = await run("Different model wording");
  assert.equal(repeated.published, true);
  assert.equal(
    (
      await pool.query(
        "SELECT reason FROM assistant_delivery_intents WHERE id=$1",
        [repeated.intent],
      )
    ).rows[0].reason,
    null,
  );
  await pool.query(
    "UPDATE docs SET version=version+1,updated_at=clock_timestamp() WHERE id=$1",
    [doc],
  );
  assert.equal((await run("The source changed")).published, true);
  assert.equal(
    (await conversationFeed(pool, f.owner, f.destination.id, {})).entries
      .length,
    3,
  );
});

test("logical alerts queue once, hide sensitive text, share read state and recheck source permission before transport", async () => {
  const { flushConversationAlerts } =
    await import("../src/modules/assistant-workspace/conversation-notifications.js");
  const { acknowledgeConversation } =
    await import("../src/modules/assistant-workspace/conversation-feed.js");
  const { assistantNoticeStale } = await import("../src/worker/delivery.js");
  const f = await fixture();
  const intent = await complete(await work(f));
  await pool.query("INSERT INTO devices(user_id,token) VALUES($1,$2)", [
    f.owner,
    `fixture-push-${randomUUID()}`,
  ]);
  await transaction((db) => publishConversationIntent(db, intent));
  assert.equal(await flushConversationAlerts(new Date(), f.owner), 1);
  assert.equal(await flushConversationAlerts(new Date(), f.owner), 0);
  const notices = (
    await pool.query(
      "SELECT id,body,ref,channel,read FROM notifications WHERE user_id=$1 AND ref LIKE 'conversation:%'",
      [f.owner],
    )
  ).rows;
  assert.equal(notices.length, 2);
  assert.ok(notices.every((n) => n.body === "An assistant update is ready."));
  assert.equal(
    await transaction((db) =>
      assistantNoticeStale(db, { user_id: f.owner, ref: notices[0].ref }),
    ),
    false,
  );
  await transaction((db) =>
    acknowledgeConversation(db, f.owner, f.destination.id, { through: "1" }),
  );
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM notifications WHERE user_id=$1 AND NOT read AND ref LIKE 'conversation:%'",
        [f.owner],
      )
    ).rowCount,
    0,
  );
  assert.equal(
    await transaction((db) =>
      assistantNoticeStale(db, { user_id: f.owner, ref: notices[0].ref }),
    ),
    true,
  );
});

test("mute keeps published history and execution, while suppressing alerts only", async () => {
  const { flushConversationAlerts } =
    await import("../src/modules/assistant-workspace/conversation-notifications.js");
  const f = await fixture();
  await pool.query(
    "UPDATE agent_settings SET conversation_updates_muted=true WHERE user_id=$1",
    [f.owner],
  );
  const id = await work(f);
  const intent = await complete(id);
  assert.equal(
    await transaction((db) => publishConversationIntent(db, intent)),
    true,
  );
  assert.equal(
    (await conversationFeed(pool, f.owner, f.destination.id, {})).entries
      .length,
    1,
  );
  assert.equal(await flushConversationAlerts(new Date(), f.owner), 0);
  assert.equal(
    (await pool.query("SELECT state FROM ai_jobs WHERE id=$1", [id])).rows[0]
      .state,
    "done",
  );
  assert.equal(
    (
      await pool.query("SELECT 1 FROM notifications WHERE user_id=$1", [
        f.owner,
      ])
    ).rowCount,
    0,
  );
});

test("Overnight publishes one morning summary and revises it for late work without another alert", async () => {
  const { queueOvernightNotices } =
    await import("../src/worker/overnight-notices.js");
  const { flushConversationAlerts } =
    await import("../src/modules/assistant-workspace/conversation-notifications.js");
  const { startAssistantAutomation } =
    await import("../src/modules/ai/agent/run.js");
  const f = await fixture();
  const night = randomUUID();
  const end = new Date(Date.now() - 60000);
  await pool.query(
    "INSERT INTO assistant_nights(id,user_id,local_day,summary) VALUES($1,$2,current_date,$3)",
    [night, f.owner, { end_at: end.toISOString() }],
  );
  await transaction((db) =>
    bindConversationWork(db, {
      ownerId: f.owner,
      work: { kind: "night", id: night },
      lane: "overnight",
      timezone: "UTC",
      sourcesChecked: true,
      notBefore: end,
    }),
  );
  const child = async () => {
    const id = await startAssistantAutomation({
      userId: f.owner,
      message: "Night task",
      timezone: "UTC",
      automation: {
        kind: "night",
        night_id: night,
        night_kind: "tidy",
        end_at: end.toISOString(),
      },
      onQueued: async (db, id) => {
        await db.query("UPDATE ai_jobs SET sources_checked=true WHERE id=$1", [
          id,
        ]);
      },
    });
    assert.ok(id);
    return complete(id);
  };
  const first = await child();
  assert.equal(
    await transaction((db) => publishConversationIntent(db, first)),
    false,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT reason FROM assistant_delivery_intents WHERE id=$1",
        [first],
      )
    ).rows[0].reason,
    "night_summary",
  );
  const morning = async () => {
    const { flushConversationDeliveries } =
      await import("../src/modules/assistant-workspace/conversation-delivery.js");
    await flushConversationDeliveries({ onlyOwner: f.owner });
    await queueOvernightNotices(new Date(), [f.owner]);
    const intent = (
      await pool.query(
        "SELECT i.id FROM assistant_delivery_intents i JOIN assistant_delivery_bindings b ON b.id=i.binding_id WHERE b.work_kind='night' AND b.work_id=$1",
        [night],
      )
    ).rows[0].id;
    await transaction((db) => publishConversationIntent(db, intent));
    return (await conversationFeed(pool, f.owner, f.destination.id, {}))
      .entries[0];
  };
  const initial = await morning();
  assert.equal(initial.kind === "update" && initial.text, "1 finished");
  assert.equal(initial.kind === "update" && initial.night_runs?.length, 1);
  assert.equal(
    initial.kind === "update" && initial.night_runs?.[0].text,
    "A useful result",
  );
  assert.equal(await flushConversationAlerts(new Date(), f.owner), 1);
  await child();
  let revised = await morning();
  assert.equal(revised.id, initial.id);
  assert.equal(revised.sequence, initial.sequence);
  assert.equal(revised.revision, 2);
  assert.equal(revised.kind === "update" && revised.text, "2 finished");
  assert.equal(revised.kind === "update" && revised.night_runs?.length, 2);
  assert.equal(
    (await conversationFeed(pool, f.owner, f.destination.id, {})).entries
      .length,
    1,
  );
  assert.equal(await flushConversationAlerts(new Date(), f.owner), 0);
  const firstJob = (
    await pool.query(
      "SELECT b.work_id FROM assistant_delivery_intents i JOIN assistant_delivery_bindings b ON b.id=i.binding_id WHERE i.id=$1",
      [first],
    )
  ).rows[0].work_id;
  const { SWEEP_RULES } = await import("../src/lib/sweep.js");
  const cleanup = SWEEP_RULES.find((rule) => rule.key === "ai_jobs")!;
  await pool.query(
    "UPDATE ai_jobs SET created_at=now()-interval '2 days' WHERE id=$1",
    [firstJob],
  );
  assert.equal(
    (
      await pool.query(
        `DELETE FROM ai_jobs WHERE id=$1 AND (${cleanup.where})`,
        [firstJob],
      )
    ).rowCount,
    1,
  );
  assert.deepEqual(
    (await conversationFeed(pool, f.owner, f.destination.id, {})).entries,
    [revised],
    "Execution retention preserves the summary's captured child authority and result",
  );
  assert.equal(
    (await morning()).revision,
    revised.revision,
    "Execution cleanup does not revise the night counts",
  );
  const childGrant = (
    await pool.query(
      "INSERT INTO agent_grants(user_id,kind,client_id,access,personal,team_ids) VALUES($1,'oauth','https://night-qa.invalid','write',true,'{}') RETURNING id",
      [f.owner],
    )
  ).rows[0].id;
  await pool.query(
    "UPDATE assistant_delivery_bindings SET grant_id=$2 WHERE id=(SELECT binding_id FROM assistant_delivery_intents WHERE id=$1)",
    [first, childGrant],
  );
  await pool.query("UPDATE agent_grants SET revoked_at=now() WHERE id=$1", [
    childGrant,
  ]);
  assert.equal(
    (await conversationFeed(pool, f.owner, f.destination.id, {})).entries
      .length,
    0,
    "A summary rechecks each contributing run's grant after publication",
  );
  const withoutRevoked = await morning();
  assert.equal(
    withoutRevoked.kind === "update" && withoutRevoked.text,
    "1 finished",
  );
  assert.equal(
    withoutRevoked.kind === "update" && withoutRevoked.night_runs?.length,
    1,
  );
  await pool.query("UPDATE agent_grants SET revoked_at=NULL WHERE id=$1", [
    childGrant,
  ]);
  revised = await morning();
  assert.equal(revised.kind === "update" && revised.text, "2 finished");
  assert.equal(await flushConversationAlerts(new Date(), f.owner), 0);
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM notifications WHERE user_id=$1 AND channel='inapp'",
        [f.owner],
      )
    ).rowCount,
    1,
  );
  const { registerOriginConversation, retainConversationTurn } =
    await import("../src/modules/assistant-workspace/conversation-storage.js");
  const source = async () => {
    const chat = randomUUID();
    await pool.query(
      "INSERT INTO ai_chats(id,user_id,title,origin) VALUES($1,$2,'Night evidence','person')",
      [chat, f.owner],
    );
    const stream = await transaction(async (db) => {
      const stream = await registerOriginConversation(db, f.owner, chat);
      await retainConversationTurn(db, f.owner, chat, {
        role: "user",
        text: "Evidence used by overnight work",
        turn_id: randomUUID(),
      });
      return stream;
    });
    return {
      chat,
      entry: (await conversationFeed(pool, f.owner, stream.id, {})).entries[0]
        .id,
    };
  };
  const original = await source(),
    replacement = await source();
  const childBinding = (
    await pool.query(
      "SELECT binding_id FROM assistant_delivery_intents WHERE id=$1",
      [first],
    )
  ).rows[0].binding_id;
  await pool.query(
    "INSERT INTO assistant_delivery_entry_sources(binding_id,source_entry_id) VALUES($1,$2)",
    [childBinding, original.entry],
  );
  const withEvidence = await morning();
  assert.equal(withEvidence.revision, revised.revision + 1);
  await pool.query(
    "UPDATE assistant_delivery_entry_sources SET source_entry_id=$2 WHERE binding_id=$1",
    [childBinding, replacement.entry],
  );
  await pool.query("DELETE FROM ai_chats WHERE id=$1", [original.chat]);
  assert.equal(
    (await conversationFeed(pool, f.owner, f.destination.id, {})).entries
      .length,
    0,
    "The old summary keeps its original source authority until publication replaces it",
  );
  const refreshed = await morning();
  assert.equal(refreshed.id, initial.id);
  assert.equal(refreshed.revision, withEvidence.revision + 1);
  assert.equal(refreshed.kind === "update" && refreshed.text, "2 finished");
  assert.equal(await flushConversationAlerts(new Date(), f.owner), 0);
  await pool.query("DELETE FROM ai_chats WHERE id=$1", [replacement.chat]);
  assert.equal(
    (await conversationFeed(pool, f.owner, f.destination.id, {})).entries
      .length,
    0,
    "The refreshed summary checks the replacement source",
  );
});

test("source changes after completion cannot become a false deduplication baseline", async () => {
  const { recordAssistantSources } =
    await import("../src/lib/assistant-job-sources.js");
  const f = await fixture();
  const doc = randomUUID();
  await pool.query(
    "INSERT INTO docs(id,user_id,title) VALUES($1,$2,'Revision race')",
    [doc, f.owner],
  );
  const read = async (version: number) => {
    const id = await work(f);
    await pool.query(
      "UPDATE assistant_delivery_bindings SET attention_key='revision-race' WHERE work_id=$1",
      [id],
    );
    await recordAssistantSources(id, f.owner, {
      kind: "doc",
      id: doc,
      version,
    });
    return complete(id);
  };
  const old = await read(1);
  await pool.query("UPDATE docs SET version=2 WHERE id=$1", [doc]);
  assert.equal(
    await transaction((db) => publishConversationIntent(db, old)),
    true,
  );
  const current = await read(2);
  assert.equal(
    await transaction((db) => publishConversationIntent(db, current)),
    true,
  );
  assert.equal(
    (await conversationFeed(pool, f.owner, f.destination.id, {})).entries
      .length,
    2,
  );
});

test("new jobs in a legacy night are not silently adopted into a personal destination", async () => {
  const { startAssistantAutomation } =
    await import("../src/modules/ai/agent/run.js");
  const f = await fixture();
  const night = randomUUID();
  await pool.query(
    "INSERT INTO assistant_nights(id,user_id,local_day) VALUES($1,$2,current_date)",
    [night, f.owner],
  );
  const id = await startAssistantAutomation({
    userId: f.owner,
    message: "Legacy night",
    timezone: "UTC",
    automation: { kind: "night", night_id: night, night_kind: "tidy" },
  });
  assert.ok(id);
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM assistant_delivery_bindings WHERE work_kind='job' AND work_id=$1",
        [id],
      )
    ).rowCount,
    0,
  );
});

test("a failed publication does not starve another update or rerun either job", async () => {
  const { flushConversationDeliveries } =
    await import("../src/modules/assistant-workspace/conversation-delivery.js");
  const f = await fixture();
  const first = await work(f);
  const second = await work(f);
  const broken = await complete(first);
  await complete(second);
  await pool.query(
    "UPDATE assistant_delivery_intents SET payload=jsonb_set(payload,'{lane}','\"unknown\"'::jsonb) WHERE id=$1",
    [broken],
  );
  const failures: string[] = [];
  assert.equal(
    await flushConversationDeliveries({
      onlyOwner: f.owner,
      onError: (id) => failures.push(id),
    }),
    1,
  );
  assert.deepEqual(failures, [broken]);
  assert.equal(
    (await conversationFeed(pool, f.owner, f.destination.id, {})).cursor,
    "1",
  );
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM ai_jobs WHERE id=ANY($1::uuid[]) AND state='done'",
        [[first, second]],
      )
    ).rowCount,
    2,
  );
});

async function overnightWork(
  f: Awaited<ReturnType<typeof fixture>>,
  end: Date,
  options: { nightId?: string; originChatId?: string } = {},
) {
  const { startAssistantAutomation } =
    await import("../src/modules/ai/agent/run.js");
  const id = await startAssistantAutomation({
    userId: f.owner,
    message: "Complete delegated Overnight work",
    timezone: "UTC",
    automation: {
      kind: "handoff",
      recipient_lane: "overnight",
      night_id: options.nightId,
      end_at: end.toISOString(),
    },
    deliveryOrigin: options.originChatId
      ? { chatId: options.originChatId }
      : undefined,
    onQueued: async (db, id) => {
      await db.query("UPDATE ai_jobs SET sources_checked=true WHERE id=$1", [
        id,
      ]);
    },
  });
  assert.ok(id);
  await pool.query("UPDATE ai_jobs SET state='done',result=$2 WHERE id=$1", [
    id,
    { answer: "A useful result" },
  ]);
  return id;
}
async function flushOwner(owner: string) {
  const { flushConversationDeliveries } =
    await import("../src/modules/assistant-workspace/conversation-delivery.js");
  const errors: string[] = [];
  for (let i = 0; i < 3; i++)
    await flushConversationDeliveries({
      onlyOwner: owner,
      onError: (id) => errors.push(id),
    });
  assert.deepEqual(errors, []);
}

test("explicit Overnight work shares a delivery window without creating an execution night", async () => {
  const f = await fixture(),
    end = new Date(Date.now() - 60000);
  const ids = [await overnightWork(f, end), await overnightWork(f, end)];
  await flushOwner(f.owner);
  let entries = (await conversationFeed(pool, f.owner, f.destination.id, {}))
    .entries;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind === "update" && entries[0].text, "2 finished");
  assert.equal(
    (
      await pool.query("SELECT 1 FROM assistant_nights WHERE user_id=$1", [
        f.owner,
      ])
    ).rowCount,
    0,
  );
  const bindings = (
    await pool.query(
      "SELECT night_id,summary_id FROM assistant_delivery_bindings WHERE work_id=ANY($1::uuid[])",
      [ids],
    )
  ).rows;
  assert.equal(bindings.length, 2);
  assert.ok(
    bindings.every(
      (b) => b.night_id === null && b.summary_id === bindings[0].summary_id,
    ),
  );
  await overnightWork(f, end);
  await flushOwner(f.owner);
  entries = (await conversationFeed(pool, f.owner, f.destination.id, {}))
    .entries;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind === "update" && entries[0].text, "3 finished");
  assert.equal(entries[0].revision, 2);
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM assistant_conversation_alerts WHERE entry_id=$1",
        [entries[0].id],
      )
    ).rowCount,
    1,
  );
});

test("an execution night joins an existing delivery window and summarizes each captured destination separately", async () => {
  const f = await fixture(),
    end = new Date(Date.now() - 60000),
    origin = randomUUID(),
    night = randomUUID();
  await pool.query(
    "INSERT INTO ai_chats(id,user_id,title) VALUES($1,$2,'Explicit origin')",
    [origin, f.owner],
  );
  await overnightWork(f, end, { originChatId: origin });
  await flushOwner(f.owner);
  const originStream = (
    await pool.query(
      "SELECT id FROM assistant_conversation_streams WHERE chat_id=$1",
      [origin],
    )
  ).rows[0].id;
  const initial = (await conversationFeed(pool, f.owner, originStream, {}))
    .entries[0];
  const window = (
    await pool.query(
      "SELECT id FROM assistant_delivery_windows WHERE owner_id=$1",
      [f.owner],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO assistant_nights(id,user_id,local_day,summary) VALUES($1,$2,current_date,$3)",
    [night, f.owner, { end_at: end.toISOString() }],
  );
  await transaction((db) =>
    bindConversationWork(db, {
      ownerId: f.owner,
      work: { kind: "night", id: night },
      lane: "overnight",
      timezone: "UTC",
      sourcesChecked: true,
      notBefore: end,
    }),
  );
  await overnightWork(f, end, { nightId: night });
  await overnightWork(f, end, { nightId: night, originChatId: origin });
  await flushOwner(f.owner);
  assert.equal(
    (
      await pool.query(
        "SELECT id FROM assistant_delivery_windows WHERE owner_id=$1 AND execution_night_id=$2",
        [f.owner, night],
      )
    ).rows[0].id,
    window,
  );
  const personal = (await conversationFeed(pool, f.owner, f.destination.id, {}))
    .entries;
  const scoped = (await conversationFeed(pool, f.owner, originStream, {}))
    .entries;
  assert.equal(personal.length, 1);
  assert.equal(scoped.length, 1);
  assert.equal(personal[0].kind === "update" && personal[0].text, "1 finished");
  assert.equal(scoped[0].kind === "update" && scoped[0].text, "2 finished");
  assert.equal(scoped[0].id, initial.id);
  assert.equal(scoped[0].revision, 2);
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM assistant_delivery_bindings WHERE owner_id=$1 AND work_kind='night'",
        [f.owner],
      )
    ).rowCount,
    2,
  );
});

test("window summaries retain each child's scope and never reroute a retired default", async () => {
  const f = await fixture(),
    end = new Date(Date.now() - 60000),
    team = randomUUID(),
    doc = randomUUID(),
    night = randomUUID();
  try {
    await pool.query(
      "INSERT INTO teams(id,name,created_by) VALUES($1,'Window scope',$2)",
      [team, f.owner],
    );
    await pool.query(
      "INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'owner')",
      [team, f.owner],
    );
    await pool.query(
      "INSERT INTO docs(id,user_id,title,team_id) VALUES($1,$2,'Scoped result',$3)",
      [doc, f.owner, team],
    );
    await pool.query(
      "INSERT INTO assistant_nights(id,user_id,local_day,summary) VALUES($1,$2,current_date,$3)",
      [night, f.owner, { end_at: end.toISOString() }],
    );
    await transaction((db) =>
      bindConversationWork(db, {
        ownerId: f.owner,
        work: { kind: "night", id: night },
        lane: "overnight",
        timezone: "UTC",
        sourcesChecked: true,
        notBefore: end,
      }),
    );
    const explicit = await overnightWork(f, end, {
      nightId: night,
      originChatId: f.destination.chat_id,
    });
    await pool.query(
      "INSERT INTO assistant_job_sources(job_id,source_kind,source_id) VALUES($1,'doc',$2)",
      [explicit, doc],
    );
    // A personally routed parent must not impose personal-only scope on explicit work.
    await pool.query(
      "UPDATE agent_grants SET personal=false,team_ids=$2 WHERE user_id=$1 AND kind='assistant'",
      [f.owner, [team]],
    );
    await flushOwner(f.owner);
    const entries = (
      await conversationFeed(pool, f.owner, f.destination.id, {})
    ).entries;
    assert.equal(entries.length, 1);
    assert.equal(entries[0].kind === "update" && entries[0].text, "1 finished");
    await pool.query("DELETE FROM docs WHERE id=$1", [doc]);
    assert.equal(
      (await conversationFeed(pool, f.owner, f.destination.id, {})).entries
        .length,
      0,
    );
    await pool.query(
      "UPDATE agent_grants SET personal=true WHERE user_id=$1 AND kind='assistant'",
      [f.owner],
    );
    await pool.query("DELETE FROM ai_chats WHERE id=$1", [
      f.destination.chat_id,
    ]);
    const replacement = await transaction((db) =>
      openPersonalConversation(db, f.owner),
    );
    assert.notEqual(replacement.id, f.destination.id);
    const late = await overnightWork(f, end, { nightId: night });
    assert.equal(
      (
        await pool.query(
          "SELECT 1 FROM assistant_delivery_bindings WHERE work_id=$1",
          [late],
        )
      ).rowCount,
      0,
    );
    assert.deepEqual(
      (await conversationFeed(pool, f.owner, replacement.id, {})).entries,
      [],
    );
  } finally {
    await pool.query("DELETE FROM teams WHERE id=$1", [team]);
  }
});

test("standalone Overnight execution survives cleanup until its summary publication commits", async () => {
  const f = await fixture(),
    end = new Date(Date.now() - 2 * 86400000);
  const id = await overnightWork(f, end);
  await pool.query(
    "UPDATE ai_jobs SET created_at=now()-interval '3 days' WHERE id=$1",
    [id],
  );
  const intent = (
    await pool.query(
      "SELECT i.id FROM assistant_delivery_intents i JOIN assistant_delivery_bindings b ON b.id=i.binding_id WHERE b.work_id=$1",
      [id],
    )
  ).rows[0].id;
  assert.equal(
    await transaction((db) => publishConversationIntent(db, intent)),
    false,
  );
  const { SWEEP_RULES } = await import("../src/lib/sweep.js");
  const cleanup = SWEEP_RULES.find((rule) => rule.key === "ai_jobs")!;
  assert.equal(
    (
      await pool.query(
        `SELECT 1 FROM ai_jobs WHERE id=$1 AND (${cleanup.where})`,
        [id],
      )
    ).rowCount,
    0,
    "Suppression into a pending morning summary is not a publication receipt",
  );
  await flushOwner(f.owner);
  const entry = (await conversationFeed(pool, f.owner, f.destination.id, {}))
    .entries[0];
  assert.ok(entry);
  assert.equal(
    (
      await pool.query(
        `DELETE FROM ai_jobs WHERE id=$1 AND (${cleanup.where})`,
        [id],
      )
    ).rowCount,
    1,
  );
  assert.deepEqual(
    (await conversationFeed(pool, f.owner, f.destination.id, {})).entries,
    [entry],
  );
});
