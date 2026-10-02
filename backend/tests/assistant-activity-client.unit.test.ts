import { test } from "node:test";
import assert from "node:assert/strict";
import { OrbynClient } from "@orbyn/api-client";
test("activity client fetches fresh pages and rejects stream and cursor mismatches", async () => {
  let calls = 0;
  let response = {
    lane: "background",
    cursor: "2",
    has_more: false,
    last_activity_at: null,
    events: [] as {
      sequence: string;
      job_id: null;
      kind: string;
      created_at: string;
    }[],
  };
  const client = new OrbynClient({
    baseUrl: "https://fixture.invalid",
    getToken: () => "fixture",
    fetch: async (url) => {
      calls++;
      assert.equal(
        new URL(String(url)).pathname,
        "/me/assistant/activity/background",
      );
      return Response.json(response);
    },
  });
  await client.assistantActivity("background", "1");
  await client.assistantActivity("background", "1");
  assert.equal(calls, 2);
  response = { ...response, lane: "overnight" };
  await assert.rejects(
    client.assistantActivity("background", "1"),
    /requested stream/,
  );
  response = { ...response, lane: "background", cursor: "0" };
  await assert.rejects(
    client.assistantActivity("background", "1"),
    /requested stream/,
  );
  response = {
    ...response,
    cursor: "2",
    events: [
      {
        sequence: "1",
        job_id: null,
        kind: "done",
        created_at: new Date().toISOString(),
      },
    ],
  };
  await assert.rejects(
    client.assistantActivity("background", "1"),
    /requested stream/,
  );
  await assert.rejects(client.assistantActivity("background", "1.5"));
});
