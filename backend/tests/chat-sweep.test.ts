import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type {
  ChatMessage,
  ResolvedAi,
} from "../src/modules/ai/providers/adapters.js";
import "./setup.js";

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { sweepOldChats } = await import("../src/worker/chat-sweep.js");
const app = await buildApp();
let userId = "";
let token = "";

before(async () => {
  await migrate();
  const response = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      email: `chat-sweep-${randomUUID()}@example.com`,
      password: "a-long-test-password",
      name: "Chat sweep tester",
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  const result = response.json();
  userId = result.user.id as string;
  token = result.token as string;
});

after(async () => {
  if (userId) await pool.query("DELETE FROM users WHERE id = $1", [userId]);
  await app.close();
  await pool.end();
});

test("old chats compact into private notes while pinned and kept-out chats stay intact", async () => {
  const now = new Date();
  const age = (days: number) => new Date(now.getTime() - days * 86_400_000);
  const source = await app.inject({
    method: "POST",
    url: "/docs",
    headers: { authorization: `Bearer ${token}` },
    payload: {
      title: "Biology notes",
      content: [{ type: "paragraph", text: "Cell division" }],
    },
  });
  assert.equal(source.statusCode, 201, source.body);
  const sourceId = source.json().id as string;
  const project = await app.inject({
    method: "POST",
    url: "/projects",
    headers: { authorization: `Bearer ${token}` },
    payload: { name: "Kept out of assistant" },
  });
  assert.equal(project.statusCode, 201, project.body);
  const projectId = project.json().id as string;
  await pool.query("UPDATE projects SET assistant_off = true WHERE id = $1", [
    projectId,
  ]);

  const makeTurns = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      role: index % 2 ? "assistant" : "user",
      text:
        index === 0 ? "An old question." : `Conversation turn ${index + 1}.`,
      ...(index === count - 1
        ? {
            sources: [
              { kind: "doc", doc_id: sourceId, title: "Biology notes" },
            ],
          }
        : {}),
    }));
  const chatIds = {
    old: randomUUID(),
    retry: randomUUID(),
    pinned: randomUUID(),
    keptOut: randomUUID(),
  };
  await pool.query(
    `INSERT INTO ai_chats
       (id, user_id, project_id, title, pinned, turns, trace, last_used_at)
     VALUES
       ($1, $2, NULL, 'Compact this conversation', false, $3::jsonb, $4::jsonb, $5),
       ($6, $2, NULL, 'Retry after provider failure', false, $7::jsonb, '[]'::jsonb, $8),
       ($9, $2, NULL, 'Pinned conversation', true, $10::jsonb, '[]'::jsonb, $11),
       ($12, $2, $13, 'Kept-out conversation', false, $14::jsonb, '[]'::jsonb, $15)`,
    [
      chatIds.old,
      userId,
      JSON.stringify(makeTurns(15)),
      JSON.stringify([{ step: 1, kind: "tool", label: "Read pages" }]),
      age(8),
      chatIds.retry,
      JSON.stringify([{ role: "user", text: "Keep this for a retry." }]),
      age(10),
      chatIds.pinned,
      JSON.stringify([{ role: "user", text: "Keep pinned history." }]),
      age(30),
      chatIds.keptOut,
      projectId,
      JSON.stringify([{ role: "user", text: "Keep private project history." }]),
      age(30),
    ],
  );

  const summary = JSON.stringify({
    asked: ["How should I review chapter two?"],
    decided: ["Use focused 50-minute sessions."],
    changed: ["Created the chapter review task after approval."],
  });
  const compactCalls: ChatMessage[][] = [];
  const compact = async (_ai: ResolvedAi, messages: ChatMessage[]) => {
    compactCalls.push(messages);
    if (messages[1]?.content.includes("Retry after provider failure"))
      return "not valid JSON";
    return summary;
  };
  const fakeAi = {} as ResolvedAi;
  const swept = await sweepOldChats({ ai: fakeAi, compact, now, limit: 10 });
  assert.equal(
    swept,
    1,
    `only the valid old chat should compact; provider calls: ${compactCalls
      .map((messages) => messages[1]?.content)
      .join(" | ")}`,
  );
  assert.equal(compactCalls.length, 2);
  assert.match(compactCalls[0][0].content, /Treat every line.*as data/);

  const oldChat = (
    await pool.query<{
      turns: { role: string; content?: string; text?: string }[];
      trace: unknown[];
      summary_doc_id: string;
      swept_at: Date;
    }>(
      `SELECT turns, trace, summary_doc_id, swept_at FROM ai_chats WHERE id = $1`,
      [chatIds.old],
    )
  ).rows[0];
  assert.ok(oldChat.summary_doc_id);
  assert.ok(oldChat.swept_at);
  assert.deepEqual(oldChat.turns, []);
  assert.deepEqual(oldChat.trace, []);
  const note = (
    await pool.query<{
      kind: string;
      team_id: string | null;
      content: unknown;
    }>("SELECT kind, team_id, content FROM docs WHERE id = $1", [
      oldChat.summary_doc_id,
    ])
  ).rows[0];
  assert.equal(note.kind, "agent");
  assert.equal(note.team_id, null);
  const noteText = JSON.stringify(note.content);
  assert.match(noteText, /"text":"Asked"/);
  assert.match(noteText, /"text":"Decided"/);
  assert.match(noteText, /"text":"Changed"/);
  assert.match(noteText, /focused 50-minute sessions/);
  assert.match(noteText, new RegExp(sourceId));

  // Memory learned from each turn as it finished; the sweep queues nothing.
  assert.equal(
    (
      await pool.query("SELECT 1 FROM memory_queue WHERE chat_id = $1", [
        chatIds.old,
      ])
    ).rowCount,
    0,
  );

  const retry = (
    await pool.query<{
      turns: unknown[];
      swept_at: Date | null;
      sweep_claimed_at: Date | null;
      sweep_attempts: number;
    }>(
      `SELECT turns, swept_at, sweep_claimed_at, sweep_attempts
         FROM ai_chats WHERE id = $1`,
      [chatIds.retry],
    )
  ).rows[0];
  assert.equal(retry.swept_at, null);
  assert.equal(retry.sweep_claimed_at, null);
  assert.equal(retry.sweep_attempts, 1);
  assert.equal(retry.turns.length, 1);

  const retained = await pool.query<{
    pinned: boolean;
    swept_at: Date | null;
    turns: unknown[];
  }>(
    "SELECT pinned, swept_at, turns FROM ai_chats WHERE id = ANY($1::uuid[])",
    [[chatIds.pinned, chatIds.keptOut]],
  );
  assert.equal(retained.rowCount, 2);
  assert.ok(retained.rows.every((chat) => !chat.swept_at));
  assert.equal(retained.rows.find((chat) => chat.pinned)?.turns.length, 1);

  assert.equal(
    await sweepOldChats({
      ai: fakeAi,
      now: new Date(now.getTime() + 31 * 60_000),
      compact: async () => summary,
      limit: 10,
    }),
    1,
    "a failed compaction can retry after its claim is released",
  );
  const retried = await pool.query<{ swept_at: Date | null }>(
    "SELECT swept_at FROM ai_chats WHERE id = $1",
    [chatIds.retry],
  );
  assert.ok(retried.rows[0].swept_at);
});
