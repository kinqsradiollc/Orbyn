import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { OrbynClient } from "@orbyn/api-client";

const id = randomUUID();
const connection = {
  id,
  workspace_id: "TFIXTURE",
  workspace_name: "Fixture",
  external_user_id: "UFIXTURE",
  bot_scopes: ["chat:write", "im:write"],
  dm_enabled: false,
  version: 1,
  disconnected: false,
  token_expires_at: null,
};
const review = {
  workspace_id: connection.workspace_id,
  external_user_id: connection.external_user_id,
  expected_bot_scopes: connection.bot_scopes,
  expected_version: 0,
  dm_enabled: false,
};

test("Slack client uses exact reviewed identity, fresh reads and explicit versioned changes", async () => {
  const calls: { path: string; init?: RequestInit }[] = [];
  const client = new OrbynClient({
    baseUrl: "https://fixture.invalid",
    getToken: () => "session",
    fetch: async (url, init) => {
      const path = new URL(String(url)).pathname;
      calls.push({ path, init });
      if (path.endsWith("/installations"))
        return Response.json({
          id,
          authorization_url:
            "https://slack.com/oauth/v2/authorize?state=fixture",
          expires_at: new Date().toISOString(),
        });
      if (path.endsWith(`/${id}`))
        return Response.json({
          id,
          state: "ready",
          expires_at: new Date().toISOString(),
          identity: {
            workspace_id: connection.workspace_id,
            workspace_name: connection.workspace_name,
            external_user_id: connection.external_user_id,
            bot_scopes: connection.bot_scopes,
          },
        });
      if (path === "/agent-channels/slack")
        return Response.json({ configured: true, connection });
      return Response.json(connection);
    },
  });
  await client.slackChannel();
  await client.slackChannel();
  await client.startSlackInstallation();
  await client.slackInstallation(id);
  await client.slackInstallation(id);
  await client.confirmSlackInstallation(id, review);
  assert.deepEqual(JSON.parse(String(calls.at(-1)?.init?.body)), review);
  await client.setSlackDmPermission({ expected_version: 1, dm_enabled: true });
  await client.disconnectSlack({ expected_version: 1 });
  assert.equal(calls.length, 8);
  assert.ok(
    calls.every(
      (c) =>
        new Headers(c.init?.headers).get("authorization") === "Bearer session",
    ),
  );
  assert.ok(
    calls
      .filter((c) => !c.init?.method || c.init.method === "GET")
      .every((c) => !new Headers(c.init?.headers).has("if-none-match")),
  );
});

test("Slack client refuses unreviewed inputs, credentials, forged authorization URLs and server contract drift", async () => {
  let calls = 0,
    forged = false;
  const client = new OrbynClient({
    baseUrl: "https://fixture.invalid",
    getToken: () => "session",
    fetch: async () => {
      calls++;
      return Response.json(
        forged
          ? {
              id,
              authorization_url: "https://attacker.example/oauth/v2/authorize",
              expires_at: new Date().toISOString(),
            }
          : {
              configured: true,
              connection: { ...connection, access_token: "must-not-return" },
            },
      );
    },
  });
  await assert.rejects(client.confirmSlackInstallation("../../auth", review));
  await assert.rejects(
    client.confirmSlackInstallation(id, {
      ...review,
      access_token: "forbidden",
    }),
  );
  await assert.rejects(
    client.setSlackDmPermission({
      expected_version: 1,
      dm_enabled: true,
      workspace_id: "TOTHER",
    }),
  );
  await assert.rejects(client.disconnectSlack({ expected_version: 0 }));
  assert.equal(calls, 0);
  await assert.rejects(client.slackChannel());
  forged = true;
  await assert.rejects(client.startSlackInstallation());
  assert.equal(calls, 2);
});
