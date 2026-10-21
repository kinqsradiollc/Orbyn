import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  AssistantConversationStore,
  conversationDisplayItems,
} from "@orbyn/api-client";
import type {
  AssistantConversationDestination,
  AssistantConversationEntry,
  AssistantConversationPage,
} from "@orbyn/core";

const destination = (last = "2"): AssistantConversationDestination => ({
  id: randomUUID(),
  chat_id: randomUUID(),
  personal: true,
  last_sequence: last,
  read_sequence: "0",
});
const entry = (sequence = "1"): AssistantConversationEntry => ({
  id: randomUUID(),
  sequence,
  revision: 1,
  created_at: "2026-10-21T01:00:00.000Z",
  updated_at: "2026-10-21T01:00:00.000Z",
  kind: "turn",
  turn_id: randomUUID(),
  turn: { role: "user", text: "Question" },
  reply_to_entry_id: null,
});
const page = (
  d: AssistantConversationDestination,
  entries: AssistantConversationEntry[] = [],
): AssistantConversationPage => ({
  destination: d,
  entries,
  cursor: d.last_sequence,
  has_more: false,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("refresh replaces revoked entries and never acknowledges a fetch", async () => {
  const d = destination();
  const e = entry();
  let entries = [e];
  let acks = 0;
  const store = new AssistantConversationStore({
    assistantConversationFeed: async () => page(d, entries),
    acknowledgeAssistantConversation: async () => {
      acks++;
      return d;
    },
  });
  store.select(d);
  await store.refresh();
  assert.equal(store.getSnapshot().entries.length, 1);
  assert.equal(acks, 0);
  entries = [];
  await store.refresh();
  const local = {
    id: "turn-local",
    turnId: e.kind === "turn" ? e.turn_id : "",
    role: "user" as const,
  };
  assert.deepEqual(
    conversationDisplayItems(store.getSnapshot(), [local], () => local),
    [],
  );
  assert.equal(acks, 0);
});

test("switching destination cancels queued history and read operations", async () => {
  const a = destination("120"),
    b = destination("120");
  const feed = deferred<AssistantConversationPage>();
  const ack = deferred<AssistantConversationDestination>();
  const reads: string[] = [];
  const feeds: string[] = [];
  const store = new AssistantConversationStore({
    assistantConversationFeed: async (id) => {
      feeds.push(id);
      return id === a.id ? feed.promise : page(b);
    },
    acknowledgeAssistantConversation: async (id) => {
      reads.push(id);
      return ack.promise;
    },
  });
  store.select(a);
  const earlier = store.loadEarlier();
  const firstAck = store.acknowledge("1");
  const queuedAck = store.acknowledge("2");
  store.select(b);
  await store.refresh();
  feed.resolve(page(a));
  ack.resolve({ ...a, read_sequence: "1" });
  await Promise.all([earlier, firstAck, queuedAck]);
  assert.deepEqual(reads, [a.id]);
  assert.deepEqual(feeds, [a.id, b.id]);
  assert.equal(store.getSnapshot().destination?.id, b.id);
  assert.equal(store.getSnapshot().hasEarlier, true);
});

test("account changes discard in-flight private history", async () => {
  let account = "a";
  const d = destination();
  const pending = deferred<AssistantConversationPage>();
  const store = new AssistantConversationStore(
    {
      assistantConversationFeed: async () => pending.promise,
      acknowledgeAssistantConversation: async () => d,
    },
    () => account,
  );
  store.select(d);
  const refresh = store.refresh();
  account = "b";
  pending.resolve(page(d, [entry()]));
  await refresh;
  assert.equal(store.getSnapshot().destination, null);
  assert.deepEqual(store.getSnapshot().entries, []);
});

test("an older acknowledgement cannot rewind freshly loaded cursors", async () => {
  const d = destination();
  let current = d;
  const pending = deferred<AssistantConversationDestination>();
  const store = new AssistantConversationStore({
    assistantConversationFeed: async () => page(current),
    acknowledgeAssistantConversation: async () => pending.promise,
  });
  store.select(d);
  await store.refresh();
  const ack = store.acknowledge("1");
  current = { ...d, last_sequence: "5", read_sequence: "3" };
  await store.refresh();
  pending.resolve({ ...d, read_sequence: "1" });
  await ack;
  assert.equal(store.getSnapshot().destination?.last_sequence, "5");
  assert.equal(store.getSnapshot().destination?.read_sequence, "3");
});

test("multi-page refresh pins its upper cursor and keeps live turns separate from updates", async () => {
  const d = destination("200");
  const e = entry("151");
  let call = 0;
  const store = new AssistantConversationStore({
    assistantConversationFeed: async (_id, after, _limit, _signal, through) => {
      call++;
      if (call === 1) {
        assert.equal(after, "150");
        assert.equal(through, undefined);
        return { ...page(d, [e]), cursor: "151", has_more: true };
      }
      assert.equal(through, "200");
      assert.equal(after, "151");
      return page({ ...d, last_sequence: "201" });
    },
    acknowledgeAssistantConversation: async () => d,
  });
  store.select(d);
  await store.refresh();
  const live = {
    id: "turn-live",
    turnId: e.kind === "turn" ? e.turn_id : "",
    role: "user" as const,
    text: "Live proposal state",
  };
  const optimistic = {
    id: "turn-next",
    turnId: randomUUID(),
    role: "user" as const,
    text: "Next",
  };
  const items = conversationDisplayItems(
    store.getSnapshot(),
    [live, optimistic],
    () => live,
  );
  assert.equal(items.length, 2);
  assert.equal(items[0].kind === "turn" && items[0].turn, live);
  assert.equal(items[1].sequence, null);
});

test("notification targets load older history without acknowledging or changing destinations", async () => {
  const d = destination("250");
  const target = entry("12");
  const afters: string[] = [];
  let acks = 0;
  const store = new AssistantConversationStore({
    assistantConversationFeed: async (_id, after) => {
      afters.push(after!);
      return page(d, BigInt(after!) < 12n ? [target] : []);
    },
    acknowledgeAssistantConversation: async () => {
      acks++;
      return d;
    },
  });
  store.select(d);
  await store.refresh();
  assert.equal(await store.reveal("12"), true);
  assert.deepEqual(afters, ["200", "11"]);
  assert.equal(acks, 0);
  assert.equal(store.getSnapshot().destination?.id, d.id);
});

test("a remote terminal outcome replaces stale local approval state without discarding the live proposal", async () => {
  const d = destination();
  const e = entry();
  assert.equal(e.kind, "turn");
  if (e.kind !== "turn") return;
  e.turn.role = "assistant";
  e.turn.outcome = "discarded";
  const store = new AssistantConversationStore({
    assistantConversationFeed: async () => page(d, [e]),
    acknowledgeAssistantConversation: async () => d,
  });
  store.select(d);
  await store.refresh();
  const local = {
    id: "turn-reply",
    turnId: e.turn_id,
    role: "assistant" as const,
    state: "pending",
    proposal: { text: "Preserve the parsed live proposal" },
  };
  const [item] = conversationDisplayItems(
    store.getSnapshot(),
    [local],
    () => local,
  );
  assert.equal(item.kind, "turn");
  if (item.kind !== "turn") return;
  assert.equal(item.turn.state, "discarded");
  assert.equal(item.turn.proposal, local.proposal);
});

test("a failed background refresh preserves independently owned foreground turns without restoring committed history", async () => {
  const d = destination(),
    committed = entry();
  let failed = false;
  const store = new AssistantConversationStore({
    assistantConversationFeed: async () => {
      if (failed) throw new Error("Offline");
      return page(d, [committed]);
    },
    acknowledgeAssistantConversation: async () => d,
  });
  store.select(d);
  await store.refresh();
  assert.equal(committed.kind, "turn");
  if (committed.kind !== "turn") return;
  const old = {
    id: "turn-old",
    turnId: committed.turn_id,
    role: "user" as const,
  };
  const active = {
    id: "turn-active",
    turnId: randomUUID(),
    role: "assistant" as const,
  };
  failed = true;
  await store.refresh();
  const items = conversationDisplayItems(
    store.getSnapshot(),
    [old, active],
    () => old,
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].kind === "turn" && items[0].turn, active);
});
