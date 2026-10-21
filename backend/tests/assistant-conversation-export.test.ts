import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { inflateRawSync } from "node:zlib";
const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { openPersonalConversation, retainConversationTurn } =
  await import("../src/modules/assistant-workspace/conversation-storage.js");
const { exportData } = await import("../src/modules/organize/portability.js");
const { exportArchive } = await import("../src/modules/organize/archive.js");
const owners: string[] = [],
  teams: string[] = [];
before(() => migrate());
after(async () => {
  await pool.query("DELETE FROM teams WHERE id=ANY($1::uuid[])", [teams]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [owners]);
  await pool.end();
});
function unzip(buffer: Buffer) {
  const files = new Map<string, string>();
  let at = 0;
  while (at + 30 <= buffer.length && buffer.readUInt32LE(at) === 0x04034b50) {
    const method = buffer.readUInt16LE(at + 8),
      size = buffer.readUInt32LE(at + 18),
      names = buffer.readUInt16LE(at + 26),
      extra = buffer.readUInt16LE(at + 28);
    const name = buffer.subarray(at + 30, at + 30 + names).toString(),
      start = at + 30 + names + extra,
      body = buffer.subarray(start, start + size);
    files.set(name, (method === 8 ? inflateRawSync(body) : body).toString());
    at = start + size;
  }
  return files;
}

test("JSON and paged ZIP retain history beyond 200 while excluding revoked, team and deleted content", async () => {
  const owner = randomUUID();
  owners.push(owner);
  await pool.query(
    "INSERT INTO users(id,email,password_hash,name) VALUES($1,$2,'test','Export QA')",
    [owner, `conversation-export-${owner}@example.test`],
  );
  const d = await transaction((db) => openPersonalConversation(db, owner));
  await transaction(async (db) => {
    for (let n = 1; n <= 205; n++)
      await retainConversationTurn(db, owner, d.chat_id, {
        turn_id: randomUUID(),
        role: "user",
        text: `Retained ${n}`,
      });
  });
  const doc = randomUUID(),
    team = randomUUID();
  teams.push(team);
  await pool.query(
    "INSERT INTO teams(id,name,created_by) VALUES($1,'Export boundary',$2)",
    [team, owner],
  );
  await pool.query(
    "INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'owner')",
    [team, owner],
  );
  await pool.query(
    "INSERT INTO docs(id,user_id,title,team_id) VALUES($1,$2,'Team source',$3)",
    [doc, owner, team],
  );
  await pool.query(
    "INSERT INTO assistant_conversation_entry_sources(entry_id,source_kind,source_id) SELECT id,'doc',$2 FROM assistant_conversation_entries WHERE destination_id=$1 AND sequence=2",
    [d.id, doc],
  );
  const revoked = randomUUID();
  await pool.query(
    "INSERT INTO docs(id,user_id,title) VALUES($1,$2,'Revoked source')",
    [revoked, owner],
  );
  await pool.query(
    "INSERT INTO assistant_conversation_entry_sources(entry_id,source_kind,source_id) SELECT id,'doc',$2 FROM assistant_conversation_entries WHERE destination_id=$1 AND sequence=3",
    [d.id, revoked],
  );
  await pool.query("DELETE FROM docs WHERE id=$1", [revoked]);
  const json = await exportData(pool, owner);
  assert.equal(json.assistant_conversations?.length, 1);
  const entries = json.assistant_conversations![0].entries;
  assert.equal(entries.length, 203);
  assert.equal(entries[0].sequence, "1");
  assert.equal(entries.at(-1)?.sequence, "205");
  assert.equal(
    entries.some((e) => e.sequence === "2" || e.sequence === "3"),
    false,
  );
  const zip = await exportArchive(pool, owner);
  const chunks: Buffer[] = [];
  for await (const chunk of zip.body) chunks.push(Buffer.from(chunk));
  const files = unzip(Buffer.concat(chunks));
  const pages = [...files]
    .filter(([path]) => path.includes("/assistant-conversations/"))
    .map(([, body]) => JSON.parse(body));
  assert.equal(pages.length, 3);
  assert.deepEqual(
    pages.flatMap((p) => p.entries).map((e) => e.id),
    entries.map((e) => e.id),
  );
  assert.ok(pages.every((p) => p.entries.length <= 100));
  const planner = [...files].find(([path]) => path.endsWith("/planner.json"))!;
  assert.equal(
    JSON.parse(planner[1]).assistant_conversations,
    undefined,
    "ZIP does not duplicate all history inside planner JSON",
  );
  assert.equal(
    (await exportData(pool, owner, { conversations: false }))
      .assistant_conversations,
    undefined,
  );
  await pool.query("DELETE FROM ai_chats WHERE id=$1", [d.chat_id]);
  assert.deepEqual((await exportData(pool, owner)).assistant_conversations, []);
});
