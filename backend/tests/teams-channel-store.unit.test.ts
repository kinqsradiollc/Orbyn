import { test } from "node:test";
import assert from "node:assert/strict";
import { TeamsChannelStore } from "../../packages/api-client/src/teams-channel-store.js";
import type { OrbynClient } from "../../packages/api-client/src/client.js";
import type {
  TeamsChannelConnection,
  TeamsInstallationRequest,
} from "@orbyn/core";
const id = "d5e3c97a-258f-416a-a7dd-02f3374497d7";
const tenant = "25d9c91c-71a5-4e27-a45b-9bb6258537ac";
function fixture() {
  let session = "owner-session";
  let connection: TeamsChannelConnection = {
    id,
    tenant_id: tenant,
    object_id: id,
    display_name: "Owner",
    version: 4,
    dm_enabled: false,
    state: "linked",
  };
  const remembered: (string | null)[] = [];
  const calls: { kind: string; input?: unknown }[] = [];
  const pending: TeamsInstallationRequest = {
    id,
    state: "ready",
    expires_at: new Date(Date.now() + 600000).toISOString(),
    identity: {
      tenantId: tenant,
      objectId: id,
      subject: "subject",
      displayName: "Owner",
    },
  };
  const proof = () => ({
    id,
    version: connection.version,
    dm_enabled: false as const,
    link_token: "x".repeat(43),
    link_expires_at: pending.expires_at,
  });
  const api = {
    teamsChannel: async () => ({
      configured: true,
      delivery_available: true,
      connection,
    }),
    startTeamsInstallation: async () => ({
      id,
      expires_at: pending.expires_at,
      authorization_url:
        "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?state=fixture",
    }),
    teamsInstallation: async () => pending,
    confirmTeamsInstallation: async (_id: string, input: unknown) => {
      calls.push({ kind: "confirm", input });
      connection = {
        ...connection,
        version: connection.version + 1,
        state: "awaiting_conversation",
        dm_enabled: false,
      };
      return proof();
    },
    restartTeamsConversationLink: async (input: unknown) => {
      calls.push({ kind: "renew", input });
      connection = {
        ...connection,
        version: connection.version + 1,
        state: "awaiting_conversation",
        dm_enabled: false,
      };
      return proof();
    },
    setTeamsDmPermission: async (input: unknown) => {
      calls.push({ kind: "permission", input });
      connection = {
        ...connection,
        version: connection.version + 1,
        dm_enabled: (input as { dm_enabled: boolean }).dm_enabled,
      };
      return connection;
    },
    disconnectTeams: async (input: unknown) => {
      calls.push({ kind: "disconnect", input });
      connection = {
        ...connection,
        version: connection.version + 1,
        state: "disconnected",
        dm_enabled: false,
      };
      return connection;
    },
  } satisfies Pick<
    OrbynClient,
    | "teamsChannel"
    | "startTeamsInstallation"
    | "teamsInstallation"
    | "confirmTeamsInstallation"
    | "restartTeamsConversationLink"
    | "setTeamsDmPermission"
    | "disconnectTeams"
  >;
  const store = new TeamsChannelStore(
    api,
    () => session,
    (value) => remembered.push(value),
  );
  return {
    api,
    store,
    pending,
    calls,
    remembered,
    switch: () => {
      session = "new-session";
    },
    link: () => {
      connection = {
        ...connection,
        state: "linked",
        version: connection.version + 1,
      };
    },
  };
}
test("Teams Connect opens one identity authorization and persists only the request UUID", async () => {
  const f = fixture(),
    opened: string[] = [];
  await f.store.refresh();
  await f.store.start((url) => {
    opened.push(url);
  });
  assert.equal(opened.length, 1);
  assert.match(opened[0], /^https:\/\/login.microsoftonline.com\//);
  assert.deepEqual(f.remembered, [id]);
  assert.equal(f.calls.length, 0);
  assert.equal(f.store.getSnapshot().status?.connection?.dm_enabled, false);
});
test("Teams confirmation binds the displayed tenant/object/revision without granting DM permission", async () => {
  const f = fixture();
  await f.store.restore(id);
  await f.store.confirm();
  assert.deepEqual(f.calls, [
    {
      kind: "confirm",
      input: { tenant_id: tenant, object_id: id, expected_version: 4 },
    },
  ]);
  assert.equal(f.store.getSnapshot().installation, null);
  assert.equal(f.remembered.at(-1), null);
  assert.equal(
    f.store.getSnapshot().challenge?.command,
    `/orbyn connect ${"x".repeat(43)}`,
  );
  assert.equal(f.store.getSnapshot().status?.connection?.dm_enabled, false);
  await f.store.confirm();
  assert.equal(f.calls.length, 1);
});
test("Teams one-use personal linking command is never persisted and clears after proof", async () => {
  const f = fixture();
  await f.store.restore(id);
  await f.store.confirm();
  assert.ok(f.store.getSnapshot().challenge);
  assert.ok(f.remembered.every((value) => value === id || value === null));
  f.link();
  await f.store.refresh();
  assert.equal(f.store.getSnapshot().challenge, null);
  assert.equal(f.store.getSnapshot().status?.connection?.state, "linked");
});
test("Teams lost command recovery and permission changes use current revisions", async () => {
  const f = fixture();
  await f.store.refresh();
  await f.store.renewLink();
  assert.deepEqual(f.calls[0], {
    kind: "renew",
    input: { expected_version: 4 },
  });
  assert.ok(f.store.getSnapshot().challenge);
  f.link();
  await f.store.refresh();
  await f.store.permission(true);
  await f.store.disconnect();
  assert.deepEqual(f.calls.slice(1), [
    { kind: "permission", input: { expected_version: 6, dm_enabled: true } },
    { kind: "disconnect", input: { expected_version: 7 } },
  ]);
  assert.equal(f.store.getSnapshot().challenge, null);
  assert.equal(f.store.getSnapshot().status?.connection?.state, "disconnected");
});
test("Teams session switch during authorization cannot open a provider tab or retain captured data", async () => {
  const f = fixture();
  await f.store.refresh();
  const original = f.api.startTeamsInstallation;
  f.api.startTeamsInstallation = async () => {
    const value = await original();
    f.switch();
    return value;
  };
  let opened = 0;
  await f.store.start(() => {
    opened++;
  });
  assert.equal(opened, 0);
  assert.deepEqual(f.remembered, []);
  assert.equal(f.store.getSnapshot().status, null);
  assert.equal(f.store.getSnapshot().challenge, null);
});
test("Teams session switch during confirm cannot publish a secret linking command", async () => {
  const f = fixture();
  await f.store.restore(id);
  const original = f.api.confirmTeamsInstallation;
  f.api.confirmTeamsInstallation = async (id, input) => {
    const result = await original(id, input);
    f.switch();
    return result;
  };
  await f.store.confirm();
  assert.equal(f.store.getSnapshot().challenge, null);
  assert.equal(f.store.getSnapshot().installation, null);
  assert.equal(f.store.getSnapshot().status, null);
});
test("Teams expired identity review never reaches confirmation", async () => {
  const f = fixture();
  f.pending.expires_at = new Date(Date.now() - 1).toISOString();
  await f.store.restore(id);
  await f.store.confirm();
  assert.equal(f.calls.length, 0);
});
test("Teams restored request rejects malformed IDs and carries no authorization URL or secret command", async () => {
  const f = fixture();
  await f.store.restore("bad-id");
  assert.deepEqual(f.remembered, [null]);
  assert.equal(f.store.getSnapshot().installation, null);
  await f.store.restore(id);
  assert.equal(f.store.getSnapshot().authorizationUrl, null);
  assert.equal(f.store.getSnapshot().challenge, null);
});
test("Teams uncertain confirmation exposes a generic error and cannot replay on refresh", async () => {
  const f = fixture();
  await f.store.restore(id);
  let calls = 0;
  f.api.confirmTeamsInstallation = async () => {
    calls++;
    throw Error("private-provider-secret");
  };
  await f.store.confirm();
  assert.equal(calls, 1);
  assert.doesNotMatch(f.store.getSnapshot().error, /private-provider-secret/);
  await f.store.refresh();
  assert.equal(calls, 1);
});
test("Teams dispose clears ephemeral command and aborts future reads", async () => {
  const f = fixture();
  await f.store.refresh();
  await f.store.renewLink();
  assert.ok(f.store.getSnapshot().challenge);
  f.store.dispose();
  assert.equal(f.store.getSnapshot().challenge, null);
  await f.store.refresh();
  assert.equal(f.store.getSnapshot().status, null);
});
test("Teams expired linking commands are erased locally without network retries", async () => {
  const f = fixture();
  await f.store.refresh();
  await f.store.renewLink();
  const now = Date.now;
  let reads = 0;
  f.api.teamsChannel = async () => {
    reads++;
    throw Error("must not read");
  };
  try {
    Date.now = () => now() + 700000;
    f.store.expireChallenge();
    assert.equal(f.store.getSnapshot().challenge, null);
    assert.equal(reads, 0);
  } finally {
    Date.now = now;
  }
});
test("Teams confirmation disables old local conversation authority even when its status refresh fails", async () => {
  const f = fixture();
  await f.store.restore(id);
  f.api.teamsChannel = async () => {
    throw Error("temporary status failure");
  };
  await f.store.confirm();
  assert.equal(
    f.store.getSnapshot().status?.connection?.state,
    "awaiting_conversation",
  );
  assert.equal(f.store.getSnapshot().status?.connection?.dm_enabled, false);
  assert.equal(f.store.getSnapshot().status?.connection?.version, 5);
  assert.ok(f.store.getSnapshot().challenge);
});
