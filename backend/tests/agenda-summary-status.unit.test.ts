import { test } from "node:test";
import assert from "node:assert/strict";
import { agendaPrivateSummary, agendaPrivateSummaryText } from "@orbyn/core";
const run = {
  id: "00000000-0000-4000-8000-000000000001",
  doc_id: "00000000-0000-4000-8000-000000000002",
  local_day: "2026-10-05",
  state: "queued" as const,
  expires_at: "2026-10-05T11:00:00.000Z",
  updated_at: "2026-10-05T06:00:00.000Z",
  reason: null,
  provider: null,
};
test("scheduled status validates strictly and never accepts a leaked execution snapshot", () => {
  assert.equal(agendaPrivateSummary.safeParse({ run }).success, true);
  assert.equal(
    agendaPrivateSummary.safeParse({ run: { ...run, snapshot: {} } }).success,
    false,
  );
  assert.equal(
    agendaPrivateSummary.safeParse({
      run: { ...run, reason: "raw provider error" },
    }).success,
    false,
  );
});
test("web and native status distinguish idle, pending, expired, unknown and completed results", () => {
  const now = Date.parse("2026-10-05T07:00:00Z");
  assert.equal(
    agendaPrivateSummaryText({ run: null }, now),
    "No scheduled summary yet.",
  );
  assert.equal(
    agendaPrivateSummaryText({ run }, now),
    "Queued for this morning.",
  );
  assert.equal(
    agendaPrivateSummaryText({ run: { ...run, state: "waiting" } }, now),
    "Waiting for your connected Orbyn desktop app.",
  );
  assert.equal(
    agendaPrivateSummaryText({ run }, Date.parse("2026-10-05T12:00:00Z")),
    "The morning window ended.",
  );
  assert.equal(
    agendaPrivateSummaryText(
      { run: { ...run, state: "failed", reason: "completion_unknown" } },
      now,
    ),
    "Completion could not be confirmed. It was not retried.",
  );
  assert.equal(
    agendaPrivateSummaryText(
      {
        run: {
          ...run,
          state: "done",
          provider: {
            source: "chatgpt",
            model: "selected-model",
            fallback: false,
          },
        },
      },
      now,
    ),
    "Summary ready · selected-model",
  );
});

test("usage-limit status gives recovery without exposing a provider body", () => {
  assert.equal(
    agendaPrivateSummaryText({
      run: { ...run, state: "failed", reason: "usage_limit" },
    }),
    "ChatGPT usage limit reached. Manage usage in ChatGPT.",
  );
});
