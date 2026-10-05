import { test } from "node:test";
import assert from "node:assert/strict";
import type { Day } from "../src/modules/docs/agenda.js";
import { agendaBriefFacts } from "../src/modules/ai/agenda-brief.js";
const now = new Date("2026-10-05T09:00:00Z");
const base: Day = {
  tz: "UTC",
  items: [],
  calendar: [],
  setAside: [],
  comingEvents: [],
  freeMinutes: 60,
  freeStretches: [],
  priorities: ["Private full priority"],
  keptOut: new Set(),
  aiPriorities: ["Authorized priority"],
  study: {
    due: 999,
    newCards: 999,
    exams: [{ title: "Private full exam", days_left: 2, readiness: 0.99 }],
  },
};
test("brief facts never use the unrestricted Study overview as an AI fallback", () => {
  const facts = agendaBriefFacts(base, now);
  assert.equal("study" in facts, false);
  assert.ok(!JSON.stringify(facts).includes("Private full exam"));
  assert.deepEqual(facts.top_priorities, ["Authorized priority"]);
});
test("brief facts use only the captured AI Study snapshot and omit source identities", () => {
  const facts = agendaBriefFacts(
    {
      ...base,
      aiStudy: {
        due: 2,
        newCards: 3,
        exams: [{ title: "Authorized exam", days_left: 4, readiness: 0.5 }],
      },
      aiSources: [
        { kind: "doc", id: "captured-private-source-id", version: 1 },
      ],
    },
    now,
  );
  assert.deepEqual(facts.study, {
    cards_to_review: 5,
    exams: [{ title: "Authorized exam", days_left: 4 }],
  });
  const body = JSON.stringify(facts);
  for (const hidden of [
    "Private full exam",
    "Private full priority",
    "captured-private-source-id",
  ])
    assert.ok(!body.includes(hidden));
});
test("brief facts remove kept-out calendar and task-block titles before serialization", () => {
  const hidden = "11111111-1111-4111-8111-111111111111";
  const event = {
    source: "event" as const,
    item_id: hidden,
    title: "Private excluded event",
    start_at: now.toISOString(),
    end_at: new Date(now.getTime() + 3600000).toISOString(),
    all_day: false,
    location: "",
    busy: true,
    calendar: null,
    calendar_kind: null,
  };
  const facts = agendaBriefFacts(
    {
      ...base,
      keptOut: new Set([hidden]),
      calendar: [event],
      comingEvents: [event],
      setAside: [
        {
          item_id: hidden,
          title: "Private excluded task",
          start_at: event.start_at,
          end_at: event.end_at,
        },
      ],
    },
    now,
  );
  assert.deepEqual(facts.calendar, []);
  assert.deepEqual(facts.coming_up, []);
  assert.deepEqual(facts.set_aside, []);
});
