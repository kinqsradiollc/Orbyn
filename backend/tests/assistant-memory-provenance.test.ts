import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
process.env.ASSISTANT_CONVERSATION_ENABLED = "true";
const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { rememberMemory, readMemory, enqueueMemory } =
  await import("../src/modules/memory/service.js");
const { recordAssistantSources, assistantJobSourcesVisible } =
  await import("../src/lib/assistant-job-sources.js");
const { openPersonalConversation, retainConversationTurn } =
  await import("../src/modules/assistant-workspace/conversation-storage.js");
const { conversationFeed } =
  await import("../src/modules/assistant-workspace/conversation-feed.js");
const { assistantSourceVisible, assistantSourceGraphSql } =
  await import("../src/lib/assistant-source-visibility.js");
const { prepareConversationContext } =
  await import("../src/modules/assistant-workspace/conversation-context.js");
const { bindConversationWork, publishConversationIntent } =
  await import("../src/modules/assistant-workspace/conversation-delivery.js");
const { readAiChat } = await import("../src/modules/ai/chats.js");
const owners: string[] = [];
before(() => migrate());
after(async () => {
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [owners]);
  await pool.end();
});

test("the installed graph matches the canonical source predicate", async () => {
  const expected = assistantSourceGraphSql(
    "SELECT p_kind AS kind,p_id AS id",
    "p_user",
    { user: "p_user", personal: "p_personal", teams: "p_teams" },
  );
  const migration = await readFile(
    new URL(
      "../migrations/289_assistant_delivery_windows.sql",
      import.meta.url,
    ),
    "utf8",
  );
  // Generated SQL may normalize blank-line indentation. Keep all non-trailing
  // characters exact so formatting cannot conceal an authority change.
  const normalize = (sql: string) => sql.replace(/[ \t]+$/gm, "");
  assert.ok(normalize(migration).includes(normalize(`RETURN ${expected};`)));
  const installed = (
    await pool.query(
      "SELECT prosrc FROM pg_proc WHERE oid='assistant_source_graph_visible(text,uuid,uuid,boolean,uuid[])'::regprocedure",
    )
  ).rows[0].prosrc;
  assert.ok(normalize(installed).includes(normalize(`RETURN ${expected};`)));
});

test("nested Memory and chat dependencies terminate cycles and recheck document deletion", async () => {
  const owner = randomUUID(),
    source = randomUUID();
  owners.push(owner);
  await pool.query(
    "INSERT INTO users(id,email,password_hash,name) VALUES($1,$2,'test','Nested Memory QA')",
    [owner, `${owner}@example.test`],
  );
  await pool.query(
    "INSERT INTO ai_chats(id,user_id,title,origin) VALUES($1,$2,'Nested source','person')",
    [source, owner],
  );
  const leaf = await transaction((db) =>
    rememberMemory(
      db,
      owner,
      "Manual fact",
      ["An independently authored fact"],
      [],
    ),
  );
  const middle = await transaction((db) =>
    rememberMemory(
      db,
      owner,
      "Derived fact",
      ["Depends on manual fact"],
      [{ type: "doc", id: leaf.entry.id, label: "Manual fact", quote: null }],
    ),
  );
  await pool.query(
    "INSERT INTO assistant_chat_sources(chat_id,turn_id,source_kind,source_id) VALUES($1,$2,'doc',$3)",
    [source, randomUUID(), middle.entry.id],
  );
  const root = await transaction((db) =>
    rememberMemory(
      db,
      owner,
      "Chat fact",
      ["Depends on the chat"],
      [{ type: "chat", id: source, label: "Nested source", quote: null }],
    ),
  );
  await pool.query(
    "INSERT INTO memory_sources(doc_id,source_type,source_id,label) VALUES($1,'doc',$2,'Cycle')",
    [leaf.entry.id, root.entry.id],
  );
  const visible = async (id: string) =>
    (
      await pool.query(
        `SELECT d.id FROM docs d WHERE d.id=$2 AND ${assistantSourceVisible("'doc'", "d.id", "$1", false)}`,
        [owner, id],
      )
    ).rowCount;
  assert.equal(await visible(root.entry.id), 1);
  assert.ok(await readMemory(pool, owner, root.entry.id));
  await pool.query("UPDATE docs SET deleted_at=now() WHERE id=$1", [
    middle.entry.id,
  ]);
  assert.equal(await visible(root.entry.id), 0);
  assert.equal(await readMemory(pool, owner, root.entry.id), null);
});

test("source-chat deletion hides Memory-derived jobs and retained answers while independent history remains", async () => {
  const owner = randomUUID(),
    source = randomUUID(),
    turn = randomUUID(),
    job = randomUUID();
  owners.push(owner);
  await pool.query(
    "INSERT INTO users(id,email,password_hash,name) VALUES($1,$2,'test','Memory provenance QA')",
    [owner, `${owner}@example.test`],
  );
  await pool.query(
    "INSERT INTO ai_chats(id,user_id,title,origin) VALUES($1,$2,'Personal source','person')",
    [source, owner],
  );
  const memory = await transaction((db) =>
    rememberMemory(
      db,
      owner,
      "Private learned context",
      ["A source-dependent fact"],
      [{ type: "chat", id: source, label: "Source conversation", quote: null }],
    ),
  );
  const destination = await transaction((db) =>
    openPersonalConversation(db, owner),
  );
  await pool.query(
    "INSERT INTO ai_jobs(id,user_id,chat_id,turn_id,state,run_origin) VALUES($1,$2,$3,$4,'done','person')",
    [job, owner, destination.chat_id, turn],
  );
  await recordAssistantSources(job, owner, {}, [`doc:${memory.entry.id}`]);
  await transaction(async (db) => {
    await retainConversationTurn(db, owner, destination.chat_id, {
      role: "assistant",
      text: "An answer derived from Memory",
      turn_id: turn,
    });
    await retainConversationTurn(db, owner, destination.chat_id, {
      role: "user",
      text: "An independent retained message",
      turn_id: randomUUID(),
    });
  });
  assert.ok(await readMemory(pool, owner, memory.entry.id));
  assert.equal(
    (await conversationFeed(pool, owner, destination.id, {})).entries.length,
    2,
  );
  await pool.query("DELETE FROM ai_chats WHERE id=$1", [source]);
  assert.equal(await readMemory(pool, owner, memory.entry.id), null);
  assert.equal(
    (
      await pool.query(
        `SELECT j.id FROM ai_jobs j WHERE j.id=$2 AND ${assistantJobSourcesVisible("j", "$1", false)}`,
        [owner, job],
      )
    ).rowCount,
    0,
    "Derived jobs must retain the deleted chat's authority boundary",
  );
  assert.deepEqual(
    (await conversationFeed(pool, owner, destination.id, {})).entries.map(
      (entry) => (entry.kind === "turn" ? entry.turn.text : null),
    ),
    ["An independent retained message"],
  );
});

test("grant revocation hides selected-update replies and Memory derived from those replies", async () => {
  const owner = randomUUID();
  owners.push(owner);
  await pool.query(
    "INSERT INTO users(id,email,password_hash,name) VALUES($1,$2,'test','Grant lineage QA')",
    [owner, `${owner}@example.test`],
  );
  await pool.query(
    "INSERT INTO agent_settings(user_id,reminder_nudges) VALUES($1,$2)",
    [owner, { quiet_start: "00:00", quiet_end: "00:00" }],
  );
  const grant = (
    await pool.query<{ id: string }>(
      "INSERT INTO agent_grants(user_id,kind,client_id,access,personal,team_ids) VALUES($1,'oauth','https://lineage.invalid','write',true,'{}') RETURNING id",
      [owner],
    )
  ).rows[0].id;
  const destination = await transaction((db) =>
    openPersonalConversation(db, owner),
  );
  const work = randomUUID(),
    workChat = randomUUID(),
    replyTurn = randomUUID();
  await pool.query(
    "INSERT INTO ai_chats(id,user_id,title,origin) VALUES($1,$2,'Grant source','task')",
    [workChat, owner],
  );
  await pool.query(
    "INSERT INTO ai_jobs(id,user_id,chat_id,state,run_origin,sources_checked) VALUES($1,$2,$3,'queued','task',true)",
    [work, owner, workChat],
  );
  await transaction((db) =>
    bindConversationWork(db, {
      ownerId: owner,
      work: { kind: "job", id: work },
      lane: "background",
      timezone: "UTC",
      destinationId: destination.id,
      grantId: grant,
    }),
  );
  await pool.query("UPDATE ai_jobs SET state='done',result=$2 WHERE id=$1", [
    work,
    { answer: "A grant-dependent finding" },
  ]);
  const intent = (
    await pool.query<{ id: string }>(
      "SELECT i.id FROM assistant_delivery_intents i JOIN assistant_delivery_bindings b ON b.id=i.binding_id WHERE b.work_id=$1",
      [work],
    )
  ).rows[0].id;
  await transaction((db) => publishConversationIntent(db, intent));
  const update = (await conversationFeed(pool, owner, destination.id, {}))
    .entries[0];
  assert.equal(update.kind, "update");
  const legacyExecution = randomUUID(),
    legacyTurn = randomUUID();
  await pool.query(
    "INSERT INTO ai_chats(id,user_id,title,origin,turns) VALUES($1,$2,'Legacy derived work','task',$3)",
    [
      legacyExecution,
      owner,
      JSON.stringify([
        {
          role: "assistant",
          text: "Derived work details",
          turn_id: legacyTurn,
        },
      ]),
    ],
  );
  await pool.query(
    "INSERT INTO assistant_turn_entry_sources(chat_id,turn_id,source_entry_id) VALUES($1,$2,$3)",
    [legacyExecution, legacyTurn, update.id],
  );
  assert.ok(await readAiChat(pool, owner, legacyExecution));
  await transaction(async (db) => {
    await prepareConversationContext(
      db,
      owner,
      destination.chat_id,
      replyTurn,
      update.id,
    );
    await db.query(
      "INSERT INTO ai_jobs(user_id,chat_id,turn_id,state,run_origin,sources_checked) VALUES($1,$2,$3,'done','person',true)",
      [owner, destination.chat_id, replyTurn],
    );
    await retainConversationTurn(db, owner, destination.chat_id, {
      role: "assistant",
      text: "An explanation of that finding",
      turn_id: replyTurn,
    });
  });
  const memory = await transaction((db) =>
    rememberMemory(
      db,
      owner,
      "Derived grant fact",
      ["Learned from the reply"],
      [{ type: "chat", id: destination.chat_id, label: "Reply", quote: null }],
    ),
  );
  assert.ok(await readMemory(pool, owner, memory.entry.id));
  assert.equal(
    (await conversationFeed(pool, owner, destination.id, {})).entries.length,
    2,
  );
  await pool.query("UPDATE agent_grants SET revoked_at=now() WHERE id=$1", [
    grant,
  ]);
  await assert.rejects(
    readAiChat(pool, owner, legacyExecution),
    /Chat not found/,
  );
  assert.equal(
    (await conversationFeed(pool, owner, destination.id, {})).entries.length,
    0,
    "The derived reply must retain its source update's grant",
  );
  assert.equal(await readMemory(pool, owner, memory.entry.id), null);
  const independentTurn = randomUUID();
  await transaction(async (db) => {
    await db.query(
      "INSERT INTO ai_jobs(user_id,chat_id,turn_id,state,run_origin,sources_checked) VALUES($1,$2,$3,'done','person',true)",
      [owner, destination.chat_id, independentTurn],
    );
    await retainConversationTurn(db, owner, destination.chat_id, {
      role: "user",
      text: "An independent preference",
      turn_id: independentTurn,
    });
    await retainConversationTurn(db, owner, destination.chat_id, {
      role: "assistant",
      text: "An independent acknowledgement",
      turn_id: independentTurn,
    });
    await enqueueMemory(db, {
      userId: owner,
      chatId: destination.chat_id,
      sourceTurnId: independentTurn,
      sourceProjectId: null,
      turns: [
        { role: "user", content: "Untrusted caller text must not be learned" },
      ],
    });
  });
  const queued = (
    await pool.query(
      "SELECT source_entry_ids,turns,maintenance_job_id FROM memory_queue WHERE user_id=$1",
      [owner],
    )
  ).rows[0];
  assert.equal(queued.source_entry_ids.length, 2);
  assert.deepEqual(
    queued.turns.map((turn: { content: string }) => turn.content),
    ["An independent preference", "An independent acknowledgement"],
  );
  const captured = (
    await pool.query(
      "SELECT run_state->>'source_digest' AS digest FROM ai_jobs WHERE id=$1",
      [queued.maintenance_job_id],
    )
  ).rows[0].digest;
  await assert.rejects(
    transaction((db) =>
      rememberMemory(
        db,
        owner,
        "Invalid retained source",
        ["Must not be saved"],
        [],
        { chatId: destination.chat_id, entryIds: [] },
      ),
    ),
    /unverified/,
  );
  await assert.rejects(
    transaction((db) =>
      rememberMemory(
        db,
        owner,
        "Wrong retained source",
        ["Must not be saved"],
        [],
        { chatId: workChat, entryIds: queued.source_entry_ids },
      ),
    ),
    /no longer available/,
  );
  assert.equal(await readMemory(pool, owner, "Invalid retained source"), null);
  await pool.query("UPDATE ai_chats SET turns=$2 WHERE id=$1", [
    destination.chat_id,
    JSON.stringify(
      Array.from({ length: 200 }, (_, i) => ({
        role: "user",
        text: `Later unrelated ${i}`,
      })),
    ),
  ]);
  assert.equal(
    (
      await pool.query(
        "SELECT chat_maintenance_entry_digest(c,$2) AS digest FROM ai_chats c WHERE id=$1",
        [destination.chat_id, queued.source_entry_ids],
      )
    ).rows[0].digest,
    captured,
  );
  const independentMemory = await transaction((db) =>
    rememberMemory(
      db,
      owner,
      "Independent retained fact",
      ["Learned independently"],
      [
        {
          type: "chat",
          id: destination.chat_id,
          label: "Conversation",
          quote: null,
        },
      ],
      { chatId: destination.chat_id, entryIds: queued.source_entry_ids },
    ),
  );
  assert.ok(
    await readMemory(pool, owner, independentMemory.entry.id),
    "Unrelated revoked updates do not taint a newly learned independent fact",
  );
  assert.equal(
    (await conversationFeed(pool, owner, destination.id, {})).entries.length,
    2,
  );
  const { env } = await import("../src/config/env.js");
  const { assistantPrincipal } =
    await import("../src/modules/agents/assistant.js");
  const { execute } = await import("../src/capabilities/execute.js");
  const { registry } = await import("../src/capabilities/index.js");
  const privateDoc = (
    await pool.query(
      "INSERT INTO docs(user_id,title) VALUES($1,'Unrelated private source') RETURNING id",
      [owner],
    )
  ).rows[0].id;
  const privateTurn = randomUUID();
  await pool.query(
    "INSERT INTO assistant_chat_sources(chat_id,turn_id,source_kind,source_id) VALUES($1,$2,'doc',$3)",
    [destination.chat_id, privateTurn, privateDoc],
  );
  await transaction((db) =>
    retainConversationTurn(db, owner, destination.chat_id, {
      role: "user",
      text: "An unrelated private source",
      turn_id: privateTurn,
    }),
  );
  await pool.query("UPDATE docs SET deleted_at=now() WHERE id=$1", [
    privateDoc,
  ]);
  const principal = await assistantPrincipal({
    id: owner,
    name: "MCP provenance QA",
    role: "member",
  });
  await pool.query("UPDATE ai_chats SET turns=$2,trace=$3 WHERE id=$1", [
    destination.chat_id,
    JSON.stringify([
      {
        role: "assistant",
        text: "An explanation of that finding",
        turn_id: replyTurn,
      },
      {
        role: "user",
        text: "An independent preference",
        turn_id: independentTurn,
      },
      {
        role: "assistant",
        text: "An independent acknowledgement",
        turn_id: independentTurn,
      },
    ]),
    JSON.stringify([{ step: 1, kind: "tool", label: "Private raw trace" }]),
  ]);
  const mcp = await execute(
    registry,
    principal,
    "get_chats",
    { chat_id: destination.chat_id },
    { primary: true },
  );
  assert.equal(mcp.result.isError, undefined);
  const exposed = mcp.result.structuredContent as {
    chats: { turns: { text: string }[]; trace: unknown[] }[];
  };
  assert.deepEqual(
    exposed.chats[0].turns.map((turn) => turn.text),
    ["An independent preference", "An independent acknowledgement"],
    "MCP must read the authorized retained projection rather than raw turns",
  );
  assert.deepEqual(exposed.chats[0].trace, []);
  const searched = await execute(
    registry,
    principal,
    "get_chats",
    { search: "An explanation of that finding" },
    { primary: true },
  );
  assert.deepEqual(
    (searched.result.structuredContent as { chats: unknown[] }).chats,
    [],
    "Hidden raw turns must not leak through search",
  );
  const collector = async () => {
    const chat = randomUUID(),
      turn = randomUUID(),
      job = randomUUID();
    await pool.query(
      "INSERT INTO ai_chats(id,user_id,title,origin) VALUES($1,$2,'Authorized derived work','task')",
      [chat, owner],
    );
    await pool.query(
      "INSERT INTO ai_jobs(id,user_id,chat_id,turn_id,state,run_origin) VALUES($1,$2,$3,$4,'queued','task')",
      [job, owner, chat, turn],
    );
    return job;
  };
  const mcpConsumer = await collector();
  await recordAssistantSources(
    mcpConsumer,
    owner,
    mcp.result.structuredContent,
    mcp.targets,
  );
  assert.equal(
    (
      await pool.query(
        `SELECT j.id FROM ai_jobs j WHERE j.id=$2 AND ${assistantJobSourcesVisible("j", "$1", false)}`,
        [owner, mcpConsumer],
      )
    ).rowCount,
    1,
    "Reading authorized MCP entries must not borrow unrelated revoked chat dependencies",
  );
  await pool.query(
    "UPDATE ai_jobs SET result=$3 WHERE chat_id=$1 AND turn_id=$2",
    [
      destination.chat_id,
      independentTurn,
      { answer: "An independent acknowledgement" },
    ],
  );
  const { reflectionEvidence } =
    await import("../src/modules/ai/agent/reflection.js");
  const independentJob = (
    await pool.query("SELECT id FROM ai_jobs WHERE chat_id=$1 AND turn_id=$2", [
      destination.chat_id,
      independentTurn,
    ])
  ).rows[0].id;
  const evidence = (await reflectionEvidence(pool, owner)).filter(
    (entry) =>
      entry.source.kind === "job" && entry.source.id === independentJob,
  );
  assert.equal(
    evidence.length,
    1,
    "Reflection reads use the individual job's authority in a retained conversation",
  );
  const reflectionConsumer = await collector();
  await recordAssistantSources(reflectionConsumer, owner, evidence);
  await recordAssistantSources(reflectionConsumer, owner, {});
  assert.equal(
    (
      await pool.query(
        `SELECT j.id FROM ai_jobs j WHERE j.id=$2 AND ${assistantJobSourcesVisible("j", "$1", false)}`,
        [owner, reflectionConsumer],
      )
    ).rowCount,
    1,
    "Exact reflection provenance must not widen to the canonical chat's other sources",
  );
  const previous = env.ASSISTANT_CONVERSATION_ENABLED;
  env.ASSISTANT_CONVERSATION_ENABLED = "false";
  try {
    const rollbackContext = await transaction((db) =>
      prepareConversationContext(db, owner, destination.chat_id, randomUUID()),
    );
    assert.deepEqual(
      rollbackContext?.history.map((turn) => turn.content),
      ["An independent preference", "An independent acknowledgement"],
      "Delivery rollback still filters revoked derived foreground history",
    );
  } finally {
    env.ASSISTANT_CONVERSATION_ENABLED = previous;
  }
  await pool.query(
    "UPDATE assistant_conversation_entries SET payload=jsonb_set(payload,'{text}','\"Edited source\"') WHERE id=$1",
    [queued.source_entry_ids[0]],
  );
  assert.notEqual(
    (
      await pool.query(
        "SELECT chat_maintenance_entry_digest(c,$2) AS digest FROM ai_chats c WHERE id=$1",
        [destination.chat_id, queued.source_entry_ids],
      )
    ).rows[0].digest,
    captured,
  );
  await pool.query("DELETE FROM ai_chats WHERE id=$1", [destination.chat_id]);
  assert.equal(
    await readMemory(pool, owner, independentMemory.entry.id),
    null,
    "Deleting a generation leaves invalid source identities",
  );
});
