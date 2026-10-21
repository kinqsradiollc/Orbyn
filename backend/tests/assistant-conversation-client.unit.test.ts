import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { OrbynClient } from "@orbyn/api-client";

test("conversation-only history is an explicit client option with legacy omission preserved", async () => {
  const queries: URLSearchParams[] = [];
  const client = new OrbynClient({
    baseUrl: "https://fixture.invalid",
    getToken: () => "fixture",
    fetch: async (url) => {
      queries.push(new URL(String(url)).searchParams);
      return Response.json([]);
    },
  });
  await client.aiChats();
  await client.aiChats({ conversation_only: true });
  await client.aiChats({ conversation_only: false });
  assert.equal(queries[0].has("conversation_only"), false);
  assert.equal(queries[1].get("conversation_only"), "true");
  assert.equal(queries[2].get("conversation_only"), "false");
});

test("question answer transport preserves retry identity and rejects mismatched receipts", async () => {
  const destination = randomUUID(),
    entry = randomUUID(),
    turn = randomUUID();
  let wrong = false;
  const client = new OrbynClient({
    baseUrl: "https://fixture.invalid",
    getToken: () => "fixture",
    fetch: async (url, options) => {
      assert.ok(
        String(url).endsWith(
          `/me/assistant/conversations/${destination}/entries/${entry}/answer`,
        ),
      );
      assert.equal(options?.method, "POST");
      assert.deepEqual(JSON.parse(String(options?.body)), {
        answer: "First",
        turn_id: turn,
      });
      return Response.json({
        accepted: true,
        job_id: randomUUID(),
        turn_id: wrong ? randomUUID() : turn,
        entry_id: randomUUID(),
        destination_id: destination,
        reply_to_entry_id: entry,
      });
    },
  });
  await client.answerAssistantConversationQuestion(
    destination,
    entry,
    "First",
    turn,
  );
  wrong = true;
  await assert.rejects(
    client.answerAssistantConversationQuestion(
      destination,
      entry,
      "First",
      turn,
    ),
    /does not match/,
  );
});

test("conversation transport requests fresh authorized pages and rejects another destination", async () => {
  const d = {
    id: randomUUID(),
    chat_id: randomUUID(),
    personal: true,
    last_sequence: "1",
    read_sequence: "0",
  };
  let wrong = false;
  let calls = 0;
  const client = new OrbynClient({
    baseUrl: "https://fixture.invalid",
    getToken: () => "fixture",
    fetch: async (url, options) => {
      calls++;
      assert.match(
        String(url),
        new RegExp(`/me/assistant/conversations/${d.id}`),
      );
      assert.equal(options?.cache, "no-store");
      return Response.json({
        destination: wrong ? { ...d, id: randomUUID() } : d,
        cursor: "1",
        has_more: false,
        entries: [],
      });
    },
  });
  await client.assistantConversationFeed(d.id);
  await client.assistantConversationFeed(d.id);
  assert.equal(calls, 2);
  wrong = true;
  await assert.rejects(
    client.assistantConversationFeed(d.id),
    /does not match/,
  );
});

test("conversation navigation rejects mismatched targets and refresh cannot exceed its pinned upper cursor", async () => {
  const d = {
    id: randomUUID(),
    chat_id: randomUUID(),
    personal: true,
    last_sequence: "3",
    read_sequence: "0",
  };
  const entryId = randomUUID();
  let mode = "entry";
  const client = new OrbynClient({
    baseUrl: "https://fixture.invalid",
    getToken: () => "fixture",
    fetch: async () =>
      Response.json(
        mode === "entry"
          ? { destination: d, entry_id: randomUUID(), sequence: "1" }
          : mode === "chat"
            ? d
            : { destination: d, cursor: "3", entries: [], has_more: false },
      ),
  });
  await assert.rejects(
    client.assistantConversationEntry(d.id, entryId),
    /does not match/,
  );
  mode = "chat";
  await assert.rejects(
    client.assistantConversationForChat(randomUUID()),
    /does not match/,
  );
  mode = "page";
  await assert.rejects(
    client.assistantConversationFeed(d.id, "0", 50, undefined, "2"),
    /does not match/,
  );
});
