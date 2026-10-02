import { test } from "node:test";
import assert from "node:assert/strict";
import { OrbynClient } from "@orbyn/api-client";
const counts = { working: 0, queued: 0, waiting: 0, recovering: 0 };
const profile = {
  recent_activity: [],
  outputs: [],
  state: "idle",
  counts,
  last_activity_at: null,
  window: null,
  budget: null,
};
test("profile client refreshes evidence and refuses inconsistent runtime snapshots", async () => {
  let calls = 0;
  let response = {
    observed_at: new Date().toISOString(),
    profiles: [
      { ...profile, lane: "background" },
      { ...profile, lane: "overnight" },
    ],
  };
  const client = new OrbynClient({
    baseUrl: "https://fixture.invalid",
    getToken: () => "fixture",
    fetch: async (url) => {
      calls++;
      assert.equal(new URL(String(url)).pathname, "/me/assistant/profiles");
      return Response.json(response);
    },
  });
  await client.assistantProfiles();
  await client.assistantProfiles();
  assert.equal(calls, 2);
  response = { ...response, profiles: response.profiles.toReversed() };
  await assert.rejects(client.assistantProfiles());
  response = {
    ...response,
    profiles: [
      { ...profile, lane: "background", state: "working" },
      { ...profile, lane: "overnight" },
    ],
  };
  await assert.rejects(client.assistantProfiles());
  response = {
    ...response,
    profiles: [
      { ...profile, lane: "background", counts: { ...counts, working: -1 } },
      { ...profile, lane: "overnight" },
    ],
  };
  await assert.rejects(client.assistantProfiles());
});
