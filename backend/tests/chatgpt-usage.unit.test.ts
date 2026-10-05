import { test } from "node:test";
import assert from "node:assert/strict";
import { chatgptUsageSummary, formatChatgptTokens } from "@orbyn/core";
import { OrbynClient } from "@orbyn/api-client";
const summary = {
  since: "2026-09-04T00:00:00.000Z",
  until: "2026-10-04T00:00:00.000Z",
  recording_enabled: true,
  completed_requests: 2,
  measured_requests: 1,
  input_tokens: "9007199254740993",
  output_tokens: "1",
  total_tokens: "9007199254740994",
  recent: [],
};
test("measured totals stay exact above Number precision and never masquerade as account quota", () => {
  assert.equal(
    chatgptUsageSummary.parse(summary).total_tokens,
    "9007199254740994",
  );
  assert.equal(
    formatChatgptTokens(summary.total_tokens),
    "9,007,199,254,740,994",
  );
  assert.equal(
    chatgptUsageSummary.safeParse({ ...summary, total_tokens: "invalid" })
      .success,
    false,
  );
  assert.equal(
    chatgptUsageSummary.safeParse({ ...summary, total_tokens: "1" }).success,
    false,
  );
  assert.equal(
    chatgptUsageSummary.safeParse({ ...summary, measured_requests: 3 }).success,
    false,
  );
  assert.equal(
    chatgptUsageSummary.safeParse({ ...summary, remaining_tokens: 100 })
      .success,
    false,
  );
});

test("first-party usage client requests fresh measurements and validates their shape", async () => {
  const original = globalThis.fetch;
  const requests: Headers[] = [];
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
    requests.push(new Headers(init.headers));
    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: { "content-type": "application/json", etag: '"usage-fixture"' },
    });
  }) as typeof fetch;
  try {
    const client = new OrbynClient({
      baseUrl: "https://example.test",
      getToken: () => "fixture-session",
    });
    assert.equal(
      (await client.chatgptUsage()).total_tokens,
      summary.total_tokens,
    );
    await client.chatgptUsage();
    assert.equal(requests.length, 2);
    assert.equal(requests[1].get("If-None-Match"), null);
    assert.equal(requests[0].get("authorization"), "Bearer fixture-session");
  } finally {
    globalThis.fetch = original;
  }
});
