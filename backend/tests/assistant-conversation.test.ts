import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { UserRow } from "../src/lib/auth.js";
import {
  assistantConversationPage,
  assistantConversationDestination,
} from "@orbyn/core";

process.env.ASSISTANT_CONVERSATION_ENABLED = "true";

const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const {
  openPersonalConversation,
  registerOriginConversation,
  conversationDestination,
  retainConversationTurn,
} = await import("../src/modules/assistant-workspace/conversation-storage.js");
const { conversationFeed, acknowledgeConversation } =
  await import("../src/modules/assistant-workspace/conversation-feed.js");
const { beginChatTurn } = await import("../src/modules/ai/chats.js");
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
    "INSERT INTO users(id,email,password_hash,name) VALUES($1,$2,'test','Conversation tester')",
    [id, `conversation-${id}@example.test`],
  );
  return id;
}

test("concurrent explicit opens share one personal destination", async () => {
  const owner = await person();
  const opened = await Promise.all(
    Array.from({ length: 4 }, () =>
      transaction((db) => openPersonalConversation(db, owner)),
    ),
  );
  assert.equal(new Set(opened.map((d) => d.id)).size, 1);
  assert.equal(new Set(opened.map((d) => d.chat_id)).size, 1);
  assert.equal(opened[0].personal, true);
  const other = await person();
  assert.equal(await conversationDestination(pool, other, opened[0].id), null);
  await assert.rejects(
    transaction((db) =>
      registerOriginConversation(db, other, opened[0].chat_id),
    ),
  );
});

test("retained turns survive the execution window and retries keep sequence stable", async () => {
  const owner = await person();
  const destination = await transaction((db) =>
    openPersonalConversation(db, owner),
  );
  const first = randomUUID();
  const user = (
    await pool.query<UserRow>("SELECT * FROM users WHERE id=$1", [owner])
  ).rows[0];
  await transaction(async (db) => {
    for (let n = 0; n < 205; n++)
      await beginChatTurn(
        user,
        {
          chatId: destination.chat_id,
          turnId: n === 0 ? first : randomUUID(),
          message: `Message ${n}`,
          scope: null,
          legacyHistory: [],
        },
        db,
      );
    await retainConversationTurn(db, owner, destination.chat_id, {
      turn_id: first,
      role: "user",
      text: "Message 0",
    });
  });
  const rows = (
    await pool.query(
      "SELECT sequence::text,payload FROM assistant_conversation_entries e WHERE destination_id=$1 ORDER BY e.sequence",
      [destination.id],
    )
  ).rows;
  assert.equal(rows.length, 205);
  assert.equal(rows[0].payload.text, "Message 0");
  assert.equal(rows.at(-1).sequence, "205");
  const execution = (
    await pool.query(
      "SELECT jsonb_array_length(turns) AS count FROM ai_chats WHERE id=$1",
      [destination.chat_id],
    )
  ).rows[0];
  assert.equal(execution.count, 200);
  assert.equal(
    (await conversationDestination(pool, owner, destination.id))?.last_sequence,
    "205",
  );
});

test("feed filters revoked dependencies per entry and read state is shared and monotonic", async () => {
  const owner = await person();
  const destination = await transaction((db) =>
    openPersonalConversation(db, owner),
  );
  await transaction(async (db) => {
    for (let n = 0; n < 3; n++)
      await retainConversationTurn(db, owner, destination.chat_id, {
        turn_id: randomUUID(),
        role: "user",
        text: `Visible ${n}`,
      });
  });
  const doc = randomUUID();
  await pool.query(
    "INSERT INTO docs(id,user_id,title) VALUES($1,$2,'Private source')",
    [doc, owner],
  );
  await pool.query(
    "INSERT INTO assistant_conversation_entry_sources(entry_id,source_kind,source_id) SELECT id,'doc',$2 FROM assistant_conversation_entries WHERE destination_id=$1 AND sequence=2",
    [destination.id, doc],
  );
  assert.equal(
    (await conversationFeed(pool, owner, destination.id, {})).entries.length,
    3,
  );
  await pool.query("DELETE FROM docs WHERE id=$1", [doc]);
  const firstPage = await conversationFeed(pool, owner, destination.id, {
    limit: 1,
  });
  assert.equal(firstPage.cursor, "1");
  assert.equal(firstPage.has_more, true);
  const secondPage = await conversationFeed(pool, owner, destination.id, {
    after: firstPage.cursor,
    limit: 1,
  });
  assert.deepEqual(
    secondPage.entries.map((e) => e.sequence),
    ["3"],
  );
  assert.equal(secondPage.cursor, "3");
  assert.equal(secondPage.has_more, false);
  assert.equal(
    secondPage.destination.read_sequence,
    "0",
    "fetch does not acknowledge entries",
  );
  await assert.rejects(
    transaction((db) =>
      acknowledgeConversation(db, owner, destination.id, { through: "2" }),
    ),
  );
  await transaction((db) =>
    acknowledgeConversation(db, owner, destination.id, { through: "3" }),
  );
  await transaction((db) =>
    acknowledgeConversation(db, owner, destination.id, { through: "1" }),
  );
  assert.equal(
    (await conversationFeed(pool, owner, destination.id, {})).destination
      .read_sequence,
    "3",
  );
  assert.ok(
    await conversationDestination(pool, owner, destination.id),
    "unrelated conversation remains available",
  );
  await pool.query("UPDATE users SET disabled=true WHERE id=$1", [owner]);
  await assert.rejects(conversationFeed(pool, owner, destination.id, {}));
});

test("retaining a turn rolls back with its owner transaction", async () => {
  const owner = await person();
  const destination = await transaction((db) =>
    openPersonalConversation(db, owner),
  );
  await assert.rejects(
    transaction(async (db) => {
      await retainConversationTurn(db, owner, destination.chat_id, {
        turn_id: randomUUID(),
        role: "user",
        text: "Never committed",
      });
      throw new Error("crash before commit");
    }),
  );
  assert.equal(
    (await conversationDestination(pool, owner, destination.id))?.last_sequence,
    "0",
  );
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM assistant_conversation_entries WHERE destination_id=$1",
        [destination.id],
      )
    ).rowCount,
    0,
  );
});

test("deletion retires a destination, erases content and blocks pending intents", async () => {
  const owner = await person();
  const destination = await transaction((db) =>
    openPersonalConversation(db, owner),
  );
  await transaction((db) =>
    retainConversationTurn(db, owner, destination.chat_id, {
      turn_id: randomUUID(),
      role: "user",
      text: "Erase me",
    }),
  );
  const binding = randomUUID();
  await pool.query(
    "INSERT INTO assistant_delivery_bindings(id,owner_id,work_kind,work_id,destination_id,reason,lane,timezone) VALUES($1,$2,'job',$3,$4,'personal','background','UTC')",
    [binding, owner, randomUUID(), destination.id],
  );
  await pool.query(
    "INSERT INTO assistant_delivery_intents(binding_id,event_key,payload) VALUES($1,'result',$2)",
    [binding, { text: "Erase this result too" }],
  );
  await pool.query("DELETE FROM ai_chats WHERE id=$1", [destination.chat_id]);
  assert.equal(
    await conversationDestination(pool, owner, destination.id),
    null,
  );
  const intent = (
    await pool.query(
      "SELECT state,reason,payload FROM assistant_delivery_intents WHERE binding_id=$1",
      [binding],
    )
  ).rows[0];
  assert.deepEqual(intent, {
    state: "blocked",
    reason: "destination_retired",
    payload: {},
  });
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM assistant_conversation_entries WHERE destination_id=$1",
        [destination.id],
      )
    ).rowCount,
    0,
  );
  const replacement = await transaction((db) =>
    openPersonalConversation(db, owner),
  );
  assert.notEqual(replacement.id, destination.id);
  assert.notEqual(replacement.chat_id, destination.chat_id);
});

test("sweeping retires a destination without silently redirecting work", async () => {
  const owner = await person();
  const destination = await transaction((db) =>
    openPersonalConversation(db, owner),
  );
  await pool.query("UPDATE ai_chats SET swept_at=now() WHERE id=$1", [
    destination.chat_id,
  ]);
  assert.equal(
    await conversationDestination(pool, owner, destination.id),
    null,
  );
  await assert.rejects(
    transaction((db) =>
      registerOriginConversation(db, owner, destination.chat_id),
    ),
  );
  const replacement = await transaction((db) =>
    openPersonalConversation(db, owner),
  );
  assert.notEqual(replacement.id, destination.id);
});

test("wire schemas reject unsafe or malformed cursors without throwing", () => {
  const d = {
    id: randomUUID(),
    chat_id: randomUUID(),
    personal: true,
    last_sequence: "9223372036854775807",
    read_sequence: "0",
  };
  assert.equal(assistantConversationDestination.safeParse(d).success, true);
  assert.equal(
    assistantConversationDestination.safeParse({ ...d, last_sequence: "bad" })
      .success,
    false,
  );
  assert.equal(
    assistantConversationDestination.safeParse({
      ...d,
      last_sequence: "0",
      read_sequence: "1",
    }).success,
    false,
  );
  assert.equal(
    assistantConversationPage.safeParse({
      destination: d,
      entries: [],
      cursor: "bad",
      has_more: false,
    }).success,
    false,
  );
  assert.equal(
    assistantConversationPage.safeParse({
      destination: d,
      entries: [],
      cursor: "0",
      has_more: true,
    }).success,
    false,
  );
});

test("registered origin conversations filter individual entries while retaining container authority", async () => {
  const { readAiChat, listAiChats } =
    await import("../src/modules/ai/chats.js");
  const { prepareConversationContext } =
    await import("../src/modules/assistant-workspace/conversation-context.js");
  const owner = await person(),
    project = randomUUID(),
    chat = randomUUID(),
    doc = randomUUID();
  const privateTurn = randomUUID(),
    unrelatedTurn = randomUUID();
  await pool.query(
    "INSERT INTO projects(id,user_id,name) VALUES($1,$2,'Origin project')",
    [project, owner],
  );
  await pool.query(
    "INSERT INTO docs(id,user_id,title) VALUES($1,$2,'Revocable source')",
    [doc, owner],
  );
  await pool.query(
    "INSERT INTO ai_chats(id,user_id,title,project_id,scope_kind,scope_id,turns) VALUES($1,$2,'Origin chat',$3,'project',$3,$4)",
    [
      chat,
      owner,
      project,
      JSON.stringify([
        {
          role: "user",
          text: "Source-dependent message",
          turn_id: privateTurn,
        },
        { role: "user", text: "Independent message", turn_id: unrelatedTurn },
      ]),
    ],
  );
  const destination = await transaction((db) =>
    registerOriginConversation(db, owner, chat),
  );
  await pool.query(
    "INSERT INTO assistant_chat_sources(chat_id,turn_id,source_kind,source_id) VALUES($1,$2,'doc',$3)",
    [chat, privateTurn, doc],
  );
  await transaction(async (db) => {
    await retainConversationTurn(db, owner, chat, {
      role: "user",
      text: "Source-dependent message",
      turn_id: privateTurn,
    });
    await retainConversationTurn(db, owner, chat, {
      role: "user",
      text: "Independent message",
      turn_id: unrelatedTurn,
    });
  });
  assert.equal((await readAiChat(pool, owner, chat)).turns.length, 2);
  await pool.query("DELETE FROM docs WHERE id=$1", [doc]);
  assert.deepEqual(
    (await conversationFeed(pool, owner, destination.id, {})).entries.map(
      (e) => (e.kind === "turn" ? e.turn.text : ""),
    ),
    ["Independent message"],
  );
  assert.deepEqual(
    (await readAiChat(pool, owner, chat)).turns.map((t) => t.text),
    ["Independent message"],
  );
  const listed = await listAiChats(pool, owner, {
    search: "Independent message",
    limit: 50,
  });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].turn_count, 1);
  assert.equal(listed[0].title, "Conversation");
  assert.deepEqual(
    await listAiChats(pool, owner, { search: "Source-dependent", limit: 50 }),
    [],
    "search must not match revoked raw text",
  );
  const { exportConversations } =
    await import("../src/modules/assistant-workspace/conversation-export.js");
  const exported = await exportConversations(pool, owner);
  assert.equal(exported[0].title, "Conversation");
  assert.deepEqual(
    exported[0].entries.map((entry) =>
      entry.kind === "turn" ? entry.turn.text : "",
    ),
    ["Independent message"],
  );
  const context = await transaction((db) =>
    prepareConversationContext(db, owner, chat, randomUUID()),
  );
  assert.deepEqual(context?.history, [
    { role: "user", content: "Independent message" },
  ]);
  assert.equal(
    (await transaction((db) => registerOriginConversation(db, owner, chat))).id,
    destination.id,
    "another permitted admission retains the same stream",
  );
  await pool.query("UPDATE projects SET assistant_off=true WHERE id=$1", [
    project,
  ]);
  assert.equal(
    await conversationDestination(pool, owner, destination.id),
    null,
  );
  await assert.rejects(readAiChat(pool, owner, chat), /Chat not found/);
});

test("unregistered legacy chats retain their original history and permission boundary", async () => {
  const { readAiChat } = await import("../src/modules/ai/chats.js");
  const owner = await person(),
    chat = randomUUID(),
    doc = randomUUID(),
    turn = randomUUID();
  await pool.query(
    "INSERT INTO ai_chats(id,user_id,title,turns) VALUES($1,$2,'Legacy chat',$3)",
    [
      chat,
      owner,
      JSON.stringify([
        { role: "user", text: "Existing legacy message", turn_id: turn },
      ]),
    ],
  );
  await pool.query(
    "INSERT INTO docs(id,user_id,title) VALUES($1,$2,'Legacy source')",
    [doc, owner],
  );
  await pool.query(
    "INSERT INTO assistant_chat_sources(chat_id,turn_id,source_kind,source_id) VALUES($1,$2,'doc',$3)",
    [chat, turn, doc],
  );
  assert.equal(
    (await readAiChat(pool, owner, chat)).turns[0].text,
    "Existing legacy message",
  );
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM assistant_conversation_streams WHERE chat_id=$1",
        [chat],
      )
    ).rowCount,
    0,
    "reading does not adopt a legacy chat",
  );
  await pool.query("DELETE FROM docs WHERE id=$1", [doc]);
  await assert.rejects(readAiChat(pool, owner, chat), /Chat not found/);
});
