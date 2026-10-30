import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { OrbynClient } from "@orbyn/api-client";
import { assistantRoutineRunsPage } from "@orbyn/core";

test("routine history client preserves opaque cursors, refreshes evidence, and rejects another routine or restricted-row contents", async () => {
  const id = randomUUID();
  const run = {
    id: randomUUID(),
    scheduled_for: "2050-01-02T08:00:00.123456Z",
    last_observed_at: "2050-01-02T08:01:00.000000Z",
    resume_count: 1,
    state: "done" as const,
    visibility: "restricted" as const,
  };
  const cursor = `${run.scheduled_for}|${run.id}`;
  let response: unknown = {
    routine_id: id,
    runs: [run],
    next_cursor: cursor,
  };
  const calls: URL[] = [];
  const client = new OrbynClient({
    baseUrl: "https://fixture.invalid",
    getToken: () => "fixture",
    fetch: async (url) => {
      calls.push(new URL(String(url)));
      return Response.json(response);
    },
  });
  const page = await client.listAgentRoutineRuns(id, { limit: 1 });
  assert.equal(page.next_cursor, cursor);
  response = { routine_id: id, runs: [], next_cursor: null };
  await client.listAgentRoutineRuns(id, { limit: 1, cursor });
  await client.listAgentRoutineRuns(id, { limit: 1, cursor });
  assert.equal(calls.length, 3, "history never reuses stale access evidence");
  assert.equal(calls[1].pathname, `/me/agent-routines/${id}/runs`);
  assert.equal(calls[1].searchParams.get("cursor"), cursor);
  assert.equal(calls[1].searchParams.get("limit"), "1");
  response = { routine_id: randomUUID(), runs: [], next_cursor: null };
  await assert.rejects(client.listAgentRoutineRuns(id), /requested routine/);
  response = {
    routine_id: id,
    runs: [{ ...run, summary: "Must not leak" }],
    next_cursor: null,
  };
  await assert.rejects(client.listAgentRoutineRuns(id));
  assert.equal(
    assistantRoutineRunsPage.safeParse({
      routine_id: id,
      runs: [],
      next_cursor: cursor,
    }).success,
    false,
  );
  const count = calls.length;
  await assert.rejects(client.listAgentRoutineRuns(id, { limit: 51 }));
  await assert.rejects(client.listAgentRoutineRuns(id, { cursor: "invalid" }));
  assert.equal(calls.length, count, "invalid queries never dispatch");
});
