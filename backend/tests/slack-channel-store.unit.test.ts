import { test } from "node:test";
import assert from "node:assert/strict";
import { SlackChannelStore } from "../../packages/api-client/src/slack-channel-store.js";
import type { OrbynClient } from "../../packages/api-client/src/client.js";
const id = "d5e3c97a-258f-416a-a7dd-02f3374497d7";
const connection = {
  id,
  workspace_id: "TFIXTURE",
  workspace_name: "Fixture",
  external_user_id: "UOWNER",
  bot_scopes: ["chat:write", "im:write"],
  dm_enabled: false,
  version: 4,
  disconnected: false,
  token_expires_at: null,
  token_state: "ready" as const,
};
function fixture() {
  let session = "owner-session";
  const calls: { kind: string; input?: unknown }[] = [],
    remembered: (string | null)[] = [];
  const pending = {
    id,
    state: "ready" as const,
    expires_at: new Date(Date.now() + 600000).toISOString(),
    identity: {
      workspace_id: "TFIXTURE",
      workspace_name: "Fixture",
      external_user_id: "UOWNER",
      bot_scopes: ["chat:write", "im:write", "extra:scope"],
    },
  };
  const api = {
    slackChannel: async () => ({ configured: true, connection }),
    startSlackInstallation: async () => ({
      id,
      expires_at: pending.expires_at,
      authorization_url:
        "https://slack.com/oauth/v2/authorize?client_id=123.456",
    }),
    slackInstallation: async () => pending,
    confirmSlackInstallation: async (_id: string, input: unknown) => {
      calls.push({ kind: "confirm", input });
      return { ...connection, version: 5 };
    },
    setSlackDmPermission: async (input: unknown) => {
      calls.push({ kind: "permission", input });
      return { ...connection, dm_enabled: true, version: 5 };
    },
    disconnectSlack: async (input: unknown) => {
      calls.push({ kind: "disconnect", input });
      return { ...connection, disconnected: true, version: 5 };
    },
  } satisfies Pick<
    OrbynClient,
    | "slackChannel"
    | "startSlackInstallation"
    | "slackInstallation"
    | "confirmSlackInstallation"
    | "setSlackDmPermission"
    | "disconnectSlack"
  >;
  const store = new SlackChannelStore(
    api,
    () => session,
    (value) => remembered.push(value),
  );
  return {
    api,
    store,
    calls,
    remembered,
    pending,
    switch: () => {
      session = "another-session";
    },
  };
}
test("Connect opens the returned provider URL once and does not install or grant DMs", async () => {
  const f = fixture();
  await f.store.refresh();
  const opened: string[] = [];
  await f.store.start((url) => {
    opened.push(url);
  });
  assert.equal(opened.length, 1);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(f.remembered, [id]);
  assert.equal(f.store.getSnapshot().installation?.state, "pending");
  assert.equal(f.store.getSnapshot().status?.connection?.dm_enabled, false);
});
test("confirmation carries actual reviewed actor/scopes and exact current revision; DM defaults off", async () => {
  const f = fixture();
  await f.store.restore(id);
  await f.store.confirm(false);
  assert.deepEqual(f.calls, [
    {
      kind: "confirm",
      input: {
        workspace_id: "TFIXTURE",
        external_user_id: "UOWNER",
        expected_bot_scopes: f.pending.identity.bot_scopes,
        expected_version: 4,
        dm_enabled: false,
      },
    },
  ]);
  assert.equal(f.store.getSnapshot().installation, null);
  assert.equal(f.store.getSnapshot().authorizationUrl, null);
  assert.equal(f.remembered.at(-1), null);
  await f.store.confirm(true);
  assert.equal(f.calls.length, 1);
});
test("permission and unlink use the latest revision and remain available when setup is unavailable", async () => {
  const f = fixture();
  f.api.slackChannel = async () => ({ configured: false, connection });
  await f.store.refresh();
  await f.store.permission(true);
  await f.store.disconnect();
  assert.deepEqual(f.calls, [
    { kind: "permission", input: { expected_version: 4, dm_enabled: true } },
    { kind: "disconnect", input: { expected_version: 5 } },
  ]);
});
test("invalid saved request identifiers are cleared without a request read", async () => {
  const f = fixture();
  let reads = 0;
  f.api.slackInstallation = async () => {
    reads++;
    return f.pending;
  };
  await f.store.restore("foreign/path");
  assert.equal(reads, 0);
  assert.deepEqual(f.remembered, [null]);
});
test("expired review cannot confirm and local cancel clears only the remembered UUID", async () => {
  const f = fixture();
  f.pending.expires_at = new Date(Date.now() - 1).toISOString();
  await f.store.restore(id);
  await f.store.confirm(true);
  assert.equal(f.calls.length, 0);
  f.store.cancel();
  assert.equal(f.store.getSnapshot().installation, null);
  assert.deepEqual(f.remembered, [null]);
});
test("account changes during async Connect cannot launch or retain another owner authorization", async () => {
  const f = fixture();
  await f.store.refresh();
  const original = f.api.startSlackInstallation;
  f.api.startSlackInstallation = async () => {
    f.switch();
    return original();
  };
  let opens = 0;
  await f.store.start(() => {
    opens++;
  });
  assert.equal(opens, 0);
  assert.equal(f.remembered.length, 0);
  assert.equal(f.store.getSnapshot().status, null);
  assert.equal(f.store.getSnapshot().installation, null);
  await f.store.permission(true);
  assert.equal(f.calls.length, 0);
});
test("disposal aborts pending reads and suppresses late callbacks", async () => {
  const f = fixture();
  let release!: () => void;
  const blocked = new Promise<void>((r) => {
    release = r;
  });
  let notifications = 0;
  f.store.subscribe(() => notifications++);
  f.api.slackChannel = async () => {
    await blocked;
    return { configured: true, connection };
  };
  const work = f.store.refresh();
  f.store.dispose();
  const before = notifications;
  release();
  await work;
  assert.equal(notifications, before);
  assert.equal(f.store.getSnapshot().status, null);
});
test("provider/server errors stay generic and overlapping clicks cannot dispatch twice", async () => {
  const f = fixture();
  await f.store.refresh();
  let release!: () => void;
  const blocked = new Promise<void>((r) => {
    release = r;
  });
  let attempts = 0;
  f.api.startSlackInstallation = async () => {
    attempts++;
    await blocked;
    throw new Error("private-bot-token");
  };
  const work = f.store.start(() => {});
  await f.store.start(() => {});
  release();
  await work;
  assert.equal(attempts, 1);
  assert.equal(f.store.getSnapshot().busy, false);
  assert.doesNotMatch(f.store.getSnapshot().error, /private/);
});
