import { test } from "node:test";
import assert from "node:assert/strict";
import { AssistantControlsStore } from "@orbyn/api-client";
import type { AssistantWorkControls } from "@orbyn/core";

function fixture() {
  let account = "first",
    muted = false;
  let work: AssistantWorkControls = {
    background_paused: false,
    overnight_paused: false,
  };
  const changes: unknown[] = [];
  const client = {
    assistantWorkControls: async () => ({ ...work }),
    assistantConversationDeliveryPreferences: async () => ({
      muted,
      quiet_start: "22:00",
      quiet_end: "08:00",
      timezone: "UTC",
    }),
    updateAssistantWorkControls: async (
      input: Partial<AssistantWorkControls>,
    ) => {
      changes.push(input);
      work = { ...work, ...input };
      return { ...work };
    },
    setAssistantConversationMuted: async (value: boolean) => {
      changes.push({ muted: value });
      muted = value;
      return client.assistantConversationDeliveryPreferences();
    },
  };
  const store = new AssistantControlsStore(client, () => account);
  return {
    store,
    client,
    changes,
    switch: () => {
      account = "second";
    },
  };
}

test("controls keep mute and each admission lane independent and refresh after saving", async () => {
  const f = fixture();
  await f.store.set("background_paused", true);
  assert.deepEqual(f.changes, []);
  await f.store.refresh();
  await f.store.set("muted", true);
  assert.deepEqual(f.changes, [{ muted: true }]);
  assert.deepEqual(f.store.getSnapshot().data, {
    muted: true,
    background_paused: false,
    overnight_paused: false,
  });
  await f.store.set("overnight_paused", true);
  assert.deepEqual(f.changes[1], { overnight_paused: true });
  assert.deepEqual(f.store.getSnapshot().data, {
    muted: true,
    background_paused: false,
    overnight_paused: true,
  });
});

test("ambiguous saves clear actionable state until a fresh read resolves server state", async () => {
  const f = fixture();
  await f.store.refresh();
  const update = f.client.updateAssistantWorkControls;
  f.client.updateAssistantWorkControls = async (input) => {
    await update(input);
    throw new Error("response lost");
  };
  await f.store.set("background_paused", true);
  assert.equal(f.store.getSnapshot().data, null);
  assert.equal(f.store.getSnapshot().error, true);
  await f.store.set("background_paused", false);
  assert.equal(f.changes.length, 1);
  await f.store.refresh();
  assert.equal(f.store.getSnapshot().data?.background_paused, true);
});

test("account changes clear controls and stale responses cannot restore them", async () => {
  const f = fixture();
  await f.store.refresh();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.client.assistantWorkControls = async () => {
    await gate;
    return { background_paused: true, overnight_paused: true };
  };
  const pending = f.store.refresh();
  f.switch();
  release();
  await pending;
  assert.deepEqual(f.store.getSnapshot(), {
    data: null,
    busy: false,
    error: false,
  });
  await f.store.set("muted", true);
  assert.deepEqual(f.changes, []);
});

test("admission controls remain usable while unified alert delivery is disabled", async () => {
  const f = fixture();
  f.client.assistantConversationDeliveryPreferences = async () => {
    throw new Error("Disabled delivery endpoint must not be called");
  };
  const store = new AssistantControlsStore(f.client, () => "first", false);
  await store.refresh();
  assert.equal(store.getSnapshot().error, false);
  await store.set("muted", true);
  assert.deepEqual(f.changes, []);
  await store.set("background_paused", true);
  assert.equal(store.getSnapshot().data?.background_paused, true);
});
