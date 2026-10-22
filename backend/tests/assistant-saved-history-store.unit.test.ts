import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AssistantSavedHistoryStore, OrbynClient } from "@orbyn/api-client";
import type { AssistantSavedHistory } from "@orbyn/core";

function fixture() {
  const destination = randomUUID(),
    chat = randomUUID(),
    calls: unknown[][] = [];
  let account = "first";
  const client = {
    assistantSavedHistory: async (
      d: string,
      c: string,
      before?: number,
      version?: string,
    ): Promise<AssistantSavedHistory> => {
      calls.push([d, c, before, version]);
      return {
        destination_id: d,
        chat_id: c,
        version: "a".repeat(64),
        before: before === undefined ? 1 : null,
        turns: [
          {
            role: "user",
            text: before === undefined ? "Newer history" : "Older history",
          },
        ],
      };
    },
  };
  const store = new AssistantSavedHistoryStore(
    client,
    destination,
    chat,
    () => account,
  );
  return {
    store,
    client,
    calls,
    destination,
    chat,
    switch: () => {
      account = "second";
    },
  };
}

test("saved history prepends only explicit versioned reads", async () => {
  const f = fixture();
  assert.deepEqual(f.calls, []);
  await f.store.refresh();
  await f.store.loadEarlier();
  assert.deepEqual(
    f.store.getSnapshot().turns.map((turn) => turn.text),
    ["Older history", "Newer history"],
  );
  assert.deepEqual(f.calls[1], [f.destination, f.chat, 1, "a".repeat(64)]);
  await f.store.loadEarlier();
  assert.equal(f.calls.length, 2);
});

test("a changed or revoked history window clears all cached pages before reload", async () => {
  const f = fixture();
  await f.store.refresh();
  const read = f.client.assistantSavedHistory;
  f.client.assistantSavedHistory = async () => {
    throw new Error("window changed");
  };
  await f.store.loadEarlier();
  assert.deepEqual(f.store.getSnapshot(), {
    turns: [],
    before: null,
    busy: false,
    error: true,
  });
  f.client.assistantSavedHistory = read;
  await f.store.refresh();
  assert.equal(f.calls.at(-1)?.[2], undefined);
  assert.equal(f.store.getSnapshot().turns.length, 1);
});

test("an authority recheck clears previously read history after revocation", async () => {
  const f = fixture();
  await f.store.refresh();
  f.client.assistantSavedHistory = async () => {
    throw new Error("source revoked");
  };
  await f.store.validate();
  assert.deepEqual(f.store.getSnapshot(), {
    turns: [],
    before: null,
    busy: false,
    error: true,
  });
});

test("stale account history cannot restore text after an account switch", async () => {
  const f = fixture();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const read = f.client.assistantSavedHistory;
  f.client.assistantSavedHistory = async (...args) => {
    await gate;
    return read(...args);
  };
  const pending = f.store.refresh();
  f.switch();
  release();
  await pending;
  assert.deepEqual(f.store.getSnapshot(), {
    turns: [],
    before: null,
    busy: false,
    error: false,
  });
});

test("saved history transport validates destination, version and advancing cursors", async () => {
  const destination = randomUUID(),
    chat = randomUUID(),
    version = "a".repeat(64);
  let mode = "valid";
  const client = new OrbynClient({
    baseUrl: "https://fixture.invalid",
    getToken: () => "fixture",
    fetch: async (url, options) => {
      assert.equal(options?.cache, "no-store");
      assert.ok(String(url).includes(`/conversations/${destination}/history?`));
      return Response.json({
        destination_id: mode === "destination" ? randomUUID() : destination,
        chat_id: chat,
        version: mode === "version" ? "b".repeat(64) : version,
        before: mode === "cursor" ? 5 : null,
        turns: [],
      });
    },
  });
  await client.assistantSavedHistory(destination, chat);
  for (const invalid of ["destination", "version", "cursor"]) {
    mode = invalid;
    await assert.rejects(
      client.assistantSavedHistory(destination, chat, 5, version),
      /does not match/,
    );
  }
  await assert.rejects(
    client.assistantSavedHistory(destination, chat, 5),
    /snapshot version/,
  );
});
